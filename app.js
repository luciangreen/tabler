// Tabler (Lucian Office, Phase 6): database websites served by SWI-Prolog, and sales funnels
// converted by vetusiapl2webpl that record their visits, sign-ups and sales.
import { api } from '/shared/api.js';
import { apply, characterHandler, deserialise, redo, serialise, toProlog, undo } from './lib/core.js';
import { MEASURES, OPS, rowsOf, runReport, show, slugOf } from './lib/db.js';
import { siteProgram } from './lib/site.js';
import { SITE_CSS, pageHTML } from './lib/preview.js';
import { funnelStats, parseEvents, previewPages, terminalProgram } from './lib/funnel.js';
import { PROVIDERS } from './lib/payments.js';
import { convertFunnelSpec, keepServing, runFunnelSpec, runSiteSpec } from './lib/publish.js';
import { funnelOf, funnelOps, newTablerDoc, siteOf, siteOps } from './lib/tablerdoc.js';
import { tablerCommands } from './lib/commands.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const { dataset, ...rest } = props;
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(rest)) if (k.startsWith('aria-')) n.setAttribute(k, v); else n[k] = v;
  Object.assign(n.dataset, dataset ?? {});
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TABS = [['pages', 'Pages'], ['tables', 'Tables'], ['reports', 'Reports'], ['variables', 'Variables'], ['funnel', 'Funnel'], ['publish', 'Publish']];
let doc = newTablerDoc();
let tab = 'pages';
let pick = { page: 'home', table: 'products', report: 'by_category', funnelStep: 'landing' };
let stats = null;
let jobs = { site: null, funnel: null };
let settings = {
  savePath: '', folder: '', tabler: 'lucianos/apps/tabler', vetusia: 'vetusiapl2webpl',
  sitePort: 8095, funnelPort: 8097, keysFile: '.lucianoffice/payment-keys.json',
  remote: { host: '', user: '', dir: 'lucianoffice-sites', sshPort: 22 }
};

const folder = () => (settings.folder || `Documents/Tabler/${slugOf(doc.title) || 'site'}`).replace(/\/$/, '');
const persist = () => { api.state.set('tabler', settings).catch(() => {}); api.state.set('tabler-doc', doc).catch(() => {}); };
function change(ops, label = '') {
  if (!ops.length) return;
  doc = apply(doc, ops, { by: 'user', label });
  persist();
  render();
}
const editSite = (label, f) => change(siteOps(doc, f), label);
const editFunnel = (label, f) => change(funnelOps(doc, f), label);
const say = (text) => { $('reply').textContent = text; };

// ------------------------------------------------------------------ small form helpers
// A text input bound to a value; commits on change (so typing doesn't add a step per key).
const input = (value, onCommit, props = {}) => el('input', { type: 'text', value: value ?? '', onchange: (e) => onCommit(e.target.value), ...props });
const area = (value, onCommit) => el('textarea', { value: value ?? '', onchange: (e) => onCommit(e.target.value) });
const select = (value, options, onCommit) => {
  const s = el('select', { onchange: (e) => onCommit(e.target.value) }, options.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return el('option', { value: v, textContent: t, selected: v === value }); }));
  return s;
};
const field = (label, control) => el('label', {}, label, control);
const btn = (text, onclick, props = {}) => el('button', { type: 'button', textContent: text, onclick, ...props });
const htmlTable = (header, rows) => el('div', { className: 'grid', innerHTML: `<table><tr>${header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(show(c))}</td>`).join('')}</tr>`).join('')}</table>` });

// ------------------------------------------------------------------ rendering
function render() {
  $('title').value = doc.title;
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === tab);
  const ed = $('editor');
  ed.replaceChildren(...({ pages: pagesTab, tables: tablesTab, reports: reportsTab, variables: variablesTab, funnel: funnelTab, publish: publishTab }[tab])().filter((x) => x && x.nodeType));
  renderPreview();
}

