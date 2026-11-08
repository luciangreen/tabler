import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalFormula, fill, parseFormula, rowsOf, runReport, sampleSite, show, slugOf } from '../lib/db.js';
import { atom, siteProgram } from '../lib/site.js';
import { pageHTML, reportData, tableData } from '../lib/preview.js';
import { fieldVar, funnelStats, parseEvents, previewPages, sampleFunnel, terminalProgram } from '../lib/funnel.js';
import { PROVIDERS, missing, readSales } from '../lib/payments.js';
import { convertFunnelSpec, deployPlan, runSiteSpec } from '../lib/publish.js';

test('formulas: arithmetic over columns, in order, with bad input caught', () => {
  const cols = [{ name: 'price' }, { name: 'qty' }];
  assert.equal(evalFormula(parseFormula('price * qty + 2', cols).tree, { price: 3, qty: 4 }), 14);
  assert.equal(evalFormula(parseFormula('(price - 1) / qty', cols).tree, { price: 9, qty: 4 }), 2);
  assert.ok(Number.isNaN(evalFormula(parseFormula('price / qty', cols).tree, { price: 1, qty: 0 })));
  assert.throws(() => parseFormula('price * colour', cols), /"colour" is not a column/);
  const t = { columns: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number', formula: 'a * 2' }, { name: 'c', type: 'number', formula: 'b + a' }], rows: [{ a: 5 }, { a: '' }] };
  assert.deepEqual(rowsOf(t).map((r) => [r.a, r.b, r.c]), [[5, 10, 15], [null, NaN, NaN]]);
});

test('reports: filters, groups in first-seen order, summaries, sorting and limits', () => {
  const site = sampleSite();
  const byCat = runReport(site.reports[0], site.tables);
  assert.deepEqual(byCat.header, ['category', 'count', 'sum of value', 'average of price']);
  assert.deepEqual(byCat.rows, [['book', 2, 25 * 40 + 9 * 300, 17], ['course', 2, 49 * 100 + 120 * 10, 84.5]]);
  const premium = runReport(site.reports[1], site.tables);
  assert.deepEqual(premium.rows, [['Music lessons', 120], ['Meditation course', 49], ['Logic book', 25]]);
  const r = runReport({ table: 'products', where: [{ column: 'name', op: 'contains', value: 'BOOK' }], measures: [{ fn: 'max', column: 'price' }, { fn: 'min', column: 'stock' }] }, site.tables);
  assert.deepEqual(r, { header: ['max of price', 'min of stock'], rows: [[25, 40]] });
  assert.deepEqual(runReport({ table: 'products', columns: ['name'], sort: { by: 'name' }, limit: 2 }, site.tables).rows, [['Breathing guide'], ['Logic book']]);
  assert.throws(() => runReport({ table: 'nope' }, site.tables), /no table called nope/);
});

test('the preview shows pages with variables, tables, reports and forms', () => {
  const site = sampleSite();
  const home = pageHTML(site, 'home');
  assert.match(home, /Welcome to My shop\./);
  assert.match(home, /<td>Meditation course<\/td><td>49<\/td>/);
  assert.match(pageHTML(site, 'reports'), /<h2>Products by category<\/h2>/);
  assert.match(pageHTML(site, 'join'), /<input type="text" name="email">/);
  assert.deepEqual(tableData(site, 'products', ['value']).rows[0], ['4900']);
  assert.deepEqual(reportData(site, 'by_category').rows[1], ['course', '2', '6100', '84.5']);
  assert.equal(show(2 / 3), '0.67');
  assert.equal(fill('Hi {{ who }} {{missing}}', { who: 'Ann' }), 'Hi Ann {{missing}}');
  assert.equal(slugOf('My Shop!'), 'my_shop');
});

test('the site as a Prolog program: facts, formulas, reports, pages and the runtime', () => {
  const p = siteProgram(sampleSite(), { port: 8095 });
  assert.match(p, /column\('products', 5, 'value', number, formula\(\('price'\*'stock'\)\)\)\./);
  assert.match(p, /row\('products', 1, \['name'-'Meditation course', 'category'-'course', 'price'-49, 'stock'-100\]\)\./);
  assert.match(p, /report\('premium', 'Products over \$20', 'products', \[where\('price', '>', 20\)\], '', \[\], sort\('price', desc\), 0, \['name', 'price'\]\)\./);
  assert.match(p, /page\('join', 'Join', \[text\('Join the list for news\. Questions: hello@example\.com'\), form\('signups', \['name', 'email'\], 'Thank you for joining!'\)\]\)\./);
  assert.match(p, /:- http_handler\(root\('reports'\), page_handler\('reports'\), \[\]\)\./);
  assert.match(p, /add_row_handler\(Request\) :-/);
  assert.equal(atom("it's"), "'it\\'s'");
  // balanced brackets, a cheap syntax check (CI runs it in SWI-Prolog)
  const code = p.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|%.*$/gm, '');
  for (const [o, c] of [['(', ')'], ['[', ']']]) assert.equal(code.split(o).length, code.split(c).length, `${o}${c} balanced`);
});

