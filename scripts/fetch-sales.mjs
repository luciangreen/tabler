// Reads sales from Stripe, PayPal or Square and prints them as JSON, one line.
// Run as a LucianOS job (node is an allowed command). The request comes on standard input,
// so keys are never on the command line:
//   echo '{"provider":"stripe","credentials":{"secretKey":"sk_…"},"since":1700000000}' | node scripts/fetch-sales.mjs
// or, so keys never pass through the Tabler page either, a keys file you fill in yourself:
//   echo '{"provider":"stripe","keysFile":".lucianoffice/payment-keys.json"}' | node scripts/fetch-sales.mjs
// (relative to your home folder; it holds {"stripe":{"secretKey":"…"},"paypal":{…},"square":{…}})
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRequest } from './request.mjs';
import { readSales } from '../lib/payments.js';

try {
  const { provider, credentials: given, keysFile, since = 0, until } = await readRequest();
  let credentials = given;
  if (keysFile) {
    const file = path.isAbsolute(keysFile) ? keysFile : path.join(os.homedir(), keysFile);
    if (!fs.existsSync(file)) throw new Error(`there is no keys file at ${keysFile} yet`);
    credentials = JSON.parse(fs.readFileSync(file, 'utf8'))[provider] ?? {};
  }
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
