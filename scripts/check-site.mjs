// Runs the generated sample site in SWI-Prolog and checks it against the editor's preview:
// every table and report, adding rows through the forms, and saving them across a restart.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sampleSite } from '../lib/db.js';
import { siteProgram } from '../lib/site.js';
import { reportData, tableData } from '../lib/preview.js';
import { start, tables, text } from './serve-util.mjs';

const PORT = 8099;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabler-site-'));
const site = sampleSite();
fs.writeFileSync(path.join(dir, 'site.pl'), siteProgram(site, { port: PORT }));
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const get = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).text();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let server = await start(['site.pl', String(PORT)], dir, PORT);
try {
  const home = await get('/');
  check(home.includes('Welcome to My shop'), 'the home page fills in variables');
  const t = tableData(site, 'products', ['name', 'price']);
  check(same(tables(home)[0], [t.header, ...t.rows]), `the products table matches the preview: ${JSON.stringify(tables(home)[0])}`);
  const reports = await get('/reports');
  const served = tables(reports);
  site.reports.forEach((r, i) => {
    const d = reportData(site, r.name);
    check(reports.includes(d.title), `report "${d.title}" is shown`);
    check(same(served[i], [d.header, ...d.rows]), `report "${d.title}" matches the preview: ${JSON.stringify(served[i])} vs ${JSON.stringify([d.header, ...d.rows])}`);
  });
  // add a sign-up through the form
  const res = await fetch(`http://127.0.0.1:${PORT}/add`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'table=signups&name=Ann&email=ann%40example.com' });
  check(res.status === 303 && /\/join\?added=signups$/.test(res.headers.get('location') ?? ''), `the form redirects back with thanks (${res.status} ${res.headers.get('location')})`);
  check((await get('/join?added=signups')).includes('Thank you for joining!'), 'the thanks message shows');
  // add a product: the report changes as the preview says it should
  await fetch(`http://127.0.0.1:${PORT}/add`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'table=products&name=Tea+guide&category=book&price=10&stock=5' });
  site.tables[0].rows.push({ name: 'Tea guide', category: 'book', price: 10, stock: 5 });
  const after = tables(await get('/reports'))[0];
  const want = reportData(site, 'by_category');
  check(same(after, [want.header, ...want.rows]), `the report includes the new row: ${JSON.stringify(after)}`);
  const saved = fs.readFileSync(path.join(dir, 'tabler_data.pl'), 'utf8');
  check(/row\(signups,1,\[name-'Ann',email-'ann@example.com'\]\)/.test(saved.replace(/\s/g, '')), `the rows are saved: ${saved.trim()}`);
  // restart: the saved rows come back
  server.child.kill();
  await new Promise((r) => setTimeout(r, 500));
  server = await start(['site.pl', String(PORT)], dir, PORT);
  check(text(await get('/')).includes('Tea guide'), 'saved rows come back after a restart');
} catch (err) {
  check(false, `${err.message}\n${server.log()}`);
} finally {
  server.child.kill();
}
console.log(failures ? `${failures} failure(s)` : 'The generated site runs in SWI-Prolog and matches the preview.');
process.exit(failures ? 1 : 0);
