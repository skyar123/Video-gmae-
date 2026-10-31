#!/usr/bin/env node
/**
 * Serves the built app with this repo's own function handlers behind it.
 *
 * `vite preview` serves the front end and nothing else, so every test written
 * against it has to point /api somewhere — and the obvious somewhere is the
 * deployed site. That means the harness exercises the code that is already
 * live rather than the code about to go out, which is exactly backwards when
 * the interesting changes are in the handlers or in the data they read.
 *
 * It mattered: rebuilding the store index left the library blurb quoting a
 * count the index had outgrown, and left every written-up game labelled "the
 * store mirror has no page for it" once the mirror had gained a page for most
 * of them. Neither was visible against the deployed build, because the
 * deployed build still had the old index.
 *
 * Anything without a local handler is proxied to the live site, so the page
 * is otherwise whole: news and gossip come from the real feeds while the
 * store comes from this working tree.
 *
 *   npm run build && npm run serve
 *   npm run serve -- --port 4178 --no-proxy
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const LIVE = 'https://ps5-upgrade-catalog.netlify.app';

const args = process.argv.slice(2);
/*
 * 4190 is the ManageSieve port, which is on the Fetch specification's blocked
 * list. Browsers and node's own fetch both refuse to open it, so the default
 * server could be curled but never driven from a page or a test, which is
 * most of the reason it exists. PORT is read too, so a harness can pick one
 * without rewriting the argument list.
 */
const DEFAULT_PORT = 4178;
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || DEFAULT_PORT;
const proxy = !args.includes('--no-proxy');

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
};

/** Every function that declares an /api path, mounted at the path it declares. */
const handlers = new Map();
const { readdir } = await import('node:fs/promises');
for (const file of (await readdir(join(ROOT, 'netlify/functions'))).filter((f) => f.endsWith('.mjs'))) {
  try {
    const module = await import(join(ROOT, 'netlify/functions', file));
    const path = module.config?.path;
    if (path && typeof module.default === 'function') handlers.set(path, module.default);
  } catch (error) {
    console.log(`  skipped ${file}: ${String(error.message ?? error).slice(0, 70)}`);
  }
}

const send = (res, status, type, body) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  const handler = handlers.get(url.pathname);

  if (handler) {
    try {
      const body = request.method === 'POST' ? await readBody(request) : undefined;
      const result = await handler(new Request(url.href, { method: request.method, body }));
      send(response, result.status, result.headers.get('content-type') ?? 'application/json', await result.text());
    } catch (error) {
      console.log(`${url.pathname} threw: ${String(error.message ?? error).slice(0, 120)}`);
      send(response, 500, 'application/json', JSON.stringify({ error: String(error.message ?? error) }));
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (!proxy) return send(response, 404, 'application/json', '{}');
    try {
      const upstream = await fetch(`${LIVE}${url.pathname}${url.search}`, { signal: AbortSignal.timeout(45_000) });
      send(response, upstream.status, 'application/json', await upstream.text());
    } catch {
      send(response, 502, 'application/json', '{}');
    }
    return;
  }

  // The type comes from the file actually served: "/" has no extension, and
  // guessing from the request path offered the whole app as a download.
  const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  const file = safe === '/' ? 'index.html' : safe;
  try {
    const data = await readFile(join(DIST, file));
    send(response, 200, TYPES[extname(file)] ?? 'application/octet-stream', data);
  } catch {
    // A single-page app: an unknown path is a route, not a missing file.
    send(response, 200, 'text/html', await readFile(join(DIST, 'index.html')));
  }
}).listen(port, () => {
  console.log(`app on http://localhost:${port}`);
  console.log(`local handlers: ${[...handlers.keys()].sort().join(' ') || 'none'}`);
  console.log(proxy ? `anything else proxied to ${LIVE}` : 'proxy off: unhandled /api returns 404');
});

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}
