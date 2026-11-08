// Tabler's database: tables with typed columns (and formula columns worked out from the
// others), variables, and reports (filter, group, summarise, sort). The same definitions are
// worked out here for the editor's preview and written as Prolog for the website (site.js),
// so the preview and the site agree; CI checks that they do.

export const OPS = { '=': (a, b) => a == b, '!=': (a, b) => a != b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, contains: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()) };
export const MEASURES = ['count', 'sum', 'average', 'min', 'max'];

export const slugOf = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'n$1') || 'x';

// ------------------------------------------------------------------ formulas
// Arithmetic over column names and numbers: price * quantity, (total - cost) / total.
export function parseFormula(text, columns) {
  const names = new Set(columns.map((c) => c.name));
  const tokens = String(text).match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/()]|\S/g) ?? [];
  let i = 0;
  const used = new Set();
  const expr = () => { let l = term(); while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++]; l = { op, a: l, b: term() }; } return l; };
  const term = () => { let l = factor(); while (tokens[i] === '*' || tokens[i] === '/') { const op = tokens[i++]; l = { op, a: l, b: factor() }; } return l; };
  const factor = () => {
    const t = tokens[i++];
    if (t === undefined) throw new Error('the formula ends too soon');
    if (t === '(') { const e = expr(); if (tokens[i++] !== ')') throw new Error('a ")" is missing'); return e; }
    if (t === '-') return { op: 'neg', a: factor() };
    if (/^\d/.test(t)) return { num: Number(t) };
    if (names.has(t)) { used.add(t); return { col: t }; }
    throw new Error(`"${t}" is not a column`);
  };
  const tree = expr();
  if (i < tokens.length) throw new Error(`unexpected "${tokens[i]}"`);
  return { tree, used: [...used] };
}
export function evalFormula(tree, row) {
  if ('num' in tree) return tree.num;
  if ('col' in tree) { const x = row[tree.col]; const v = x === null || x === undefined || x === '' ? NaN : Number(x); return Number.isFinite(v) ? v : NaN; }
  if (tree.op === 'neg') return -evalFormula(tree.a, row);
  const a = evalFormula(tree.a, row), b = evalFormula(tree.b, row);
  const v = { '+': a + b, '-': a - b, '*': a * b, '/': b === 0 ? NaN : a / b }[tree.op];
  return Number.isFinite(v) ? Number(v.toPrecision(15)) : NaN;
}

// A table's rows with formula columns filled in (in column order, so a formula can use an
// earlier formula column) and numbers as numbers.
export function rowsOf(table) {
  const formulas = new Map();
  for (const c of table.columns) if (c.formula) formulas.set(c.name, parseFormula(c.formula, table.columns.filter((x) => x !== c)).tree);
  return (table.rows ?? []).map((r, i) => {
    const row = { _id: r._id ?? i + 1 };
    for (const c of table.columns) {
      if (c.formula) row[c.name] = evalFormula(formulas.get(c.name), row);
      else if (c.type === 'number') { const n = Number(r[c.name]); row[c.name] = r[c.name] === '' || r[c.name] === undefined || !Number.isFinite(n) ? null : n; }
      else row[c.name] = r[c.name] ?? '';
    }
    return row;
  });
}

