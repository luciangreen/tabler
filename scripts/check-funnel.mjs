// Converts the sample funnel with vetusiapl2webpl, runs it in SWI-Prolog, walks through it as
// a visitor would (both answers to the offer), and checks the visits, sign-ups, checkouts and
// refusals it recorded. Needs VETUSIA_DIR (a vetusiapl2webpl checkout).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { funnelStats, parseEvents, sampleFunnel, terminalProgram } from '../lib/funnel.js';
import { convertFunnelSpec, keepServing } from '../lib/publish.js';
import { form, start, text } from './serve-util.mjs';

const PORT = 8097;
const vetusia = process.env.VETUSIA_DIR;
if (!vetusia) { console.log('Set VETUSIA_DIR to a vetusiapl2webpl checkout.'); process.exit(1); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabler-funnel-'));
const funnel = sampleFunnel();
fs.writeFileSync(path.join(dir, 'funnel.pl'), terminalProgram(funnel));
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

const spec = convertFunnelSpec({ vetusia: path.resolve(vetusia), input: 'funnel.pl', output: 'funnel_web.pl', port: PORT });
try {
  console.log(execFileSync(spec.cmd, spec.args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch (err) {
  console.log(`FAIL vetusiapl2webpl could not convert the funnel:\n${err.stdout}\n${err.stderr}\n--- funnel.pl ---\n${fs.readFileSync(path.join(dir, 'funnel.pl'), 'utf8')}`);
  process.exit(1);
}
check(fs.existsSync(path.join(dir, 'funnel_web.pl')), 'vetusiapl2webpl wrote the funnel\'s web server');
fs.writeFileSync(path.join(dir, 'funnel_web.pl'), keepServing(fs.readFileSync(path.join(dir, 'funnel_web.pl'), 'utf8')));

async function walk(choice, person) {
  const pages = [];
  let res = await fetch(`http://127.0.0.1:${PORT}/`);
  for (let step = 0; step < 10; step++) {
    const html = await res.text();
    pages.push(html);
    const f = form(html);
    if (!f) break;
    const body = new URLSearchParams();
    for (const i of f.inputs) {
      if (i.type === 'submit') continue;
      if (i.type === 'hidden') body.set(i.name, i.value);
      else if (i.type === 'radio' || i.type === 'select') { if (!body.has(i.name)) body.set(i.name, choice); }
      else body.set(i.name, person[i.name] ?? 'x');
    }
    const url = new URL(f.action || '/', `http://127.0.0.1:${PORT}/`);
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  }
  return pages;
}

const server = await start(['funnel_web.pl'], dir, PORT);
try {
  const yes = await walk('1', { Name: 'Ann', Email: 'ann@example.com' });
  check(text(yes[0]).includes(funnel.landing.headline), 'the landing page shows the headline');
  check(yes[0].includes('<li>Ten-minute daily sessions</li>'), 'the landing page shows the bullet points');
  check(text(yes.at(-2) ?? '').includes(funnel.offer.headline), 'the offer page is shown after signing up');
  check(yes.at(-1).includes(funnel.paymentLink), 'choosing to buy shows the payment link');
  const no = await walk('2', { Name: 'Ben', Email: 'ben@example.com' });
  check(text(no.at(-1)).includes(funnel.declined.headline), 'saying no thanks shows the declined page');
  if (failures) {
    console.log('--- pages served (choosing 1) ---');
    yes.forEach((h, i) => console.log(`[page ${i}]\n${h.slice(0, 2500)}`));
    console.log(`--- server log ---\n${server.log()}`);
    console.log(`--- funnel_web.pl ---\n${fs.readFileSync(path.join(dir, 'funnel_web.pl'), 'utf8')}`);
  }
} catch (err) {
  check(false, `${err.message}\n${server.log()}`);
} finally {
  server.child.kill();
}
const eventsFile = path.join(dir, 'funnel_events.pl');
const raw = fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8') : '';
console.log(raw.trim());
const events = parseEvents(raw);
const kinds = events.map((e) => e.event);
check(kinds.filter((k) => k === 'visit').length >= 2, 'visits are recorded');
check(events.some((e) => e.event === 'signup' && JSON.stringify(e.detail) === JSON.stringify(['Ann', 'ann@example.com'])), 'the sign-up is recorded with the name and email');
check(events.some((e) => e.event === 'checkout' && e.detail === 'ann@example.com'), 'the checkout is recorded');
check(events.some((e) => e.event === 'declined' && e.detail === 'ben@example.com'), 'the refusal is recorded');
const stats = funnelStats(events, { sales: [{ provider: 'stripe', id: 'ch_1', amount: 49, currency: 'AUD', time: Date.now() / 1000, email: 'Ann@example.com', status: 'paid' }, { provider: 'stripe', id: 'ch_2', amount: 20, currency: 'AUD', time: 0, email: 'other@example.com', status: 'paid' }], adSpend: 10 });
check(stats.signups === 2 && stats.checkouts === 1 && stats.declined === 1 && stats.sales === 1 && stats.revenue === 49 && stats.profit === 39, `the funnel's figures add up: ${JSON.stringify(stats)}`);
console.log(failures ? `${failures} failure(s)` : 'The funnel runs in SWI-Prolog through vetusiapl2webpl and records its visits and sales.');
process.exit(failures ? 1 : 0);
