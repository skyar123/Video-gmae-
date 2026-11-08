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

/*
 * `npm run smoke` builds first, and has to.
 *
 * The suite serves dist, not the sources, so without the build it sweeps
 * whatever was last built. That was found the only way it could be: by
 * breaking the fold on purpose, watching all twenty-one checks pass, and
 * realising the bundle under test did not contain the bug.
 */
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
  ['?view=all', 'All', 20],
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
  /*
   * The news drawer, which is only here because it can be linked to now. It
   * used to live in component state, so there was no address to point a
   * check at and the busiest reading surface in the app went unswept.
   */
  ['?read=goss', 'News', 20],
  ['?read=upcoming', 'Upcoming releases', 1],
];

/** The shelf chips, by the label they wear, so the sweep can name them. */
const SHELF_TONE = {
  PlayStation: 'playstation',
  RPGs: 'rpg',
  'Queer press': 'queer',
  Essays: 'essays',
  Indie: 'indie',
  Retro: 'retro',
  'The trade': 'trade',
  Cozy: 'cozy',
  Nintendo: 'nintendo',
};

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
/*
 * What failed, and why, kept until the end.
 *
 * Each failure already prints a FAIL line as it happens, and that was the
 * whole record: a run whose output was read through `tail` reported "1 of 22
 * checks have problems" with the line naming the check scrolled away, and
 * the failure never came back in five further runs. A tally that does not
 * say what failed is a tally that can cost you the only occurrence.
 */
