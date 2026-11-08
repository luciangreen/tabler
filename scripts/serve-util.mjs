// Starting a SWI-Prolog server for the checks, and reading the HTML it serves.
import { spawn } from 'node:child_process';

export async function start(args, cwd, port) {
  const child = spawn('swipl', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://127.0.0.1:${port}/`); return { child, log: () => log }; } catch { await new Promise((r) => setTimeout(r, 200)); }
    if (child.exitCode !== null) break;
  }
  child.kill();
  throw new Error(`the server did not start on port ${port}:\n${log}`);
}

export const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// Every table in a page, as rows of cell texts (header row first).
export function tables(html) {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((m) => [...m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => text(c[1]))));
}

// The first form in a page: where it posts and its inputs.
export function form(html) {
  const f = /<form([^>]*)>([\s\S]*?)<\/form>/.exec(html);
  if (!f) return null;
  const attr = (s, name) => (new RegExp(`${name}="([^"]*)"`).exec(s) ?? new RegExp(`${name}='([^']*)'`).exec(s) ?? [])[1];
  const inputs = [...f[2].matchAll(/<(input|select)\b([^>]*)>/g)].map((m) => ({ tag: m[1], type: attr(m[2], 'type') ?? (m[1] === 'select' ? 'select' : 'text'), name: attr(m[2], 'name'), value: attr(m[2], 'value') ?? '' })).filter((i) => i.name);
  return { action: attr(f[1], 'action') ?? '', method: (attr(f[1], 'method') ?? 'get').toLowerCase(), inputs };
}