function renderPreview() {
  const site = siteOf(doc);
  const sel = $('previewPage');
  let html;
  if (tab === 'funnel') {
    const pages = previewPages(funnelOf(doc));
    if (!pages.some((p) => p.step === pick.funnelStep)) pick.funnelStep = pages[0].step;
    sel.replaceChildren(...pages.map((p) => el('option', { value: p.step, textContent: `Funnel: ${p.step}`, selected: p.step === pick.funnelStep })));
    html = pages.find((p) => p.step === pick.funnelStep).html;
    $('previewTitle').textContent = 'Funnel preview';
  } else {
    if (!site.pages.some((p) => p.slug === pick.page)) pick.page = site.pages[0]?.slug ?? '';
    sel.replaceChildren(...site.pages.map((p) => el('option', { value: p.slug, textContent: p.title, selected: p.slug === pick.page })));
    try { html = pageHTML(site, pick.page); } catch (err) { html = `<p>${esc(err.message)}</p>`; }
    $('previewTitle').textContent = 'Site preview';
  }
  $('preview').srcdoc = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${SITE_CSS}</style><div class="site">${html}</div>`;
}

// ------------------------------------------------------------------ Pages
const SECTION_KINDS = [['text', 'Text'], ['heading', 'Heading'], ['table', 'Table'], ['report', 'Report'], ['form', 'Form (adds rows)'], ['variable', 'Variable']];
function pagesTab() {
  const site = siteOf(doc);
  const pi = Math.max(0, site.pages.findIndex((p) => p.slug === pick.page));
  const page = site.pages[pi];
  const tables = site.tables.map((t) => t.name);
  const at = (f) => (s) => f(s.pages[pi]);
  const head = el('div', { className: 'row' },
    select(page?.slug ?? '', site.pages.map((p) => [p.slug, p.title]), (v) => { pick.page = v; render(); }),
    btn('Add page', () => {
      const title = prompt('Page title', 'About');
      if (!title) return;
      let slug = slugOf(title) || 'page';
      for (let i = 2; site.pages.some((p) => p.slug === slug); i++) slug = `${slugOf(title)}_${i}`;
      pick.page = slug;
      editSite('added a page', (s) => s.pages.push({ slug, title, sections: [{ kind: 'text', text: '' }] }));
    }),
    page && site.pages.length > 1 && btn('Delete page', () => { if (confirm(`Delete the ${page.title} page?`)) editSite('deleted a page', (s) => s.pages.splice(pi, 1)); }));
  if (!page) return [head, el('p', {}, 'No pages yet.')];
  const sections = page.sections.map((sec, i) => {
    const set = (key) => (v) => editSite('edited a section', at((p) => { p.sections[i][key] = v; }));
    const parts = [];
    if (sec.kind === 'text') parts.push(area(sec.text, set('text')));
    if (sec.kind === 'heading') parts.push(input(sec.text, set('text')));
    if (sec.kind === 'variable') parts.push(select(sec.name ?? '', ['', ...Object.keys(site.variables)], set('name')));
    if (sec.kind === 'table' || sec.kind === 'form') {
      parts.push(select(sec.table ?? '', tables, set('table')));
      parts.push(field('Columns (blank for all)', input((sec.columns ?? []).join(', '), (v) => set('columns')(v.split(',').map((x) => slugOf(x)).filter(Boolean)))));
      if (sec.kind === 'form') parts.push(field('Thank-you message', input(sec.thanks, set('thanks'))));
    }
    if (sec.kind === 'report') parts.push(select(sec.report ?? '', site.reports.map((r) => [r.name, r.title]), set('report')));
    return el('div', { className: 'card' },
      el('div', { className: 'row' },
        select(sec.kind, SECTION_KINDS, (v) => editSite('changed a section', at((p) => { p.sections[i] = { kind: v, text: '', table: tables[0], report: site.reports[0]?.name, columns: [] }; }))),
        el('span', { className: 'spacer' }),
        btn('↑', () => editSite('moved a section', at((p) => { if (i) [p.sections[i - 1], p.sections[i]] = [p.sections[i], p.sections[i - 1]]; })), { title: 'Move up', disabled: !i }),
        btn('↓', () => editSite('moved a section', at((p) => { if (i < p.sections.length - 1) [p.sections[i + 1], p.sections[i]] = [p.sections[i], p.sections[i + 1]]; })), { title: 'Move down', disabled: i === page.sections.length - 1 }),
        btn('✕', () => editSite('removed a section', at((p) => p.sections.splice(i, 1))), { title: 'Remove' })),
      parts);
  });
  return [head,
    field('Page title', input(page.title, (v) => editSite('renamed a page', at((p) => { p.title = v; })))),
    el('p', { className: 'note' }, 'Write {{name}} in text to show a variable.'),
    ...sections,
    el('div', { className: 'row' }, btn('Add section', () => editSite('added a section', at((p) => p.sections.push({ kind: 'text', text: '' })))))];
}

// ------------------------------------------------------------------ Tables
function tablesTab() {
  const site = siteOf(doc);
  const ti = Math.max(0, site.tables.findIndex((t) => t.name === pick.table));
  const t = site.tables[ti];
  const head = el('div', { className: 'row' },
    select(t?.name ?? '', site.tables.map((x) => x.name), (v) => { pick.table = v; render(); }),
    btn('Add table', () => {
      const name = slugOf(prompt('Table name', 'customers') ?? '');
      if (!name) return;
      if (site.tables.some((x) => x.name === name)) { say(`There is already a ${name} table.`); return; }
      pick.table = name;
      editSite('added a table', (s) => s.tables.push({ name, columns: [{ name: 'name', type: 'text' }], rows: [] }));
    }),
    t && btn('Delete table', () => { if (confirm(`Delete the ${t.name} table and its rows?`)) editSite('deleted a table', (s) => s.tables.splice(ti, 1)); }));
  if (!t) return [head, el('p', {}, 'No tables yet.')];
  const at = (f) => (s) => f(s.tables[ti]);
  let computed = [];
  try { computed = rowsOf(t); } catch (err) { say(err.message); }
  const grid = el('table', {},
    el('tr', {}, t.columns.map((c) => el('th', { textContent: c.formula ? `${c.name} = ${c.formula}` : c.name })), el('th', {})),
    t.rows.map((r, ri) => el('tr', {},
      t.columns.map((c) => c.formula
        ? el('td', { className: 'formula', textContent: show(computed[ri]?.[c.name]) })
        : el('td', {}, input(r[c.name], (v) => editSite('edited a cell', at((x) => { x.rows[ri][c.name] = c.type === 'number' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v; })), { inputMode: c.type === 'number' ? 'decimal' : 'text', 'aria-label': c.name }))),
      el('td', {}, btn('✕', () => editSite('deleted a row', at((x) => x.rows.splice(ri, 1))), { title: 'Delete row' })))));
  const cols = t.columns.map((c, ci) => el('div', { className: 'row' },
    input(c.name, (v) => { const n = slugOf(v); if (n) editSite('renamed a column', at((x) => { const old = x.columns[ci].name; x.columns[ci].name = n; for (const r of x.rows) if (old in r) { r[n] = r[old]; delete r[old]; } })); }, { 'aria-label': 'Column name' }),
    select(c.type, ['text', 'number'], (v) => editSite('changed a column type', at((x) => { x.columns[ci].type = v; }))),
    input(c.formula ?? '', (v) => editSite('changed a formula', at((x) => { if (v.trim()) { x.columns[ci].formula = v.trim(); x.columns[ci].type = 'number'; } else delete x.columns[ci].formula; })), { placeholder: 'formula, e.g. price * stock', 'aria-label': 'Formula' }),
    btn('✕', () => editSite('removed a column', at((x) => x.columns.splice(ci, 1))), { title: 'Remove column' })));
  return [head,
    el('div', { className: 'grid' }, grid),
    el('div', { className: 'row' }, btn('Add row', () => editSite('added a row', at((x) => x.rows.push({})))), el('span', { className: 'note' }, `${t.rows.length} row${t.rows.length === 1 ? '' : 's'}. Forms on the site add rows while it runs; they are saved beside it in tabler_data.pl.`)),
    el('h3', {}, 'Columns'), ...cols,
    el('div', { className: 'row' }, btn('Add column', () => editSite('added a column', at((x) => { let n = 'column'; for (let i = 2; x.columns.some((c) => c.name === n); i++) n = `column_${i}`; x.columns.push({ name: n, type: 'text' }); }))))];
}

// ------------------------------------------------------------------ Reports
function reportsTab() {
  const site = siteOf(doc);
  const ri = Math.max(0, site.reports.findIndex((r) => r.name === pick.report));
  const r = site.reports[ri];
  const head = el('div', { className: 'row' },
    select(r?.name ?? '', site.reports.map((x) => [x.name, x.title]), (v) => { pick.report = v; render(); }),
    btn('Add report', () => {
      const title = prompt('Report title', 'Summary');
      if (!title) return;
      let name = slugOf(title) || 'report';
      for (let i = 2; site.reports.some((x) => x.name === name); i++) name = `${slugOf(title)}_${i}`;
      pick.report = name;
      editSite('added a report', (s) => s.reports.push({ name, title, table: site.tables[0]?.name ?? '', measures: [{ fn: 'count', column: '' }] }));
    }),
    r && btn('Delete report', () => { if (confirm(`Delete "${r.title}"?`)) editSite('deleted a report', (s) => s.reports.splice(ri, 1)); }));
  if (!r) return [head, el('p', {}, 'No reports yet.')];
  const at = (f) => (s) => f(s.reports[ri]);
  const t = site.tables.find((x) => x.name === r.table);
  const colNames = (t?.columns ?? []).map((c) => c.name);
  let result;
  try { const out = runReport(r, site.tables); result = htmlTable(out.header, out.rows); } catch (err) { result = el('p', { className: 'note' }, err.message); }
  const wheres = (r.where ?? []).map((w, wi) => el('div', { className: 'row' },
    select(w.column, colNames, (v) => editSite('changed a filter', at((x) => { x.where[wi].column = v; }))),
    select(w.op, [...Object.keys(OPS)], (v) => editSite('changed a filter', at((x) => { x.where[wi].op = v; }))),
    input(w.value, (v) => editSite('changed a filter', at((x) => { x.where[wi].value = v; })), { 'aria-label': 'Value' }),
    btn('✕', () => editSite('removed a filter', at((x) => x.where.splice(wi, 1))))));
  const measures = (r.measures ?? []).map((m, mi) => el('div', { className: 'row' },
    select(m.fn, MEASURES, (v) => editSite('changed a summary', at((x) => { x.measures[mi].fn = v; }))),
    m.fn !== 'count' && select(m.column, colNames, (v) => editSite('changed a summary', at((x) => { x.measures[mi].column = v; }))),
    btn('✕', () => editSite('removed a summary', at((x) => x.measures.splice(mi, 1))))));
  return [head,
    field('Title', input(r.title, (v) => editSite('renamed a report', at((x) => { x.title = v; })))),
    field('Table', select(r.table, site.tables.map((x) => x.name), (v) => editSite('changed the table', at((x) => { x.table = v; x.where = []; x.groupBy = ''; x.columns = []; x.measures = [{ fn: 'count', column: '' }]; })))),
    el('h3', {}, 'Only rows where'), ...wheres,
    el('div', { className: 'row' }, btn('Add filter', () => editSite('added a filter', at((x) => { (x.where ??= []).push({ column: colNames[0] ?? '', op: '=', value: '' }); })))),
    field('Group by', select(r.groupBy ?? '', [['', '(no grouping)'], ...colNames], (v) => editSite('changed the grouping', at((x) => { x.groupBy = v; })))),
    el('h3', {}, 'Summaries'), el('p', { className: 'note' }, 'With no summaries, the report lists rows and the columns below.'), ...measures,
    el('div', { className: 'row' }, btn('Add summary', () => editSite('added a summary', at((x) => { (x.measures ??= []).push({ fn: 'sum', column: colNames.find((c) => t.columns.find((y) => y.name === c)?.type === 'number') ?? '' }); })))),
    !(r.measures ?? []).length && field('Columns to list (blank for all)', input((r.columns ?? []).join(', '), (v) => editSite('changed the columns', at((x) => { x.columns = v.split(',').map(slugOf).filter(Boolean); })))),
    el('div', { className: 'row' },
      field('Sort by', input(r.sort?.by ?? '', (v) => editSite('changed the sort', at((x) => { x.sort = v.trim() ? { by: slugOf(v), desc: !!x.sort?.desc } : undefined; })), { placeholder: 'a column or summary' })),
      field('Order', select(r.sort?.desc ? 'desc' : 'asc', [['asc', 'smallest first'], ['desc', 'largest first']], (v) => editSite('changed the sort', at((x) => { if (x.sort) x.sort.desc = v === 'desc'; })))),
      field('At most', input(r.limit ? String(r.limit) : '', (v) => editSite('changed the limit', at((x) => { x.limit = Number(v) || 0; })), { inputMode: 'numeric', placeholder: 'all' }))),
    el('h3', {}, 'Result'), result];
}

// ------------------------------------------------------------------ Variables
function variablesTab() {
  const site = siteOf(doc);
  const rows = Object.entries(site.variables).map(([k, v]) => el('div', { className: 'row' },
    el('code', {}, `{{${k}}}`),
    input(v, (nv) => editSite('changed a variable', (s) => { s.variables[k] = nv; }), { 'aria-label': k }),
    btn('✕', () => editSite('removed a variable', (s) => { delete s.variables[k]; }))));
  return [el('p', { className: 'note' }, 'Variables fill in {{name}} anywhere in page text and titles, so a phone number or price is changed in one place.'),
    ...rows,
    el('div', { className: 'row' }, btn('Add variable', () => { const k = slugOf(prompt('Variable name', 'phone') ?? ''); if (k) editSite('added a variable', (s) => { s.variables[k] = ''; }); }))];
}

// ------------------------------------------------------------------ Funnel
function funnelTab() {
  const f = funnelOf(doc);
  const set = (label, path) => (v) => editFunnel(label, (x) => { const keys = path.split('.'); let o = x; for (const k of keys.slice(0, -1)) o = o[k]; o[keys.at(-1)] = v; });
  const p = PROVIDERS[f.provider];
  const fields = f.landing.fields.map((x, i) => el('div', { className: 'row' },
    input(x.name, (v) => editFunnel('renamed a field', (y) => { y.landing.fields[i].name = v; }), { 'aria-label': 'Field name' }),
    input(x.label, (v) => editFunnel('relabelled a field', (y) => { y.landing.fields[i].label = v; }), { placeholder: 'Question shown', 'aria-label': 'Question' }),
    f.landing.fields.length > 1 && btn('✕', () => editFunnel('removed a field', (y) => y.landing.fields.splice(i, 1)))));
  return [
    el('p', { className: 'note' }, 'Landing page (sign-up) → offer → thanks with the payment link, or a polite no. Each visit and choice is recorded, and sales are matched to sign-ups by email.'),
    el('h3', {}, 'Landing page'),
    field('Headline', input(f.landing.headline, set('changed the headline', 'landing.headline'))),
    field('Text', area(f.landing.text, set('changed the landing text', 'landing.text'))),
    field('Points (one per line)', area(f.landing.bullets.join('\n'), (v) => set('changed the points', 'landing.bullets')(v.split('\n').map((x) => x.trim()).filter(Boolean)))),
    el('h3', {}, 'Sign-up fields'), ...fields,
    el('div', { className: 'row' }, btn('Add field', () => editFunnel('added a field', (y) => y.landing.fields.push({ name: 'Phone', label: 'Your phone' })))),
    el('h3', {}, 'Offer'),
    field('Headline', input(f.offer.headline, set('changed the offer', 'offer.headline'))),
    field('Text', area(f.offer.text, set('changed the offer text', 'offer.text'))),
    field('Yes button', input(f.offer.yes, set('changed the offer', 'offer.yes'))),
    field('No button', input(f.offer.no, set('changed the offer', 'offer.no'))),
    el('div', { className: 'row' },
      field('Price', input(String(f.price), (v) => set('changed the price', 'price')(Number(v) || 0), { inputMode: 'decimal' })),
      field('Currency', input(f.currency, (v) => set('changed the currency', 'currency')(v.toUpperCase()))),
      field('Ad spend', input(String(f.adSpend ?? 0), (v) => set('changed the ad spend', 'adSpend')(Number(v) || 0), { inputMode: 'decimal' }))),
    el('h3', {}, 'Thanks and payment'),
    field('Headline', input(f.thanks.headline, set('changed the thanks page', 'thanks.headline'))),
    field('Text', area(f.thanks.text, set('changed the thanks page', 'thanks.text'))),
    field('Payment link (from your provider: a Stripe Payment Link, PayPal button link or Square checkout link)', input(f.paymentLink, (v) => { if (v && !/^https:\/\/[^\s'"<>]+$/.test(v.trim())) { say('The payment link should be one https:// address.'); render(); return; } set('changed the payment link', 'paymentLink')(v.trim()); })),
    field('Read sales from', select(f.provider, Object.entries(PROVIDERS).map(([id, x]) => [id, x.name]), set('changed the provider', 'provider'))),
    el('h3', {}, 'Declined page'),
    field('Headline', input(f.declined.headline, set('changed the declined page', 'declined.headline'))),
    field('Text', area(f.declined.text, set('changed the declined page', 'declined.text'))),
    el('h3', {}, 'Figures'),
    el('p', { className: 'note' }, `Sales are read from ${p.name} with keys kept in a file on this computer, ${settings.keysFile}, which you fill in yourself (it needs: ${p.needs.map((n) => n.label).join('; ')}). The keys never pass through this page.`),
    el('div', { className: 'row' }, btn('Make the keys file', makeKeysFile), btn('Refresh figures', refreshFigures, { className: 'primary' })),
    statsView()];
}

function statsView() {
  if (!stats) return el('p', { className: 'note' }, 'Run the funnel (Publish), then refresh the figures.');
  const money = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(2)}`);
  const rows = [['Visits', stats.visits], ['Sign-ups', `${stats.signups} (${stats.signupRate}% of visits)`], ['Chose to buy', `${stats.checkouts} (${stats.checkoutRate}% of sign-ups)`], ['Said no thanks', stats.declined],
    ['Sales matched to sign-ups', `${stats.sales} (${stats.saleRate}% of those who chose to buy)`], ['Revenue', money(stats.revenue)], ['Ad spend', money(stats.adSpend)], ['Profit', money(stats.profit)],
    ['Return on ad spend', stats.returnOnSpend ?? '—'], ['Cost per sign-up', money(stats.costPerSignup)], ['Sales not from this funnel', stats.unmatchedSales]];
  return el('div', { className: 'grid stats', innerHTML: `<table>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>` });
}

