// Sales from a payment provider, chosen per funnel, behind one interface. Each provider has
// the requests to make and a parser that turns its reply into the same shape:
//   { provider, id, amount (in dollars, not cents), currency, time (seconds), email, status }
// with status 'paid', 'refunded', 'pending' or 'failed'. The requests are made by
// scripts/fetch-sales.mjs, run as a LucianOS job, so keys never pass through the browser page
// and are sent only to the provider.

export const PROVIDERS = {
  stripe: {
    name: 'Stripe',
    needs: [{ key: 'secretKey', label: 'Secret key (sk_live_… or a restricted key with read access to charges)' }],
    requests: ({ secretKey }, { since = 0, startingAfter = null } = {}) => [{
      url: `https://api.stripe.com/v1/charges?limit=100&created[gte]=${Math.floor(since)}${startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : ''}`,
      headers: { Authorization: `Bearer ${secretKey}` }
    }],
    parse: (json) => (json.data ?? []).map((c) => ({
      provider: 'stripe', id: c.id, amount: (c.amount ?? 0) / 100, currency: String(c.currency ?? '').toUpperCase(), time: c.created ?? 0,
      email: c.billing_details?.email ?? c.receipt_email ?? '',
      status: c.refunded ? 'refunded' : c.status === 'succeeded' ? 'paid' : c.status === 'pending' ? 'pending' : 'failed'
    })),
    next: (json) => (json.has_more && json.data?.length ? json.data[json.data.length - 1].id : null)
  },
  paypal: {
    name: 'PayPal',
    needs: [{ key: 'clientId', label: 'Client ID' }, { key: 'secret', label: 'Secret' }, { key: 'sandbox', label: 'Sandbox (yes/no)', optional: true }],
    base: ({ sandbox }) => (/^(y|yes|true|1)$/i.test(String(sandbox ?? '')) ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com'),
    tokenRequest: (c) => ({
      url: `${PROVIDERS.paypal.base(c)}/v1/oauth2/token`, method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    }),
    // PayPal reports at most 31 days at a time
    requests: (c, { since = 0, until = Date.now() / 1000, token, page = 1 } = {}) => {
      const out = [];
      for (let start = Math.max(since, until - 3 * 365 * 86400); start < until; start += 31 * 86400) {
        const end = Math.min(until, start + 31 * 86400 - 1);
        out.push({ url: `${PROVIDERS.paypal.base(c)}/v1/reporting/transactions?start_date=${new Date(start * 1000).toISOString().replace(/\.\d+Z$/, 'Z')}&end_date=${new Date(end * 1000).toISOString().replace(/\.\d+Z$/, 'Z')}&fields=transaction_info,payer_info&page_size=500&page=${page}`, headers: { Authorization: `Bearer ${token}` } });
      }
      return out;
    },
    parse: (json) => (json.transaction_details ?? []).map((t) => {
      const i = t.transaction_info ?? {};
      const amount = Number(i.transaction_amount?.value ?? 0);
      return {
        provider: 'paypal', id: i.transaction_id, amount, currency: i.transaction_amount?.currency_code ?? '',
        time: Math.floor(Date.parse(i.transaction_initiation_date ?? 0) / 1000) || 0, email: t.payer_info?.email_address ?? '',
        status: amount < 0 || i.transaction_event_code?.startsWith('T11') ? 'refunded' : i.transaction_status === 'S' ? 'paid' : i.transaction_status === 'P' ? 'pending' : 'failed'
      };
    }).filter((s) => s.amount > 0 || s.status === 'refunded')
  },
  square: {
    name: 'Square',
    needs: [{ key: 'accessToken', label: 'Access token' }, { key: 'sandbox', label: 'Sandbox (yes/no)', optional: true }],
    requests: (c, { since = 0, cursor = null } = {}) => [{
      url: `${/^(y|yes|true|1)$/i.test(String(c.sandbox ?? '')) ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com'}/v2/payments?begin_time=${encodeURIComponent(new Date(since * 1000).toISOString())}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      headers: { Authorization: `Bearer ${c.accessToken}`, 'Square-Version': '2024-01-18' }
    }],
    parse: (json) => (json.payments ?? []).map((p) => ({
      provider: 'square', id: p.id, amount: (p.amount_money?.amount ?? 0) / 100, currency: p.amount_money?.currency ?? '',
      time: Math.floor(Date.parse(p.created_at ?? 0) / 1000) || 0, email: p.buyer_email_address ?? '',
      status: (p.refunded_money?.amount ?? 0) >= (p.amount_money?.amount ?? 1) ? 'refunded' : p.status === 'COMPLETED' ? 'paid' : p.status === 'APPROVED' || p.status === 'PENDING' ? 'pending' : 'failed'
    })),
    next: (json) => json.cursor ?? null
  }
};

// Which credentials a funnel still needs before sales can be read.
export function missing(provider, credentials = {}) {
  const p = PROVIDERS[provider];
  if (!p) return [];
  return p.needs.filter((n) => !n.optional && !String(credentials[n.key] ?? '').trim()).map((n) => n.label);
}

// Reads every page of sales since a time. fetchJSON(request) -> parsed JSON (injected, so the
// script uses real fetch and the tests use recorded replies).
export async function readSales(provider, credentials, { since = 0, until = Date.now() / 1000, fetchJSON }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`unknown payment provider ${provider}`);
  const gaps = missing(provider, credentials);
  if (gaps.length) throw new Error(`${p.name} needs: ${gaps.join(', ')}`);
  const sales = [];
  if (provider === 'paypal') {
    const token = (await fetchJSON(p.tokenRequest(credentials))).access_token;
    if (!token) throw new Error('PayPal did not give an access token: check the client ID and secret');
    for (const req of p.requests(credentials, { since, until, token })) sales.push(...p.parse(await fetchJSON(req)));
  } else {
    let after = null;
    for (let pages = 0; pages < 50; pages++) {
      const opts = provider === 'stripe' ? { since, startingAfter: after } : { since, cursor: after };
      const json = await fetchJSON(p.requests(credentials, opts)[0]);
      sales.push(...p.parse(json));
      after = p.next(json);
      if (!after) break;
    }
  }
  const seen = new Set();
  return sales.filter((s) => s.time <= until && !seen.has(s.id) && seen.add(s.id)).sort((a, b) => a.time - b.time);
}
