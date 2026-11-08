// Reads sales from Stripe, PayPal or Square and prints them as JSON, one line.
// Run as a LucianOS job (node is an allowed command). The request comes on standard input,
// so keys are never on the command line:
//   echo '{"provider":"stripe","credentials":{"secretKey":"sk_…"},"since":1700000000}' | node scripts/fetch-sales.mjs
import { readSales } from '../lib/payments.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const { provider, credentials, since = 0, until } = JSON.parse(input);
  const fetchJSON = async (req) => {
    const res = await fetch(req.url, { method: req.method ?? 'GET', headers: req.headers, body: req.body });
    const text = await res.text();
    if (!res.ok) throw new Error(`${new URL(req.url).host} said ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  };
  const sales = await readSales(provider, credentials ?? {}, { since, until: until ?? Date.now() / 1000, fetchJSON });
  process.stdout.write(`SALES ${JSON.stringify(sales)}\n`);
} catch (err) {
  process.stdout.write(`SALES_ERROR ${err.message}\n`);
  process.exitCode = 1;
}