async function makeKeysFile() {
  const blank = Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, Object.fromEntries(p.needs.map((n) => [n.key, '']))]));
  try {
    await api.files.write(settings.keysFile, `${JSON.stringify(blank, null, 2)}\n`, { mkdirs: true });
    say(`Made ${settings.keysFile}. Open it in iEdit and paste in your keys; Tabler only ever reads it from a job on this computer.`);
  } catch (err) {
    say(/exist/i.test(err.message) ? `${settings.keysFile} is already there; edit it in iEdit.` : `Couldn't make the keys file: ${err.message}`);
  }
}

// Runs a job and collects its output. A request (one line of JSON) is sent on its input.
async function runJob(spec, request) {
  const job = await api.jobs.start({ ...spec, stdin: request !== undefined });
  if (request !== undefined) await api.jobs.input(job.id, `${JSON.stringify(request)}\n`);
  return new Promise((resolve) => {
    let text = '';
    api.jobs.stream(job.id, { output: (c) => { text += c.text; }, end: (s) => resolve({ text, ok: s?.exitCode === 0 }) });
  });
}

async function refreshFigures() {
  const f = funnelOf(doc);
  let events = [];
  try { events = parseEvents((await api.files.read(`${folder()}/funnel/funnel_events.pl`)).content); } catch { say('No visits recorded yet: run the funnel from Publish first.'); }
  let sales = [];
  say(`Reading sales from ${PROVIDERS[f.provider].name}…`);
  const r = await runJob({ cmd: 'node', args: [`${settings.tabler}/scripts/fetch-sales.mjs`], label: `Tabler: sales from ${PROVIDERS[f.provider].name}`,
  }, { provider: f.provider, keysFile: settings.keysFile, since: events[0]?.time ?? 0 });
  const ok = /^SALES (.*)$/m.exec(r.text);
  if (ok) { sales = JSON.parse(ok[1]); say(`Read ${sales.length} sale${sales.length === 1 ? '' : 's'} from ${PROVIDERS[f.provider].name}.`); } else say(`Couldn't read sales: ${(/^SALES_ERROR (.*)$/m.exec(r.text)?.[1] ?? r.text.trim()) || 'no reply'}. The figures below count the funnel only.`);
  stats = funnelStats(events, { sales, adSpend: f.adSpend ?? 0 });
  render();
}

