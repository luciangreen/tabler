// Tabler's commands for the RetroMR character. Each returns ops on the site or funnel,
// applied as one step marked as the character's, so "undo that" takes it back.
import { createCommands } from './core.js';
import { MEASURES, parseFormula, runReport, show, slugOf } from './db.js';
import { PROVIDERS } from './payments.js';
import { funnelOf, funnelOps, siteOf, siteOps } from './tablerdoc.js';

const clean = (s) => String(s ?? '').trim().replace(/^["“']|["”']$/g, '').replace(/[.!]$/, '').trim();
const list = (s) => clean(s).split(/\s*(?:,|\band\b)\s*/).map(clean).filter(Boolean);
const findTable = (site, name) => site.tables.find((t) => t.name === slugOf(clean(name).replace(/^the\s+/i, '').replace(/\s+table$/i, '')));
const NUMBERY = /^(price|cost|amount|qty|quantity|stock|count|total|value|age|number|score|hours|rate)s?$/;

// "name, price (number), stock as number" -> columns
export function parseColumns(text) {
  return list(text).map((c) => {
    const m = /^(.+?)\s*(?:\((number|text)\)|\bas\s+(?:a\s+)?(number|text))$/i.exec(c);
    const name = slugOf(m ? m[1] : c);
    return { name, type: (m?.[2] ?? m?.[3])?.toLowerCase() ?? (NUMBERY.test(name) ? 'number' : 'text') };
  }).filter((c) => c.name);
}

// "name is Tea guide, price 15" / "name: Tea, price=15" -> { name: 'Tea guide', price: '15' }
export function parsePairs(text, columns) {
  const names = columns.map((c) => c.name);
  const row = {};
  for (const part of String(text).split(/\s*,\s*/)) {
    const m = /^\s*([A-Za-z][\w ]*?)\s*(?:=|:|\bis\b|\s)\s*(.+?)\s*$/.exec(part);
    if (!m) continue;
    const key = slugOf(m[1]);
    if (names.includes(key)) row[key] = clean(m[2]);
  }
  return row;
}

export function tablerCommands() {
  const reg = createCommands({ app: 'Tabler' });
  reg
    .register({
      name: 'add table', patterns: ['add a table called {name} with {columns}', 'make a table {name} with {columns}', 'add a table {name} with columns {columns}'],
      help: 'add a table called customers with name, email and spend (number)',
      run: ({ args, ctx, doc }) => {
        const name = slugOf(clean(args.name));
        if (findTable(siteOf(doc), name)) return { ops: [], say: `There is already a table called ${name}.` };
        const columns = parseColumns(args.columns.replace(/^columns\s+/i, ''));
        if (!columns.length) return { ops: [], say: 'Which columns should it have?' };
        return { ops: siteOps(doc, (s) => s.tables.push({ name, columns, rows: [] })), say: `Added the ${name} table with ${columns.map((c) => c.name).join(', ')}.` };
      }
    })
    .register({
      name: 'add column', patterns: ['add a column {column} to {table}', 'add column {column} to {table}'],
      help: 'add a column value = price * stock to products',
      run: ({ args, ctx, doc }) => {
        const t = findTable(siteOf(doc), args.table);
        if (!t) return { ops: [], say: `There's no table called ${clean(args.table)}.` };
        const [left, formula] = clean(args.column).split(/\s*=\s*/);
        const col = formula ? { name: slugOf(left), type: 'number', formula } : parseColumns(left)[0];
        if (!col?.name) return { ops: [], say: 'What should the column be called?' };
        if (t.columns.some((c) => c.name === col.name)) return { ops: [], say: `${t.name} already has ${col.name}.` };
        if (formula) { try { parseFormula(formula, t.columns); } catch (e) { return { ops: [], say: `I can't use that formula: ${e.message}.` }; } }
        return { ops: siteOps(doc, (s) => findTable(s, t.name).columns.push(col)), say: `Added ${col.name} to ${t.name}${formula ? ` (${formula})` : ''}.` };
      }
    })
    .register({
      name: 'add row', patterns: ['add a row to {rest}', 'add to {rest}'],
      help: 'add a row to products: name Tea guide, category book, price 15, stock 20',
      run: ({ args, ctx, doc }) => {
        const m = /^(.+?)\s*(?::|\bwith\b)\s*(.+)$/i.exec(args.rest);
        if (!m) return { ops: [], say: 'Say it like "add a row to products: name Tea, price 15".' };
        args = { table: m[1], pairs: m[2] };
        const t = findTable(siteOf(doc), args.table);
        if (!t) return { ops: [], say: `There's no table called ${clean(args.table)}.` };
        const row = parsePairs(args.pairs, t.columns.filter((c) => !c.formula));
        if (!Object.keys(row).length) return { ops: [], say: `Say the values like "${t.columns[0]?.name ?? 'name'} is …, …".` };
        return { ops: siteOps(doc, (s) => findTable(s, t.name).rows.push(row)), say: `Added a row to ${t.name}.` };
      }
    })
    .register({
      name: 'report', patterns: ['make a report of {what} in {table} by {group}', 'report {what} in {table} by {group}', 'make a report of {what} in {table}', 'report {what} in {table}'],
      help: 'make a report of count and sum of value in products by category',
      run: ({ args, ctx, doc }) => {
        const site = siteOf(doc); const t = findTable(site, args.table);
        if (!t) return { ops: [], say: `There's no table called ${clean(args.table)}.` };
        const names = t.columns.map((c) => c.name);
        const measures = [];
        for (const part of list(args.what)) {
          const m = /^(?:the\s+)?(count|sum|total|average|mean|min|minimum|max|maximum)(?:\s+(?:of\s+)?(?:the\s+)?(.+))?$/i.exec(part);
          if (!m) return { ops: [], say: `I don't know how to report "${part}". Use ${MEASURES.join(', ')}.` };
          const fn = { total: 'sum', mean: 'average', minimum: 'min', maximum: 'max' }[m[1].toLowerCase()] ?? m[1].toLowerCase();
          const column = fn === 'count' ? '' : slugOf(m[2] ?? '');
          if (fn !== 'count' && !names.includes(column)) return { ops: [], say: `${t.name} has no column ${m[2] ?? '(none given)'}.` };
          measures.push({ fn, column });
        }
        const group = args.group ? slugOf(clean(args.group)) : '';
        if (group && !names.includes(group)) return { ops: [], say: `${t.name} has no column ${clean(args.group)}.` };
        let name = slugOf(`${t.name}${group ? `_by_${group}` : '_summary'}`);
        for (let i = 2; site.reports.some((r) => r.name === name); i++) name = `${name.replace(/_\d+$/, '')}_${i}`;
        const report = { name, title: `${t.name[0].toUpperCase()}${t.name.slice(1)}${group ? ` by ${group}` : ''}`, table: t.name, groupBy: group, measures, ...(group ? { sort: { by: group } } : {}) };
        const r = runReport(report, site.tables);
        return { ops: siteOps(doc, (s) => s.reports.push(report)), say: `Made the report "${report.title}": ${r.rows.slice(0, 3).map((x) => x.map(show).join(' ')).join('; ')}${r.rows.length > 3 ? '; …' : ''}.` };
      }
    })
    .register({
      name: 'show table', patterns: ['show {table}', 'what is in {table}', "what's in {table}"], help: 'show products',
      run: ({ args, ctx, doc }) => {
        const site = siteOf(doc);
        const t = findTable(site, args.table);
        const rep = site.reports.find((r) => r.name === slugOf(clean(args.table)) || r.title.toLowerCase() === clean(args.table).toLowerCase());
        if (rep) { const r = runReport(rep, site.tables); return { ops: [], say: `${rep.title}: ${r.header.join(', ')} — ${r.rows.map((x) => x.map(show).join(' ')).join('; ') || 'no rows'}.` }; }
        if (!t) return { ops: [], say: `There's no table or report called ${clean(args.table)}.` };
        return { ops: [], say: `${t.name} has ${t.rows.length} row${t.rows.length === 1 ? '' : 's'}${t.rows.length ? `: ${t.rows.slice(0, 3).map((r) => r[t.columns[0].name]).join(', ')}${t.rows.length > 3 ? ', …' : ''}` : ''}.` };
      }
    })
    .register({
      name: 'add page', patterns: ['add a page called {title}', 'add a page {title}'], help: 'add a page called About',
      run: ({ args, ctx, doc }) => {
        const title = clean(args.title); const slug = slugOf(title);
        if (!slug) return { ops: [], say: 'What should the page be called?' };
        if (siteOf(doc).pages.some((p) => p.slug === slug)) return { ops: [], say: `There is already a ${title} page.` };
        return { ops: siteOps(doc, (s) => s.pages.push({ slug, title, sections: [{ kind: 'text', text: '' }] })), say: `Added the ${title} page.` };
      }
    })
    .register({
      name: 'variable', patterns: ['set the variable {name} to {value}', 'set variable {name} to {value}', 'let {name} be {value}'], help: 'set the variable contact to hello@example.com',
      run: ({ args, ctx, doc }) => {
        const name = slugOf(clean(args.name));
        return { ops: siteOps(doc, (s) => { s.variables[name] = clean(args.value); }), say: `{{${name}}} is now ${clean(args.value)}.` };
      }
    })
    .register({
      name: 'offer headline', patterns: ['set the offer headline to {text}', 'set the offer to {text}'], help: 'set the offer headline to Get the whole course',
      run: ({ args, doc }) => ({ ops: funnelOps(doc, (f) => { f.offer.headline = clean(args.text); }), say: `The offer headline is now "${clean(args.text)}".` })
    })
    .register({
      name: 'funnel headline', patterns: ['set the headline to {text}', 'make the headline {text}'], help: 'set the headline to Calm in ten minutes a day',
      run: ({ args, doc }) => ({ ops: funnelOps(doc, (f) => { f.landing.headline = clean(args.text); }), say: `The landing page headline is now "${clean(args.text)}".` })
    })
    .register({
      name: 'funnel price', patterns: ['set the price to {price}', 'charge {price}', 'make the price {price}'], help: 'set the price to $49',
      run: ({ args, ctx, doc }) => {
        const m = /([A-Za-z]{3})?\s*\$?\s*(\d+(?:\.\d+)?)\s*([A-Za-z]{3})?/.exec(args.price);
        if (!m) return { ops: [], say: 'What price, as a number?' };
        const cur = (m[1] ?? m[3])?.toUpperCase();
        return { ops: funnelOps(doc, (f) => { f.price = Number(m[2]); if (cur) f.currency = cur; }), say: `The price is now ${m[2]}${cur ? ` ${cur}` : ''}.` };
      }
    })
    .register({
      name: 'funnel provider', patterns: ['use {provider} for payments', 'take payments with {provider}', 'use {provider}'], help: 'use PayPal for payments',
      run: ({ args, ctx, doc }) => {
        const id = clean(args.provider).toLowerCase().replace(/\s+/g, '');
        if (!PROVIDERS[id]) return { ops: [], say: `I can read sales from ${Object.values(PROVIDERS).map((p) => p.name).join(', ')}.` };
        return { ops: funnelOps(doc, (f) => { f.provider = id; }), say: `Sales will be read from ${PROVIDERS[id].name}. Enter its keys in the Funnel tab; they stay on this computer.` };
      }
    })
    .register({
      name: 'payment link', patterns: ['set the payment link to {url}', 'the payment link is {url}'], help: 'set the payment link to https://buy.stripe.com/…',
      run: ({ args, ctx, doc }) => {
        const url = clean(args.url);
        if (!/^https:\/\/[^\s'"<>]+$/.test(url)) return { ops: [], say: 'The payment link should be one https:// address.' };
        return { ops: funnelOps(doc, (f) => { f.paymentLink = url; }), say: 'The payment link is set.' };
      }
    })
    .register({
      name: 'ad spend', patterns: ['i spent {amount} on ads', 'set ad spend to {amount}', 'ad spend is {amount}'], help: 'I spent $30 on ads',
      run: ({ args, ctx, doc }) => {
        const n = Number(String(args.amount).replace(/[^\d.]/g, ''));
        if (!Number.isFinite(n)) return { ops: [], say: 'How much, as a number?' };
        return { ops: funnelOps(doc, (f) => { f.adSpend = n; }), say: `Ad spend is now ${n}.` };
      }
    })
    .register({
      name: 'funnel stats', patterns: ['how is the funnel doing', 'funnel stats', 'how many sales'], help: 'how is the funnel doing',
      run: ({ ctx }) => {
        const s = ctx.stats?.();
        if (!s) return { ops: [], say: 'Run the funnel and press "Refresh figures" in the Funnel tab first.' };
        return { ops: [], say: `${s.visits} visits, ${s.signups} sign-ups (${s.signupRate}%), ${s.checkouts} checkouts, ${s.sales} sales, revenue ${s.revenue}, profit ${s.profit}.` };
      }
    });
  return reg;
}
