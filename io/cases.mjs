// The functions whose inputs and outputs are recorded in io/ios.txt (see io/engine.mjs).
import { parseFormula, evalFormula, runReport, slugOf, sampleSite } from '../lib/db.js';
import { deployPlan } from '../lib/publish.js';
import { missing, PROVIDERS } from '../lib/payments.js';
import { sampleFunnel, previewPages } from '../lib/funnel.js';

export const title = 'Tabler';

const site = sampleSite();
const table = site.tables[0];
const cols = table.columns.map((c) => c.name);
const numCols = table.columns.filter((c) => c.type === 'number').map((c) => c.name);

export const cases = [
  { name: 'slugOf', run: slugOf, make: (rnd) => [rnd.pick(['Sign Up', 'Thank you!', 'Price (AUD)', '  Home page ', 'Café menu', 'Q&A', '100% Free', 'a/b test'])] },
  { name: 'formula', run: (text, row) => { try { return evalFormula(parseFormula(text, table.columns).tree, row); } catch (e) { return { error: e.message }; } }, make: (rnd) => {
    const a = rnd.pick(numCols.length ? numCols : cols), b = rnd.pick(numCols.length ? numCols : cols);
    const row = Object.fromEntries(table.columns.map((c) => [c.name, c.type === 'number' ? rnd.int(0, 500) : rnd.words(1, 2)]));
    return [rnd.pick([`${a} + ${b}`, `${a} * 2`, `${a} - ${b} / 2`, `(${a} + 1) * ${b}`, `${a} * 1.1`, `${a} / 0`, `nope + 1`]), row];
  } },
  { name: 'runReport', run: (report) => runReport(report, site.tables), make: (rnd) => [{ name: 'r', table: table.name, where: rnd.chance(0.5) ? [{ column: rnd.pick(numCols.length ? numCols : cols), op: rnd.pick(['>', '<', '=', '>=']), value: rnd.int(0, 100) }] : [], groupBy: rnd.chance(0.5) ? rnd.pick(cols) : '', measures: [{ fn: rnd.pick(['count', 'sum', 'average', 'max', 'min']), column: rnd.pick(numCols.length ? numCols : cols) }], sort: { by: rnd.pick(cols), desc: rnd.chance(0.5) }, limit: rnd.int(1, 10) }] },
  { name: 'deployPlan', run: deployPlan, make: (rnd) => [{ host: rnd.pick(['203.0.113.7', 'shop.example.com', '']), user: rnd.pick(['root', 'deploy', '']), port: rnd.pick([8095, 8080, 3000]), files: rnd.some(['site.pl', 'run.pl', 'data/products.pl'], 1, 3), run: 'site.pl', sshPort: rnd.pick([22, 2222]) }] },
  { name: 'missing payment keys', run: missing, make: (rnd) => { const p = rnd.pick(Object.keys(PROVIDERS)); return [p, rnd.chance(0.5) ? {} : Object.fromEntries((PROVIDERS[p].fields ?? PROVIDERS[p].keys ?? []).slice(0, rnd.int(0, 2)).map((f) => [f.name ?? f, 'x']))]; } },
  { name: 'previewPages', run: (headline) => previewPages({ ...sampleFunnel(), headline }).map((p) => ({ slug: p.slug, title: p.title })), make: (rnd) => [rnd.sentence()] }
];