// ------------------------------------------------------------------ Publish
function publishTab() {
  const s = (key) => (v) => { settings[key] = v; persist(); };
  const rem = (key) => (v) => { settings.remote[key] = v; persist(); };
  const log = el('div', { className: 'log', id: 'publishLog' });
  return [
    el('h3', {}, 'On this computer'),
    field('Folder for the site and funnel files (in your home folder)', input(settings.folder, (v) => { s('folder')(v.trim()); render(); }, { placeholder: folder() })),
    el('div', { className: 'row' },
      field('Site port', input(String(settings.sitePort), (v) => s('sitePort')(Number(v) || 8095), { inputMode: 'numeric' })),
      field('Funnel port', input(String(settings.funnelPort), (v) => s('funnelPort')(Number(v) || 8097), { inputMode: 'numeric' }))),
    el('div', { className: 'row' },
      btn(jobs.site ? 'Restart site' : 'Run site', () => runSite(log), { className: 'primary' }),
      jobs.site && btn('Stop site', () => stopJob('site')),
      jobs.site && el('a', { href: `http://localhost:${settings.sitePort}/`, target: '_blank', textContent: `localhost:${settings.sitePort}` })),
    el('div', { className: 'row' },
      btn(jobs.funnel ? 'Restart funnel' : 'Run funnel', () => runFunnel(log), { className: 'primary' }),
      jobs.funnel && btn('Stop funnel', () => stopJob('funnel')),
      jobs.funnel && el('a', { href: `http://localhost:${settings.funnelPort}/`, target: '_blank', textContent: `localhost:${settings.funnelPort}` })),
    el('p', { className: 'note' }, 'The site is one SWI-Prolog program; the funnel is converted from a terminal program by vetusiapl2webpl.'),
    field('vetusiapl2webpl folder', input(settings.vetusia, s('vetusia'))),
    field('Tabler folder (for its scripts)', input(settings.tabler, s('tabler'))),
    field('Payment keys file', input(settings.keysFile, s('keysFile'))),
    el('h3', {}, 'On your server'),
    el('p', { className: 'note' }, 'When you have a server you reach with ssh (with a key set up), enter it here: the same files are copied and started there with SWI-Prolog.'),
    el('div', { className: 'row' },
      field('Address', input(settings.remote.host, rem('host'), { placeholder: 'example.com' })),
      field('User', input(settings.remote.user, rem('user'))),
      field('ssh port', input(String(settings.remote.sshPort), (v) => rem('sshPort')(Number(v) || 22), { inputMode: 'numeric' }))),
    field('Folder on the server', input(settings.remote.dir, rem('dir'))),
    el('div', { className: 'row' }, btn('Check (dry run)', () => deploy(log, true)), btn('Publish site', () => deploy(log, false, 'site')), btn('Publish funnel', () => deploy(log, false, 'funnel'))),
    log];
}