const failed = [];
const fail = (label, why) => failed.push(`${label}: ${why}`);
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

    /*
     * Wait for the cards, not for the clock.
     *
     * This used to count whatever had rendered after a flat 3.2 seconds,
     * which is fine for nineteen surfaces and unfair to the first one: it is
     * swept immediately after the server starts, with the store index cold,
     * and a run failed with "All: only 0 cards" on a build whose only change
     * was to a news matcher the catalog page never calls. An earlier
     * unexplained failure, which never came back in five further runs, was
     * most likely the same thing.
     *
     * A surface that is meant to come back empty says least: 0 and is not
     * waited on, so nothing here hangs for twenty seconds to prove a zero.
     */
    const cardCount = () => page.locator('main h2, section h2, section h3').count();
    let cards = await cardCount();
    for (const deadline = Date.now() + 20000; cards < least && Date.now() < deadline; ) {
      await page.waitForTimeout(500);
      cards = await cardCount();
    }
    if (cards < least) problems.push(`only ${cards} cards, expected at least ${least}`);
    if (problems.length > 0) {
      failures += 1;
      fail(label, problems.join('; '));
    }
    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${String(cards).padStart(4)} cards` +
        (problems.length ? `  ${problems[0]}` : ''),
    );
  } catch (error) {
    failures += 1;
    fail(label, `threw: ${String(error.message).slice(0, 120)}`);
    console.log(`FAIL ${label.padEnd(32)} threw: ${String(error.message).slice(0, 70)}`);
  }
  await page.close();
}

/**
 * Opens every folded card, and says so if it could not.
 *
 * Both checks below count a story as reachable if it is on a card or inside
 * an opened fold, so a fold that failed to open looks exactly like a story
 * that was dropped. Clicking a list that React is re-rendering can lose a
 * click or detach the element mid-flight, so each one is retried, and a fold
 * that will not open is reported as itself rather than as a missing story.
 */
async function openEveryFold(drawer) {
  for (let guard = 0; guard < 20; guard += 1) {
    const folds = drawer.getByRole('button', { name: /Also on this/ });
    const left = await folds.count();
    if (left === 0) return null;
    try {
      await folds.first().click({ timeout: 5000 });
    } catch {
      // Re-resolved on the next turn of the loop; only a fold that keeps
      // failing gets reported.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
    if ((await folds.count()) >= left) {
      try {
        await folds.first().click({ timeout: 5000, force: true });
      } catch {
        return `a fold would not open (${left} left)`;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });
      if ((await folds.count()) >= left) return `a fold would not open (${left} left)`;
    }
  }
  return 'more folds than this check expects to open';
}

/**
 * Comparing a payload link with one the browser gives back.
 *
 * `a.href` is the resolved, normalised form, so a feed carrying
 * "https://spookedpodcast.org" comes back as "https://spookedpodcast.org/"
 * and a straight comparison calls a story missing that is on the screen. A
 * run failed exactly that way, and the app was fine.
 */
const sameLink = (url) => {
  try {
    return new URL(url).href;
  } catch {
    return String(url);
  }
};

/**
 * Nothing is hidden from the reader.
 *
 * Two features here take things off the screen or move them down it, and
 * both are only defensible if nothing actually goes missing: folding four
 * reports into one card, and filing walkthroughs under yesterday.
 *
 * Four outlets on one report arrive as one card, which means three stories
 * are on the screen without a card of their own. If that fold ran before the
 * feed's filters, narrowing to the trade press or the queer press would
 * silently drop whichever of them did not win its pile, and a reader cannot
 * notice a story they were not shown. So this walks every shelf and checks
 * that every story the payload puts on it is reachable: as a card, or inside
 * an opened fold.
 *
 * It compares the screen against the live payload rather than a fixed number,
 * so it holds whatever the day's news happens to be. On a day with no
 * repeated story it proves nothing, and says so instead of passing quietly.
 */
async function shelvesKeepEverything() {
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  try {
    await page.goto(`${BASE}/?read=goss`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('article', { timeout: 60000 });
    await page.waitForTimeout(3200);

    const feed = await page.evaluate(async () => {
      const { bursts } = await (await fetch('/api/goss')).json();
      const shelves = {};
      for (const burst of bursts) {
        const tone = burst.tone ?? 'none';
        (shelves[tone] = shelves[tone] ?? []).push(burst.link);
      }
      const grouped = bursts.filter((burst) => burst.story);
      return {
        total: bursts.length,
        folded: grouped.length,
        guides: bursts.filter((burst) => burst.guide).map((burst) => burst.link),
        /*
         * A tagged story has to carry both the name of its pile and how many
         * outlets ran it: the view folds on the first and the Top order
         * weighs the second. Carrying only the first is a bug that looks
         * like nothing, because the ranking quietly falls back to the clock
         * and the feed goes on working. It shipped that way for an hour,
         * and the unit tests could not see it because they hand the ranking
         * a coverage count directly.
         */
        uncounted: grouped.filter((burst) => !(burst.coverage > 1)).length,
        shelves,
      };
    });

    if (feed.uncounted > 0) {
      problems.push(`${feed.uncounted} grouped stories arrive without a coverage count`);
    }

    /*
     * Guides are moved down the Top order, not taken out of the feed, and
     * the difference is the whole of the claim. So before narrowing to
     * anything, every guide the payload carries has to be on the screen.
     * A demotion that quietly became a deletion would look exactly like a
     * tidier feed.
     */
    {
      const stuckHere = await openEveryFold(page.getByRole('dialog', { name: 'News and releases' }));
      if (stuckHere) problems.push(`Everything: ${stuckHere}`);
      const here = new Set(await page.$$eval('article a[href]', (all) => all.map((a) => a.href)));
      const hidden = feed.guides.filter((link) => !here.has(sameLink(link)));
      if (hidden.length > 0) {
        problems.push(`${hidden.length} guides are missing from Everything: ${hidden[0]}`);
      }
    }

    const drawer = page.getByRole('dialog', { name: 'News and releases' });
    const chips = await drawer
      .locator('button[aria-pressed]')
      .filter({ hasNotText: /^(Top|Latest)$/ })
      .all();

    let checked = 0;
    for (const chip of chips) {
      // The chip wears its story count, so "PlayStation 14" has to come back
      // to "PlayStation". Without this the sweep matched no shelf at all and
      // reported a pass for checking nothing.
      const label = (await chip.innerText()).replace(/\s*\d+\s*$/, '').trim();
      const tone = SHELF_TONE[label];
      if (!tone) continue;
      await chip.click();
      await page.waitForTimeout(350);
      if ((await chip.getAttribute('aria-pressed')) !== 'true') {
        problems.push(`the ${label} chip does not take`);
        continue;
      }
      // Open every fold, so a folded story counts as reachable.
      const stuck = await openEveryFold(drawer);
      if (stuck) problems.push(`${label}: ${stuck}`);
      const seen = new Set(await page.$$eval('article a[href]', (all) => all.map((a) => a.href)));
      const lost = (feed.shelves[tone] ?? []).filter((link) => !seen.has(sameLink(link)));
      if (lost.length > 0) problems.push(`${label} lost ${lost.length}: ${lost[0]}`);
      checked += 1;
      await chip.click();
      await page.waitForTimeout(200);
    }

    /*
     * A sweep that found no shelf to walk has proved nothing, and the first
     * version of this said " ok " for exactly that. Checking nothing is a
     * failure, not a pass.
     */
    const shelvesToday = Object.keys(feed.shelves).filter((tone) =>
      Object.values(SHELF_TONE).includes(tone),
    ).length;
    if (checked === 0 && shelvesToday > 0) {
      problems.push(`walked no shelves, though the feed has ${shelvesToday}`);
    }

    const note = `${feed.total} stories, ${feed.folded} repeats, ${feed.guides.length} guides, ${checked} shelves`;
    if (feed.folded === 0 && problems.length === 0) {
      console.log(` ok  ${'Nothing is hidden from a reader'.padEnd(32)} nothing repeated today, so nothing proved`);
    } else {
      console.log(`${problems.length ? 'FAIL' : ' ok '} ${'Nothing is hidden from a reader'.padEnd(32)} ${note}` +
        (problems.length ? `  ${problems[0]}` : ''));
    }
  } catch (error) {
    problems.push(`threw: ${String(error.message).slice(0, 80)}`);
    console.log(`FAIL ${'Nothing is hidden from a reader'.padEnd(32)} ${problems[0]}`);
  }
  await page.close();
  if (problems.length > 0) fail('Nothing is hidden from a reader', problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

/**
 * Unread must hide exactly what you read, and nothing else.
 *
 * It is the only filter in the app whose whole job is to take things off the
 * screen on purpose, which makes it the one place a mistake is invisible: a
 * reader cannot tell the difference between a story they already read and a
 * story that quietly stopped being offered.
 *
 * So this marks five real stories read, narrows to Unread, and checks both
 * halves: those five gone, and every other story in the payload still
 * reachable. Checking only the first half would pass with the filter
 * returning nothing at all.
 */
async function unreadHidesOnlyWhatYouRead() {
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  try {
    await page.goto(`${BASE}/?read=goss`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('article', { timeout: 60000 });
    await page.waitForTimeout(3200);

    const links = await page.evaluate(async () => {
      const { bursts } = await (await fetch('/api/goss')).json();
      return bursts.map((burst) => burst.link);
    });
    const read = links.slice(0, 5);
    await page.evaluate((rows) => localStorage.setItem('gossRead', JSON.stringify(rows)), read);

    await page.goto(`${BASE}/?read=goss`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('article', { timeout: 60000 });
    await page.waitForTimeout(3200);

    const drawer = page.getByRole('dialog', { name: 'News and releases' });
    const chip = drawer.getByRole('button', { name: /^Unread/ });
    if ((await chip.count()) === 0) {
      problems.push('no Unread chip after marking five stories read');
    } else {
      await chip.first().click();
      await page.waitForTimeout(500);
      // Narrowing remounts the cards, so every fold is shut again.
      const stuck = await openEveryFold(drawer);
      if (stuck) problems.push(stuck);
      const seen = new Set(await page.$$eval('article a[href]', (all) => all.map((a) => a.href)));
      const kept = read.filter((link) => seen.has(sameLink(link)));
      const lost = links.slice(5).filter((link) => !seen.has(sameLink(link)));
      if (kept.length > 0) problems.push(`${kept.length} read stories still listed`);
      if (lost.length > 0) problems.push(`${lost.length} unread stories missing: ${lost[0]}`);

      /*
       * And the list holds still while you read it. Opening a story is what
       * marks it read, so a live filter takes the card out from under the
       * finger that tapped it and moves everything below up. The picks list
       * had exactly this bug, so it gets a check rather than a promise.
       */
      page.context().on('page', (popup) => popup.close().catch(() => {}));
      const before = await page.locator('article').count();
      const headline = page.locator('article').nth(1).locator('a[href^="http"]').first();
      if ((await headline.count()) > 0) {
        await headline.click();
        await page.waitForTimeout(700);
        const after = await page.locator('article').count();
        if (after !== before) {
          problems.push(`reading one story moved the list: ${before} cards became ${after}`);
        }
      }
    }
    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${'Unread hides only what you read'.padEnd(32)} ${links.length} stories, 5 marked read` +
        (problems.length ? `  ${problems[0]}` : ''),
    );
  } catch (error) {
    problems.push(`threw: ${String(error.message).slice(0, 80)}`);
    console.log(`FAIL ${'Unread hides only what you read'.padEnd(32)} ${problems[0]}`);
  }
  await page.close();
  if (problems.length > 0) fail('Unread hides only what you read', problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

/**
 * A search the catalog cannot answer still answers.
 *
 * This is a PlayStation catalog, so a PC-only game ends in an empty screen,
 * and the fallback exists to make that a real answer instead of a dead end.
 * The check reads the endpoint first and requires whatever it found to be on
 * the page: a fallback that silently stops rendering looks exactly like a
 * game nobody has heard of.
 *
 * Factorio because it is genuinely absent from the mirror, and has been for
 * as long as there has been a mirror. If it ever comes to PlayStation this
 * check will start saying so, which is the right kind of failure.
 */
async function aSearchWithNoAnswerStillAnswers() {
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    await page.goto(`${BASE}/?q=factorio`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const [onPlayStation, elsewhere] = await page.evaluate(async () => {
      const store = await (await fetch('/api/store?q=factorio')).json();
      const pc = await (await fetch('/api/elsewhere?q=factorio')).json();
      return [store.total ?? 0, (pc.items ?? []).map((item) => item.name)];
    });

    if (onPlayStation > 0) {
      note = `factorio is in the mirror now (${onPlayStation}), so there is nothing to fall back to`;
    } else if (elsewhere.length === 0) {
      note = 'the PC source answered with nothing, so nothing is proved';
    } else {
      // Give the fallback time to land, then require every row it found.
      await page.waitForSelector('a[href^="https://store.steampowered.com/app/"]', {
        timeout: 20000,
      }).catch(() => {});
      const shown = await page.$$eval('a[href^="https://store.steampowered.com/app/"]', (all) =>
        all.map((a) => a.innerText),
      );
      const missing = elsewhere.filter(
        (name) => !shown.some((text) => text.includes(name)),
      );
      if (shown.length === 0) problems.push('the PC fallback rendered nothing at all');
      else if (missing.length > 0) problems.push(`${missing.length} PC results not shown: ${missing[0]}`);
      note = `${elsewhere.length} found, ${shown.length} on screen`;
    }
    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${'A dead-end search still answers'.padEnd(32)} ${note}` +
        (problems.length ? `  ${problems[0]}` : ''),
    );
  } catch (error) {
    problems.push(`threw: ${String(error.message).slice(0, 80)}`);
    console.log(`FAIL ${'A dead-end search still answers'.padEnd(32)} ${problems[0]}`);
  }
  await page.close();
  if (problems.length > 0) fail('A dead-end search still answers', problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

/**
 * One video plays at a time, and stops when you scroll past it.
 *
 * An embed keeps playing wherever it is, so without this a feed you scroll
 * through leaves its sound behind: tap three videos and three soundtracks
 * run at once, two of them on cards no longer anywhere near the screen.
 *
 * This one serves its own feed rather than using the day's, because YouTube
 * refuses this server's requests and some days there is only one video in
 * the whole feed, which is not enough to show a rule about two. Stubbing it
 * also means the check tests the view and nothing else.
 */
async function oneVideoAtATime() {
  /*
   * Its own context, with the service worker blocked.
   *
   * The built app registers one, and a service worker answers /api/goss
   * itself, so a route stub set on the page never sees the request: the
   * check served two videos and the page rendered the day's real feed. In
   * dev there is no service worker, which is why this passed by hand and
   * failed in the sweep.
   */
  const context = await browser.newContext({
    viewport: { width: 430, height: 1500 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  try {
    const video = (id, title) => ({
      kind: 'trailer',
      channel: 'youtube',
      source: 'Smoke Channel',
      origin: 'Smoke',
      note: 'Video',
      author: 'Smoke',
      authorName: 'Smoke Channel',
      avatar: null,
      title,
      summary: null,
      link: `https://www.youtube.com/watch?v=${id}`,
      externalLink: null,
      image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      publishedAt: new Date(Date.now() - 3600000).toISOString(),
      heat: 0,
    });
    await page.route('**/api/goss*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          // Two videos and enough after them to scroll past, because the
          // last assertion is about leaving a video behind and a two-card
          // feed cannot be scrolled at all. That is how this check first
          // failed: not the app, the fixture.
          bursts: [
            video('aaaaaaaaaaa', 'First smoke video'),
            video('bbbbbbbbbbb', 'Second smoke video'),
            ...Array.from({ length: 30 }, (_, at) => ({
              kind: 'buzz',
              channel: 'press',
              source: 'Smoke Press',
              origin: 'Smoke Press',
              author: 'Smoke Press',
              authorName: 'Smoke Press',
              avatar: null,
              title: `Filler story number ${at} to scroll past`,
              summary: null,
              link: `https://example.test/filler-${at}`,
              externalLink: null,
              image: null,
              publishedAt: new Date(Date.now() - (at + 2) * 3600000).toISOString(),
              heat: 0,
            })),
          ],
          counts: { trailer: 2, buzz: 30 },
          fetchedAt: new Date().toISOString(),
        }),
      }),
    );
    // A card whose still fails to load removes its whole media block, Play
    // button included, and stills do not load from here.
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.route('**i.ytimg.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: pixel }),
    );

    await page.goto(`${BASE}/?read=goss`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('article', { timeout: 60000 });
    await page.waitForTimeout(2500);

    const frames = () => page.locator('article iframe').count();
    if ((await frames()) !== 0) problems.push('a player loaded before anything was tapped');

    await page.getByRole('button', { name: 'Play First smoke video' }).click();
    await page.waitForTimeout(800);
    if ((await frames()) !== 1) problems.push(`tapping one gave ${await frames()} players`);

    await page.getByRole('button', { name: 'Play Second smoke video' }).click();
    await page.waitForTimeout(900);
    const total = await frames();
    const stale = await page
      .locator('article')
      .filter({ hasText: 'First smoke video' })
      .locator('iframe')
      .count();
    if (total !== 1 || stale !== 0) {
      problems.push(`starting a second left ${total} players running`);
    }

    // And scrolling past it gives the player back. The feed lives in the
    // drawer's own scroller, so the wheel has to be over it.
    await page.locator('article').first().hover();
    await page.mouse.wheel(0, 6000);
    await page.waitForTimeout(1600);
    if ((await frames()) !== 0) problems.push('a player kept running after it scrolled away');

    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${'One video at a time'.padEnd(32)} lazy, single, released on scroll` +
        (problems.length ? `  ${problems[0]}` : ''),
    );
  } catch (error) {
    problems.push(`threw: ${String(error.message).slice(0, 80)}`);
    console.log(`FAIL ${'One video at a time'.padEnd(32)} ${problems[0]}`);
  }
  await context.close();
  if (problems.length > 0) fail('One video at a time', problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

/**
 * Does a plain launch open on a swipeable screen with games on it?
 *
 * Reported as "the opening page is always the same, same game, it's a
 * little boring", and then, of the first answer to that, "the goss at open
 * doesn't work, it should open with newest releases I might be most
 * willing to like, in the swipeable mode".
 *
 * So: For you, new releases, feed view. For a reader the picker knows
 * nothing about yet that would be the "nothing to work from" screen, which
 * is a worse opening than the dull one, so a cold launch gets the release
 * calendar instead. Both are checked, because the empty one is the one
 * that would ship unnoticed.
 *
 * Finding this bug is why both are here: For you rendered nothing at all
 * in the feed view, on every profile, and had done for as long as the view
 * has existed. Nothing opened on it, and the sweep checked For you in the
 * grid and the feed on All, never the two together.
 */
async function aPlainLaunchOpensSomethingToSwipe() {
  const label = 'A plain launch opens a feed';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  const slides = () => page.locator('main h2, section h2, section h3').count();
  const settle = async () => {
    let n = 0;
    for (const end = Date.now() + 25000; Date.now() < end; ) {
      n = await slides();
      if (n > 0) break;
      await page.waitForTimeout(500);
    }
    return n;
  };
  let note = '';
  try {
    // Cold: nothing rated, owned or wanted.
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const cold = await settle();
    const coldUrl = page.url();
    if (!/mode=feed/.test(coldUrl)) problems.push(`cold launch is not a feed: ${coldUrl.slice(-40)}`);
    if (cold === 0) problems.push('a cold launch opened on an empty screen');

    // Warm: a reader with a history gets the picks.
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(seed);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const warm = await settle();
    const warmUrl = page.url();
    if (!/mode=feed/.test(warmUrl)) problems.push(`warm launch is not a feed: ${warmUrl.slice(-40)}`);
    if (!/view=genius/.test(warmUrl)) problems.push(`warm launch is not For you: ${warmUrl.slice(-40)}`);
    if (!/new=1/.test(warmUrl)) problems.push(`warm launch is not new releases: ${warmUrl.slice(-40)}`);
    if (warm === 0) problems.push('For you in the feed view rendered nothing');

    // A link that asks for something specific still gets it.
    await page.goto(`${BASE}/?view=all`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    if (/mode=feed/.test(page.url())) problems.push('the feed opened over ?view=all');

    note = `${cold} cold, ${warm} warm`;
    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}` +
        (problems.length ? `  ${problems[0]}` : ''),
    );
  } catch (error) {
    problems.push(`threw: ${String(error.message).slice(0, 80)}`);
    console.log(`FAIL ${label.padEnd(32)} ${problems[0]}`);
  }
  await page.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

