/**
 * Will the functions survive a deploy?
 *
 * Everything else in this repo can be checked by running it: the tests run
 * the modules, and the local server mounts the handlers straight from source.
 * Neither touches the one step that only happens on Netlify, which is esbuild
 * bundling each function and whatever it imports into a single file. A broken
 * import there is a deploy that fails after the fact, and that failure is
 * expensive to find when deploys are rationed or blocked.
 *
 * So this does that step here. It bundles every function the way netlify.toml
 * says to, reports what each one weighs, and refuses to pass if any of them
 * cannot be built. It caught nothing the day it was written, which is the
 * point: it says the next deploy will get further than the last one did.
 *
 *   npm run check:functions
 */
import { readdirSync } from 'node:fs';
import { stat, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const FUNCTIONS = join(ROOT, 'netlify/functions');

/*
 * Pinned, and fetched rather than depended on. Netlify brings its own esbuild
 * and this repo has no use for one otherwise, so adding it to package.json
 * would mean carrying a build tool for a check that runs occasionally.
 */
const ESBUILD = 'esbuild@0.25.0';

/** Provided by the Netlify runtime, so not bundled and not resolvable here. */
const PROVIDED = ['@netlify/*', 'web-push'];

/** Netlify's own ceiling is 50MB zipped; this is the unzipped warning line. */
const HEAVY_KB = 12_000;

const files = readdirSync(FUNCTIONS).filter((name) => name.endsWith('.mjs'));
if (files.length === 0) {
  console.error('no functions found');
  process.exit(1);
}

const out = await mkdtemp(join(tmpdir(), 'fn-bundle-'));
let failed = 0;
let heavy = 0;

for (const file of files.sort()) {
  const name = file.replace(/\.mjs$/, '');
  const target = join(out, `${name}.js`);
  try {
    await run('npx', [
      '-y',
      ESBUILD,
      join(FUNCTIONS, file),
      '--bundle',
      '--platform=node',
      '--target=node22',
      '--format=esm',
      ...PROVIDED.map((pkg) => `--external:${pkg}`),
      `--outfile=${target}`,
      '--log-level=error',
    ]);
    const { size } = await stat(target);
    const kb = Math.round(size / 1024);
    if (kb > HEAVY_KB) heavy += 1;
    console.log(`  ${name.padEnd(24)} ${String(kb).padStart(6)} KB${kb > HEAVY_KB ? '  heavy' : ''}`);
  } catch (error) {
    failed += 1;
    console.log(`  ${name.padEnd(24)} will not bundle`);
    const detail = String(error.stderr || error.message).trim().split('\n').slice(0, 6);
    for (const line of detail) console.log(`      ${line}`);
  }
}

await rm(out, { recursive: true, force: true });

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} functions would fail the deploy.`);
  process.exit(1);
}
console.log(
  `\nall ${files.length} functions bundle` +
    (heavy > 0 ? `, ${heavy} over ${HEAVY_KB / 1000}MB unzipped and worth watching` : ''),
);