// Job folders are relative to your home folder; a path from home, seen from a job's folder.
const fromDir = (dir, p) => (p.startsWith('/') ? p : `${'../'.repeat(dir.split('/').filter(Boolean).length)}${p}`);
const write = (path, text) => api.files.write(path, text, { mkdirs: true, force: true });
const logTo = (log, text) => { log.textContent += `${text}\n`; log.scrollTop = log.scrollHeight; };

async function writeSite() {
  await write(`${folder()}/site/site.pl`, siteProgram(siteOf(doc), { port: settings.sitePort }));
  return `${folder()}/site`;
}
async function writeFunnel(log) {
  const dir = `${folder()}/funnel`;
  await write(`${dir}/funnel.pl`, terminalProgram(funnelOf(doc)));
  logTo(log, 'Converting the funnel with vetusiapl2webpl…');
  const r = await runJob(convertFunnelSpec({ vetusia: fromDir(dir, settings.vetusia), input: 'funnel.pl', output: 'funnel_web.pl', port: settings.funnelPort, cwd: dir }));
  logTo(log, r.text.trim());
  if (!r.ok) throw new Error('vetusiapl2webpl could not convert the funnel (see above)');
  await write(`${dir}/funnel_web.pl`, keepServing((await api.files.read(`${dir}/funnel_web.pl`)).content));
  return dir;
}