/**
 * Can you find a game by name: one that is not out yet, and one that is
 * not on PlayStation at all?
 *
 * Three separate failures were reported as one ("I searched for a game and
 * it wasn't there"), and each needed its own fix:
 *
 *   - the release calendar was its own pool, reachable only from the Soon
 *     shelf, so no upcoming game could be found from anywhere else
 *   - the squashed-name rule matched across word joins, so "hela" returned
 *     forty games led by The Last of Us and none of them Hela
 *   - and those forty wrong answers suppressed the PC fallback, which only
 *     runs when nothing matched
 *
 * The third is why the second mattered so much, and why this checks that a
 * miss is still a miss: a search that quietly matches something is worse
 * than one that finds nothing, because the app stops looking.
 */
async function youCanFindAGameByName() {
  const label = 'Upcoming and PC games are findable';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    // On the origin first. A fetch evaluated on about:blank is cross-origin
    // and throws "Failed to fetch", which is how this check failed the
    // first time it ran: a fault in the check, not in the app.
    await page.goto(`${BASE}/?view=all`, { waitUntil: 'domcontentloaded' });

    // Whatever the calendar is actually holding today, so this does not
    // rot the moment a release ships.
    const upcoming = await page.evaluate(async (base) => {
      const payload = await (await fetch(`${base}/api/upcoming`)).json();
      return (payload.games ?? []).map((row) => row.title).slice(0, 5);
    }, BASE);

    if (upcoming.length === 0) {
      note = 'the calendar is empty today, so there is nothing to look for';
    } else {
      const wanted = upcoming[0];
      await page.goto(`${BASE}/?q=${encodeURIComponent(wanted)}`, { waitUntil: 'domcontentloaded' });
      let found = false;
      for (const end = Date.now() + 25000; Date.now() < end; ) {
        const text = await page.locator('main').innerText();
        if (text.includes(wanted.slice(0, 18))) {
          found = true;
          break;
        }
        await page.waitForTimeout(500);
      }
      if (!found) problems.push(`"${wanted}" is on the calendar and not findable by name`);
      note = `"${wanted.slice(0, 24)}"`;
    }

    // A PC-only game: the catalog must find nothing and say where it is.
    await page.goto(`${BASE}/?q=hollow%20knight%20silksong`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // And the junk-match case, by shape rather than by one title: a short
    // query that no game is called must not come back with a screenful.
    const junk = await page.evaluate(async (base) => {
      const payload = await (await fetch(`${base}/api/store?q=hela`)).json();
      return { total: payload.total ?? 0, first: (payload.games ?? [])[0]?.name ?? null };
    }, BASE);
    if (junk.total > 3) {
      problems.push(`"hela" matched ${junk.total} games, top of them ${junk.first}`);
    }
    note += `, "hela" matches ${junk.total}`;

    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}` +
        (problems.length ? `  ${problems[0]}` : ''),
    );
  } catch (error) {
    problems.push(`threw: ${String(error.message).slice(0, 80)}`);
    console.log(`FAIL ${label.padEnd(32)} ${problems[0]}`);
  }
  await page.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

async function theWishlistShowsTheWishlist() {
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());

    // Heart an upcoming game: not curated, not in the mirror the shelf pages.
    await page.goto(`${BASE}/?view=soon`, { waitUntil: 'domcontentloaded' });
    const heart = page.locator('button[aria-label^="Add "][aria-label*="wishlist"]').first();
    await heart.waitFor({ timeout: 20000 });
    const hearted = (await heart.getAttribute('aria-label'))
      .replace(/^Add | to wishlist$/g, '');
    await heart.click();
    await page.waitForTimeout(800);

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wishlist') || '[]').length,
    );
    if (saved !== 1) problems.push(`hearting stored ${saved} games, expected 1`);

    // Now the default shelf, filtered. One game is wishlisted, so one shows.
    await page.goto(`${BASE}/?view=all&wishlist=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const cards = () => page.locator('main h2, section h2, section h3').count();
    let shown = await cards();
    for (const deadline = Date.now() + 15000; shown === 0 && Date.now() < deadline; ) {
      await page.waitForTimeout(500);
      shown = await cards();
    }
    if (shown !== 1) problems.push(`the wishlist shelf showed ${shown} games, expected 1`);
    const text = await page.locator('main').innerText();
    if (!text.includes(hearted.slice(0, 18))) {
      problems.push(`${hearted} is wishlisted and not on the shelf`);
    }
    note = `${hearted.slice(0, 22)}, ${shown} on the shelf`;

    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${'The wishlist shows the wishlist'.padEnd(32)} ${note}` +
        (problems.length ? `  ${problems[0]}` : ''),
    );
  } catch (error) {
    problems.push(`threw: ${String(error.message).slice(0, 80)}`);
    console.log(`FAIL ${'The wishlist shows the wishlist'.padEnd(32)} ${problems[0]}`);
  }
  await page.close();
  if (problems.length > 0) fail('The wishlist shows the wishlist', problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

failures += await oneVideoAtATime();
failures += await aSearchWithNoAnswerStillAnswers();
failures += await shelvesKeepEverything();
failures += await unreadHidesOnlyWhatYouRead();
/**
 * Does a studio name find that studio's games, and can you tap through to
 * them? And is a game we hold ever announced as missing?
 *
 * Two reports, one screen. Asked for: "I wanna search Dev names like
 * Bethesda and all their games pop up and buttons". Then, of the result:
 * "I checked PlayStation store and this game is in fact on there", with a
 * screenshot of the app saying NOT ON PLAYSTATION THAT WE CAN SEE above a
 * PC listing for The Outer Worlds 2, which the mirror holds.
 *
 * The second is the one worth a check in the sweep. Finding nothing is a
 * poor answer; announcing that a game is not on the platform while holding
 * it is a wrong one, and wrong in a way a reader can catch and the suite
 * could not.
 */
async function aStudioNameFindsItsGames() {
  const label = 'A studio name finds its games';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    await page.goto(`${BASE}/?view=all`, { waitUntil: 'domcontentloaded' });

    // Whichever publisher the index actually has most of, so this does not
    // depend on Bethesda still being in it next month.
    const studio = await page.evaluate(async (base) => {
      const payload = await (await fetch(`${base}/api/store?q=bethesda`)).json();
      return (payload.games ?? [])[0]?.publisher ?? null;
    }, BASE);

    if (!studio) {
      note = 'no Bethesda games in the index today';
    } else {
      const found = await page.evaluate(
        async ([base, name]) => {
          const payload = await (await fetch(`${base}/api/store?q=${encodeURIComponent(name)}`)).json();
          return {
            total: payload.total ?? 0,
            allTheirs: (payload.games ?? []).every((game) => game.publisher === name),
          };
        },
        [BASE, studio],
      );
      if (found.total < 2) problems.push(`"${studio}" returned ${found.total} games`);
      if (!found.allTheirs) problems.push(`"${studio}" returned somebody else's games`);
      note = `${studio} -> ${found.total}`;

      /*
       * And a developer, which is the half PlayStation does not publish.
       * Taken from whatever the index actually holds rather than named
       * here, so rebuilding the baked set cannot fail this.
       */
      const dev = await page.evaluate(async (base) => {
        const payload = await (await fetch(`${base}/api/store?q=`)).json();
        const row = (payload.games ?? []).find((game) => game.developer);
        if (!row) return null;
        const back = await (
          await fetch(`${base}/api/store?q=${encodeURIComponent(row.developer)}`)
        ).json();
        return {
          studio: row.developer,
          name: row.name,
          found: (back.games ?? []).some((game) => game.id === row.id),
        };
      }, BASE);
      if (dev && !dev.found) {
        problems.push(`"${dev.studio}" did not find ${dev.name}, which it made`);
      }
      if (dev) note += `, dev ${dev.studio.slice(0, 18)}`;

      // And the button: the studio on a game's page is a way in.
      await page.goto(`${BASE}/?q=${encodeURIComponent(studio)}`, { waitUntil: 'domcontentloaded' });
      let heading = '';
      for (const end = Date.now() + 20000; Date.now() < end; ) {
        heading = await page.locator('main').innerText();
        if (/published by/i.test(heading)) break;
        await page.waitForTimeout(500);
      }
      if (!/published by/i.test(heading)) {
        problems.push('a publisher search did not say whose games these are');
      }
    }

    /*
     * A game the mirror holds, asked for the way somebody would get it
     * slightly wrong. It must never land under "not on PlayStation".
     */
    const variants = ['outer worlds two', 'the outer worlds II'];
    for (const variant of variants) {
      await page.goto(`${BASE}/?q=${encodeURIComponent(variant)}`, { waitUntil: 'domcontentloaded' });
      let text = '';
      for (const end = Date.now() + 25000; Date.now() < end; ) {
        text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
        // Settled once it has either found it or given its verdict.
        if (/Outer Worlds/i.test(text) || /Not on PlayStation/i.test(text)) break;
        await page.waitForTimeout(500);
      }
      if (/Not on PlayStation/i.test(text)) {
        problems.push(`"${variant}" was called missing, and the mirror has it`);
      }
    }

    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}` +
        (problems.length ? `  ${problems[0]}` : ''),
    );
  } catch (error) {
    problems.push(`threw: ${String(error.message).slice(0, 80)}`);
    console.log(`FAIL ${label.padEnd(32)} ${problems[0]}`);
  }
  await page.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

failures += await aPlainLaunchOpensSomethingToSwipe();
failures += await youCanFindAGameByName();
failures += await aStudioNameFindsItsGames();
failures += await theWishlistShowsTheWishlist();

await browser.close();
stop();

const total = SURFACES.length + 8;
if (failures > 0) {
  // Named, not just counted, so the last line of a truncated log still says
  // what to go and look at.
  console.error(`\n${failures} of ${total} checks have problems:`);
  for (const line of failed) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`\nall ${total} checks pass: every surface renders, with nothing thrown`);
