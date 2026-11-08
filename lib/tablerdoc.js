// A Tabler document: one Lucian Office document whose data holds the site and the funnel,
// changed with "data" ops so every edit (yours or the character's) can be undone.
import { createDocument } from './core.js';
import { sampleSite } from './db.js';
import { sampleFunnel } from './funnel.js';

export const newTablerDoc = ({ site = sampleSite(), funnel = sampleFunnel(), title = 'My shop' } = {}) =>
  createDocument({ app: 'tabler', title, data: { site, funnel } });

export const siteOf = (doc) => doc.data.site;
export const funnelOf = (doc) => doc.data.funnel;
const copy = (x) => JSON.parse(JSON.stringify(x));

// Ops that change the site (or funnel) by a function applied to a copy.
export const siteOps = (doc, f) => { const s = copy(siteOf(doc)); f(s); return [{ op: 'data', key: 'site', value: s }]; };
export const funnelOps = (doc, f) => { const s = copy(funnelOf(doc)); f(s); return [{ op: 'data', key: 'funnel', value: s }]; };