async function startServer(kind, spec, log) {
  if (jobs[kind]) await stopJob(kind, true);
  const job = await api.jobs.start(spec);
  jobs[kind] = job.id;
  api.jobs.stream(job.id, { output: (c) => logTo(log, c.text.trimEnd()), end: (st) => { if (jobs[kind] === job.id) { jobs[kind] = null; logTo(log, `${kind} stopped (exit ${st?.exitCode ?? '?'}).`); if (tab === 'publish') render(); } } });
  render();
  say(`The ${kind} is running at http://localhost:${kind === 'site' ? settings.sitePort : settings.funnelPort}/`);
}
async function runSite(log) {
  try { const dir = await writeSite(); await startServer('site', runSiteSpec({ file: 'site.pl', cwd: dir, port: settings.sitePort }), $('publishLog') ?? log); } catch (err) { say(`Couldn't run the site: ${err.message}`); }
}
async function runFunnel(log) {
  try { const dir = await writeFunnel(log); await startServer('funnel', runFunnelSpec({ file: 'funnel_web.pl', cwd: dir, port: settings.funnelPort }), $('publishLog') ?? log); } catch (err) { say(`Couldn't run the funnel: ${err.message}`); }
}
async function stopJob(kind, quiet) {
  const id = jobs[kind];
  jobs[kind] = null;
  if (id) await api.jobs.cancel(id).catch(() => {});
  if (!quiet) { say(`Stopped the ${kind}.`); render(); }
}