test('the funnel as a terminal program, in the patterns vetusiapl2webpl supports', () => {
  const f = sampleFunnel();
  const p = terminalProgram(f);
  assert.match(p, /^:- initialization\(main, main\)\.$/m);
  assert.match(p, /funnel_record\(visit, landing\),\n    writeln\('<h1>Calm in ten minutes a day<\/h1>'\)/);
  assert.match(p, /read_string\(user, "\\n", "\\r", _, Name\),\n    writeln\('Your email:'\),\n    read_string\(user, "\\n", "\\r", _, Email\),\n    funnel_record\(signup, \[Name, Email\]\)/);
  assert.match(p, /writeln\('1\. Yes, I want the course'\),\n    writeln\('2\. No thanks, just the free lesson'\)/);
  assert.match(p, /\(   Choice = "1"\n    ->  funnel_record\(checkout, Email\)/);
  assert.match(p, /<a href="https:\/\/buy\.stripe\.com\/test_00000000">Pay securely \$49<\/a>/);
  assert.match(p, /^funnel_record\(Event, Detail\) :-/m);
  assert.equal(fieldVar('e-mail address'), 'Emailaddress');
  assert.throws(() => terminalProgram({ ...f, landing: { ...f.landing, fields: [{ name: 'Password' }] } }), /password/);
  assert.throws(() => terminalProgram({ ...f, landing: { ...f.landing, fields: [] } }), /at least one field/);
  const noLink = terminalProgram({ ...f, paymentLink: '' });
  assert.ok(!/href/.test(noLink) && /<p>Your first lesson is on its way\. Complete your purchase here:<\/p>'\)\n    ;/.test(noLink));
  assert.deepEqual(previewPages(f).map((x) => x.step), ['landing', 'offer', 'thanks', 'declined']);
});

test('funnel tracking: events read back, and the figures add up', () => {
  const events = parseEvents(`funnel_event(1700000000.5, visit, landing).
funnel_event(1700000001.0, signup, ["Ann", "ann@example.com"]).
funnel_event(1700000002.0, checkout, "ann@example.com").
funnel_event(1700000003.0, visit, landing).
funnel_event(1700000004.0, signup, ['Ben', 'ben@example.com']).
funnel_event(1700000005.0, declined, 'ben@example.com').
funnel_event(1700000006.0, visit, landing).
`);
  assert.equal(events.length, 7);
  assert.deepEqual(events[1].detail, ['Ann', 'ann@example.com']);
  const s = funnelStats(events, { adSpend: 30, sales: [
    { id: 'a', amount: 49, email: 'ANN@example.com', status: 'paid' },
    { id: 'b', amount: 49, email: 'ben@example.com', status: 'refunded' },
    { id: 'c', amount: 15, email: 'someone@else.com', status: 'paid' }
  ] });
  assert.deepEqual([s.visits, s.signups, s.checkouts, s.declined, s.sales, s.revenue, s.unmatchedSales], [3, 2, 1, 1, 1, 49, 1]);
  assert.equal(s.signupRate, 66.7);
  assert.equal(s.checkoutRate, 50);
  assert.equal(s.profit, 19);
  assert.equal(s.returnOnSpend, 1.63);
  assert.equal(s.costPerSignup, 15);
  assert.equal(funnelStats(events, { since: 1700000003 }).visits, 2);
});

test('sales from Stripe, PayPal and Square come back in one shape', async () => {
  const stripe = PROVIDERS.stripe.parse({ data: [
    { id: 'ch_1', amount: 4900, currency: 'aud', created: 1700000000, status: 'succeeded', refunded: false, billing_details: { email: 'ann@example.com' } },
    { id: 'ch_2', amount: 4900, currency: 'aud', created: 1700000100, status: 'succeeded', refunded: true, receipt_email: 'ben@example.com' },
    { id: 'ch_3', amount: 100, currency: 'aud', created: 1700000200, status: 'failed' }
  ] });
  assert.deepEqual(stripe.map((s) => [s.id, s.amount, s.currency, s.email, s.status]), [['ch_1', 49, 'AUD', 'ann@example.com', 'paid'], ['ch_2', 49, 'AUD', 'ben@example.com', 'refunded'], ['ch_3', 1, 'AUD', '', 'failed']]);
  const paypal = PROVIDERS.paypal.parse({ transaction_details: [
    { transaction_info: { transaction_id: 'PP1', transaction_amount: { value: '49.00', currency_code: 'AUD' }, transaction_initiation_date: '2026-11-01T10:00:00+0000', transaction_status: 'S' }, payer_info: { email_address: 'cal@example.com' } },
    { transaction_info: { transaction_id: 'PP2', transaction_amount: { value: '-49.00', currency_code: 'AUD' }, transaction_status: 'S', transaction_event_code: 'T1107' } }
  ] });
  assert.deepEqual(paypal.map((s) => [s.id, s.amount, s.email, s.status]), [['PP1', 49, 'cal@example.com', 'paid'], ['PP2', -49, '', 'refunded']]);
  const square = PROVIDERS.square.parse({ payments: [{ id: 'sq1', amount_money: { amount: 4900, currency: 'AUD' }, created_at: '2026-11-02T00:00:00Z', status: 'COMPLETED', buyer_email_address: 'dee@example.com' }] });
  assert.deepEqual(square.map((s) => [s.id, s.amount, s.status, s.time]), [['sq1', 49, 'paid', 1793577600]]);
  // pages are followed until the provider says there are no more
  const replies = [{ data: [{ id: 'ch_a', amount: 100, created: 10, status: 'succeeded' }], has_more: true }, { data: [{ id: 'ch_b', amount: 200, created: 20, status: 'succeeded' }], has_more: false }];
  const urls = [];
  const sales = await readSales('stripe', { secretKey: 'sk_test' }, { since: 0, until: 100, fetchJSON: async (r) => { urls.push(r.url); assert.equal(r.headers.Authorization, 'Bearer sk_test'); return replies.shift(); } });
  assert.deepEqual(sales.map((s) => s.id), ['ch_a', 'ch_b']);
  assert.match(urls[1], /starting_after=ch_a/);
  assert.deepEqual(missing('paypal', { clientId: 'x' }), ['Secret']);
  await assert.rejects(readSales('square', {}, { fetchJSON: async () => ({}) }), /Square needs: Access token/);
  // PayPal: a token first, then 31-day windows
  const seen = [];
  await readSales('paypal', { clientId: 'id', secret: 's', sandbox: 'yes' }, { since: 0, until: 40 * 86400, fetchJSON: async (r) => { seen.push(r.url); return r.method === 'POST' ? { access_token: 'tok' } : { transaction_details: [] }; } });
  assert.match(seen[0], /^https:\/\/api-m\.sandbox\.paypal\.com\/v1\/oauth2\/token$/);
  assert.equal(seen.filter((u) => u.includes('/reporting/transactions')).length, 2);
});

test('publishing: run here first, then on a server, with commands that are safe to show', () => {
  assert.deepEqual(runSiteSpec({ file: 'shop.pl', port: 8095 }).args, ['shop.pl', '8095']);
  assert.deepEqual(convertFunnelSpec({ vetusia: 'GitHub/vetusiapl2webpl/', input: 'f.pl', output: 'w.pl', port: 8097 }).args,
    ['-q', '-g', 'main', '-s', 'GitHub/vetusiapl2webpl/src/vetusia_converter.pl', '--', 'f.pl', '-o', 'w.pl', '--port', '8097']);
  const plan = deployPlan({ host: 'example.com', user: 'lucian', dir: 'sites/shop', files: ['shop.pl'], run: 'shop.pl', port: 8095 });
  assert.equal(plan.url, 'http://example.com:8095/');
  assert.deepEqual(plan.steps.map((s) => s.cmd), ['ssh', 'scp', 'ssh']);
  assert.ok(plan.steps[2].args.at(-1).includes("nohup swipl 'shop.pl' 8095"));
  assert.throws(() => deployPlan({ host: 'bad host; rm -rf /', run: 'x.pl' }), /server address/);
  assert.throws(() => deployPlan({ host: 'example.com', dir: '../etc', run: 'x.pl' }), /folder/);
});
