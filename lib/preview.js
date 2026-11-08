// The site's pages as HTML, for the editor's preview: the same layout and values the Prolog
// site serves (both come from db.js definitions; CI checks the Prolog site against these).
import { fill, rowsOf, runReport, show } from './db.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const table = (header, rows) => `<table><tr>${header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;

export function tableData(site, name, columns = []) {
  const t = site.tables.find((x) => x.name === name);
  if (!t) return { header: [], rows: [] };
  const cols = columns.length ? columns : t.columns.map((c) => c.name);
  return { header: cols, rows: rowsOf(t).map((r) => cols.map((c) => show(Number.isNaN(r[c]) ? null : r[c]))) };
}
export function reportData(site, name) {
  const r = (site.reports ?? []).find((x) => x.name === name);
  if (!r) return { title: name, header: [], rows: [] };
  const out = runReport(r, site.tables);
  return { title: r.title ?? r.name, header: out.header, rows: out.rows.map((row) => row.map((v) => show(v))) };
}

export function pageHTML(site, slug) {
  const vars = site.variables ?? {};
  const page = site.pages.find((p) => p.slug === slug) ?? site.pages[0];
  if (!page) return '<p>No pages yet.</p>';
  const nav = `<nav><strong>${esc(fill(site.name, vars))}</strong> ${site.pages.map((p) => `<a href="#${esc(p.slug)}"${p.slug === page.slug ? ' aria-current="page"' : ''}>${esc(fill(p.title, vars))}</a>`).join(' ')}</nav>`;
  const parts = page.sections.map((s) => {
    if (s.kind === 'text') return `<p>${esc(fill(s.text, vars))}</p>`;
    if (s.kind === 'heading') return `<h2>${esc(fill(s.text, vars))}</h2>`;
    if (s.kind === 'variable') return `<p><strong>${esc(s.name)}</strong>: ${esc(vars[s.name] ?? '')}</p>`;
    if (s.kind === 'table') { const d = tableData(site, s.table, s.columns ?? []); return table(d.header, d.rows); }
    if (s.kind === 'report') { const d = reportData(site, s.report); return `<h2>${esc(d.title)}</h2>${table(d.header, d.rows)}`; }
    if (s.kind === 'form') {
      const t = site.tables.find((x) => x.name === s.table);
      const cols = s.columns?.length ? s.columns : (t?.columns ?? []).filter((c) => !c.formula).map((c) => c.name);
      return `<form onsubmit="return false">${cols.map((c) => `<p><label>${esc(c)}</label> <input type="${t?.columns.find((x) => x.name === c)?.type === 'number' ? 'number' : 'text'}" name="${esc(c)}"></p>`).join('')}<p><input type="submit" value="Send"></p></form>`;
    }
    return '';
  });
  return `${nav}<h1>${esc(fill(page.title, vars))}</h1>${parts.join('')}`;
}

export const SITE_CSS = 'body{font-family:system-ui,sans-serif;margin:0;background:#f6f5f1;color:#222}.site{max-width:860px;margin:0 auto;padding:16px}nav a{margin-right:14px;color:#3a5a8c;font-weight:600}nav{padding:10px 0;border-bottom:1px solid #ddd}table{border-collapse:collapse;margin:10px 0;background:#fff}th,td{border:1px solid #ddd;padding:5px 10px;text-align:left}th{background:#eef1f6}form p{margin:6px 0}label{display:inline-block;min-width:7em}input{font:inherit;padding:4px}';