async function deploy(log, dry, kind = 'site') {
  const r = settings.remote;
  try {
    const dir = kind === 'site' ? await writeSite() : await writeFunnel(log);
    const files = kind === 'site' ? ['site.pl'] : ['funnel_web.pl'];
    const plan = { host: r.host, user: r.user, dir: `${r.dir}/${slugOf(doc.title)}-${kind}`, port: kind === 'site' ? settings.sitePort : settings.funnelPort, files, run: files[0], sshPort: r.sshPort };
    const out = await runJob({ cmd: 'node', args: [fromDir(dir, `${settings.tabler}/scripts/deploy.mjs`), ...(dry ? ['--dry-run'] : [])], cwd: dir, label: `Tabler: ${dry ? 'check' : 'publish'} ${kind}` }, plan);
    logTo(log, out.text.trim());
    const url = /^DEPLOYED (\S+)/m.exec(out.text)?.[1];
    say(out.ok ? (dry ? 'These are the commands Tabler will run.' : `Published: ${url}`) : `Publishing stopped: ${(/ERROR (.*)/.exec(out.text)?.[1]) ?? 'see the log'}`);
  } catch (err) { say(`Couldn't publish: ${err.message}`); }
}

// ------------------------------------------------------------------ the character
const commands = tablerCommands();
const ctx = { stats: () => stats };
const handle = characterHandler(commands, () => doc, (d) => { doc = d; persist(); render(); }, ctx);
async function sayDo(text) {
  const reply = await handle({ intent: 'unknown', text }, text);
  say(reply ?? `I don't know how to do that in Tabler. ${commands.help()}`);
}
$('say').addEventListener('submit', async (e) => { e.preventDefault(); await sayDo($('sayText').value); $('sayText').value = ''; });
addEventListener('message', async (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'lucianos.command') return;
  const reply = await handle({ intent: 'unknown', text: e.data.text }, e.data.text);
  e.source.postMessage({ type: 'lucianos.reply', id: e.data.id, text: reply }, location.origin);
});
if (parent !== window) parent.postMessage({ type: 'lucianos.commands', names: commands.list().map((c) => c.name) }, location.origin);

