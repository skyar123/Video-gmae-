/**
 * Does every surface still render?
 *
 * The unit tests cover the model and the handlers, and check-functions covers
 * the bundling, but neither opens the app. Most of what has gone wrong in it
 * went wrong in the wiring: a prop removed from a component that still read
 * it, a list that re-ranked under the reader's finger, a card that did
 * nothing when tapped. Those are invisible to a test that never renders a
 * page, and with deploys blocked there is no staging environment to catch
 * them later either.
 *
 * So this opens the real build, with the real functions behind it, on every
 * collection, filter combination and view the app has, as somebody who has
 * owned, wanted, rated and hidden things. It looks for an uncaught error, a
 * failed request, a blank page, and for a surface that came back smaller than
 * it should have.
 *
 * That last one is here because the first version of this file did not have
 * it and was useless without it. Deleting the picks endpoint outright left
 * For you rendering 48 cards instead of 94, the entire store half gone, and
 * the check said ok: it had asked whether the page rendered, and the page had
 * rendered. A surface quietly coming back half empty is the shape most of
 * these failures actually take.
 *
 *   npm run smoke
 */
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Playwright, from wherever it is.
 *
 * It is not a dependency of this project and should not become one: it would
 * add a browser download to every install for a check that runs by hand. So
 * it is used where it is already present, which is usually a global install,
 * and a clear word is better than a stack trace when it is not there at all.
 */
async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    try {
      const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
      return await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
    } catch {
      console.error('This needs playwright. Install it globally (npm i -g playwright) or locally.');
      process.exit(1);
    }
  }
}

const { chromium } = await loadPlaywright();

const PORT = Number(process.env.PORT) || 4219;
const BASE = `http://localhost:${PORT}`;

/*
 * Only the app's own requests are judged here.
 *
 * Art and trailers come from PlayStation's and Steam's hosts, and
 * /api/concept goes out to the store for the detail behind a game. None of
 * that is reachable from a sandbox and none of it is this app's doing; what
 * matters is that the page carries on around it, which is what the render
 * checks below are for. So anything that is not served by this server, plus
 * the one endpoint that is a proxy for somewhere else, is left alone.
 */
const mine = (url) => url.startsWith(BASE) && !url.includes('/api/concept');

/** A reader with a history, so the personalised surfaces have something to do. */
const seed = () => {
  localStorage.clear();
  localStorage.setItem('library', JSON.stringify(['hades', 'celeste']));
  localStorage.setItem('wishlist', JSON.stringify(['hollow-knight']));
  localStorage.setItem('ratings', JSON.stringify({
    'stardew-valley': 'like',
    unpacking: 'like',
    'doom-eternal': 'dislike',
  }));
  localStorage.setItem('hidden', JSON.stringify(['outer-wilds']));
};

/*
 * `least` is how few cards a surface may show and still be working. They are
 * set well under what each one currently returns, so ordinary drift in the
 * catalog or a sale ending does not fail the run, while half a surface going
 * missing does. A surface that is meant to come back empty says 0.
 */
const SURFACES = [
  ['', 'All', 20],
  ['?view=deals', 'Deals', 1],
  ['?view=plus', 'PS Plus', 20],
  ['?view=genius', 'For you', 70],
  ['?view=curated', 'Curated', 30],
  ['?view=soon', 'Soon', 10],
  ['?view=cozy', 'Cozy', 10],
  ['?mode=feed', 'Feed', 10],
  ['?view=genius&new=1', 'For you + new', 10],
  ['?view=genius&kids=1', 'For you + kid friendly', 40],
  ['?view=genius&nomtx=1', 'For you + no purchases', 40],
  ['?view=genius&genre=Metroidvania', 'For you + a written-up genre', 5],
  ['?view=genius&genre=Action', 'For you + a store genre', 40],
  ['?q=hollow', 'Search with hits', 1],
  ['?q=zzzznotagame', 'Search with none', 0],
  ['?view=all&wishlist=1', 'Wishlist', 1],
  ['?view=curated&sale=1', 'On sale', 1],
  ['?view=curated&wishlist=1', 'Wishlist, empty, in a collection', 0],
];

const server = spawn('node', ['scripts/serve-local.mjs', '--port', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
const stop = () => server.kill();
process.on('exit', stop);

/** Waiting for a port to answer beats guessing how long a server takes. */
const ready = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(BASE + '/');
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

if (!(await ready())) {
  console.error(`no server on ${BASE} after 30s`);
  stop();
  process.exit(1);
}

const browser = await chromium.launch();
let failures = 0;

for (const [query, label, least] of SURFACES) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    /*
     * A failed request logs here with no URL in it, so there is nothing to
     * judge: the response listener below sees the same failure and knows
     * what it was for. Judging this text would mean either ignoring every
     * failed request or flagging every one.
     */
    if (/Failed to load resource/i.test(text)) return;
    problems.push(`console: ${text.slice(0, 110)}`);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    if (!mine(url)) return;
    problems.push(`${response.status()} ${url.replace(BASE, '').slice(0, 90)}`);
  });
  /*
   * A request that never gets an answer raises nothing above, and a POST to a
   * missing endpoint is one of those.
   *
   * Aborts are not failures. A page that navigates, or a component that
   * unmounts, cancels whatever it had in flight, and counting those made
   * every surface here fail on requests the app had deliberately dropped.
   */
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!mine(url)) return;
    const reason = request.failure()?.errorText ?? '';
    if (/ABORTED/i.test(reason)) return;
    problems.push(`${reason || 'no answer'}: ${url.replace(BASE, '').slice(0, 70)}`);
  });

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(seed);
    await page.goto(`${BASE}/${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3200);
    if ((await page.locator('header').count()) === 0) problems.push('nothing rendered');
    const cards = await page.locator('main h2, section h2, section h3').count();
    if (cards < least) problems.push(`only ${cards} cards, expected at least ${least}`);
    if (problems.length > 0) failures += 1;
    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${String(cards).padStart(4)} cards` +
        (problems.length ? `  ${problems[0]}` : ''),
    );
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${label.padEnd(32)} threw: ${String(error.message).slice(0, 70)}`);
  }
  await page.close();
}

await browser.close();
stop();

if (failures > 0) {
  console.error(`\n${failures} of ${SURFACES.length} surfaces have problems.`);
  process.exit(1);
}
console.log(`\nall ${SURFACES.length} surfaces render, with nothing thrown`);