// ------------------------------------------------------------------ reports
// { name, table, where: [{ column, op, value }], groupBy: column | '', measures: [{ fn, column }], sort: { by, desc }, limit }
export function runReport(report, tables) {
  const table = tables.find((t) => t.name === report.table);
  if (!table) throw new Error(`there is no table called ${report.table}`);
  const typeOf = (col) => table.columns.find((c) => c.name === col)?.type ?? 'text';
  // number columns compare as numbers; text compares as text ("contains" ignores case)
  const cmp = (w, v) => (typeOf(w.column) === 'number' && w.op !== 'contains' && Number.isFinite(Number(v)) && v !== null
    ? OPS[w.op](Number(v), Number(w.value))
    : OPS[w.op](String(v ?? ''), String(w.value)));
  const rows = rowsOf(table).filter((r) => (report.where ?? []).every((w) => cmp(w, r[w.column])));
  const measures = report.measures?.length ? report.measures : [{ fn: 'count', column: '' }];
  const label = (m) => (m.fn === 'count' ? 'count' : `${m.fn} of ${m.column}`);
  const measure = (m, list) => {
    if (m.fn === 'count') return list.length;
    const xs = list.map((r) => r[m.column]).filter((x) => typeof x === 'number' && Number.isFinite(x));
    if (!xs.length) return null;
    const v = { sum: xs.reduce((a, b) => a + b, 0), average: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) }[m.fn];
    return Number(v.toPrecision(15));
  };
  let header, out;
  if (report.groupBy) {
    const groups = new Map();
    for (const r of rows) { const k = r[report.groupBy] ?? ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    header = [report.groupBy, ...measures.map(label)];
    out = [...groups].map(([k, list]) => [k, ...measures.map((m) => measure(m, list))]);
  } else if (report.measures?.length) {
    header = measures.map(label);
    out = [measures.map((m) => measure(m, rows))];
  } else {
    const cols = report.columns?.length ? report.columns : table.columns.map((c) => c.name);
    header = cols;
    out = rows.map((r) => cols.map((c) => r[c]));
  }
  if (report.sort?.by) {
    const i = header.indexOf(report.sort.by);
    if (i >= 0) out.sort((a, b) => (a[i] < b[i] ? -1 : a[i] > b[i] ? 1 : 0) * (report.sort.desc ? -1 : 1));
  }
  if (report.limit) out = out.slice(0, report.limit);
  return { header, rows: out };
}

export const show = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)))) : String(v));

// Variables in text: "Welcome to {{site_name}}" -> the value.
export const fill = (text, variables) => String(text ?? '').replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (m, k) => (k in variables ? String(variables[k]) : m));

// A new site to start from: a shop with products, a report, pages and a sign-up form.
export function sampleSite() {
  return {
    name: 'My shop',
    variables: { site_name: 'My shop', contact: 'hello@example.com' },
    tables: [
      { name: 'products', columns: [{ name: 'name', type: 'text' }, { name: 'category', type: 'text' }, { name: 'price', type: 'number' }, { name: 'stock', type: 'number' }, { name: 'value', type: 'number', formula: 'price * stock' }],
        rows: [{ name: 'Meditation course', category: 'course', price: 49, stock: 100 }, { name: 'Logic book', category: 'book', price: 25, stock: 40 }, { name: 'Music lessons', category: 'course', price: 120, stock: 10 }, { name: 'Breathing guide', category: 'book', price: 9, stock: 300 }] },
      { name: 'signups', columns: [{ name: 'name', type: 'text' }, { name: 'email', type: 'text' }], rows: [] }
    ],
    reports: [
      { name: 'by_category', title: 'Products by category', table: 'products', groupBy: 'category', measures: [{ fn: 'count', column: '' }, { fn: 'sum', column: 'value' }, { fn: 'average', column: 'price' }], sort: { by: 'category' } },
      { name: 'premium', title: 'Products over $20', table: 'products', where: [{ column: 'price', op: '>', value: '20' }], columns: ['name', 'price'], sort: { by: 'price', desc: true } }
    ],
    pages: [
      { slug: 'home', title: 'Welcome', sections: [{ kind: 'text', text: 'Welcome to {{site_name}}. Courses and books for a calmer, clearer life.' }, { kind: 'table', table: 'products', columns: ['name', 'price'] }] },
      { slug: 'reports', title: 'Reports', sections: [{ kind: 'report', report: 'by_category' }, { kind: 'report', report: 'premium' }] },
      { slug: 'join', title: 'Join', sections: [{ kind: 'text', text: 'Join the list for news. Questions: {{contact}}' }, { kind: 'form', table: 'signups', columns: ['name', 'email'], thanks: 'Thank you for joining!' }] }
    ]
  };
}