// ------------------------------------------------------------------ files
async function save() {
  const path = prompt('Save as (relative to your home folder)', settings.savePath || `Documents/${(doc.title || 'My site').replace(/[^\w -]/g, '')}.tabler.json`);
  if (!path) return;
  await api.files.write(path, serialise(doc), { mkdirs: true, force: true });
  await api.files.write(path.replace(/\.json$/, '') + '.pl', toProlog(doc), { mkdirs: true, force: true });
  settings.savePath = path;
  persist();
  say(`Saved ${path}, with its Prolog form beside it.`);
}
async function open() {
  const path = prompt('Open which .tabler.json file?', settings.savePath || '');
  if (!path) return;
  try { const d = deserialise((await api.files.read(path)).content); if (d.app !== 'tabler') throw new Error('that is not a Tabler file'); doc = d; settings.savePath = path; stats = null; persist(); render(); } catch (err) { say(`Couldn't open it: ${err.message}`); }
}
async function exportAs(kind) {
  const base = folder();
  if (kind === 'csv') {
    const t = siteOf(doc).tables.find((x) => x.name === pick.table) ?? siteOf(doc).tables[0];
    if (!t) return;
    const rows = rowsOf(t);
    const cell = (v) => { const s = show(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const path = prompt('Export the table as', `${base}/${t.name}.csv`);
    if (path) { await write(path, [t.columns.map((c) => c.name).join(','), ...rows.map((r) => t.columns.map((c) => cell(r[c.name])).join(','))].join('\n') + '\n'); say(`Exported ${path}.`); }
    return;
  }
  const [def, text] = kind === 'site' ? [`${base}/site/site.pl`, () => siteProgram(siteOf(doc), { port: settings.sitePort })]
    : kind === 'funnel' ? [`${base}/funnel/funnel.pl`, () => terminalProgram(funnelOf(doc))]
      : [`${base}/${slugOf(doc.title)}.tabler.pl`, () => toProlog(doc)];
  const path = prompt('Export as', def);
  if (!path) return;
  try { await write(path, text()); say(`Exported ${path}.`); } catch (err) { say(`Couldn't export: ${err.message}`); }
}

// ------------------------------------------------------------------ start
async function init() {
  const saved = await api.state.get('tabler').catch(() => null);
  settings = { ...settings, ...(saved ?? {}), remote: { ...settings.remote, ...(saved?.remote ?? {}) } };
  const d = await api.state.get('tabler-doc').catch(() => null);
  if (d?.format === 'lucianoffice/1' && d.app === 'tabler') doc = d;
  const params = new URLSearchParams(location.search);
  if (TABS.some(([id]) => id === params.get('tab'))) tab = params.get('tab');
  $('tabs').replaceChildren(...TABS.map(([id, name]) => el('button', { type: 'button', textContent: name, role: 'tab', dataset: { tab: id }, onclick: () => { tab = id; render(); } })));
  $('previewPage').onchange = (e) => { if (tab === 'funnel') pick.funnelStep = e.target.value; else pick.page = e.target.value; renderPreview(); };
  $('title').onchange = () => change([{ op: 'title', value: $('title').value.trim() || 'My site' }, ...siteOps(doc, (s) => { s.name = $('title').value.trim() || 'My site'; })], 'renamed');
  $('undo').onclick = () => { doc = undo(doc).doc; persist(); render(); };
  $('redo').onclick = () => { doc = redo(doc).doc; persist(); render(); };
  $('new').onclick = () => { if (confirm('Start a new site from the sample? The current one stays saved if you saved it.')) { doc = newTablerDoc(); stats = null; settings.savePath = ''; persist(); render(); } };
  $('save').onclick = save;
  $('open').onclick = open;
  $('export').onchange = async (e) => { const k = e.target.value; e.target.value = ''; if (k) await exportAs(k); };
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doc = (e.shiftKey ? redo(doc) : undo(doc)).doc; persist(); render(); }
  });
  render();
  if (params.get('do')) await sayDo(params.get('do'));
}
init();
