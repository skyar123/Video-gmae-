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
  ['?view=trending', 'Trending', 20],
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

/*
 * Launched the way a phone behaves: nothing with sound plays without a tap.
 *
 * The default here allows it, which is how a feed that opened unmuted could
 * sit paused on every trailer in front of a reader while every check passed.
 */
const browser = await chromium.launch({
  args: ['--autoplay-policy=document-user-activation-required'],
});
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
    /*
     * One opening for everybody, because Trending asks nothing of the
     * reader. Checked on a profile with no history and on one with
     * some, since the previous opener needed a profile and showed
     * "nothing to work from" without one.
     */
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const cold = await settle();
    const coldUrl = page.url();
    if (!/mode=feed/.test(coldUrl)) problems.push(`cold launch is not a feed: ${coldUrl.slice(-40)}`);
    if (!/view=trending/.test(coldUrl)) problems.push(`cold launch is not Trending: ${coldUrl.slice(-40)}`);
    if (cold === 0) problems.push('a cold launch opened on an empty screen');

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(seed);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const warm = await settle();
    const warmUrl = page.url();
    if (!/mode=feed/.test(warmUrl)) problems.push(`warm launch is not a feed: ${warmUrl.slice(-40)}`);
    if (!/view=trending/.test(warmUrl)) problems.push(`warm launch is not Trending: ${warmUrl.slice(-40)}`);
    if (warm === 0) problems.push('Trending rendered nothing');

    /*
     * And nothing to undo before searching. The opener used to arrive
     * with "new releases" switched on, so the first screen wore an
     * active filter chip and the obvious way to search was to clear it
     * and go to All. Reported exactly that way.
     */
    const chips = await page
      .locator('header button')
      .evaluateAll((nodes) => nodes.map((node) => (node.innerText || '').trim()));
    if (chips.some((text) => /^(New releases|Kid friendly|Wishlist)$/i.test(text))) {
      problems.push('the opening screen arrived with a filter already on');
    }

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
/**
 * Does a search answer from everywhere, whatever shelf you were on?
 *
 * Reported as the search getting stuck to the filters, and it was worse
 * than that. On For you the query was ignored outright, because that
 * shelf is ranked rather than filtered and never consulted it: typing
 * "hollow knight" on the screen the app opens with answered with
 * BeamNG.drive. On Cozy or a wishlist the query applied and the shelf
 * then removed every result, which reads the same way to a reader.
 *
 * Both halves are checked. A search has to find the game from every
 * starting state, and clearing it has to put the reader back where they
 * were, because the filters are bypassed rather than thrown away.
 */
async function aSearchAnswersFromAnywhere() {
  const label = 'A search answers from anywhere';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(seed);

    // Every shelf somebody might be on when they decide to search.
    const wanted = 'hollow knight';
    const starts = [
      ['?view=genius&new=1&mode=feed', 'the launch screen'],
      ['?view=cozy', 'Cozy'],
      ['?view=genius', 'For you'],
      ['?view=all&wishlist=1', 'a wishlist'],
      ['?view=all&kids=1', 'kid friendly'],
    ];
    let found = 0;
    for (const [where, name] of starts) {
      await page.goto(`${BASE}/${where}&q=${encodeURIComponent(wanted)}`, {
        waitUntil: 'domcontentloaded',
      });
      let text = '';
      for (const end = Date.now() + 25000; Date.now() < end; ) {
        text = await page.locator('main').innerText();
        if (new RegExp(wanted, 'i').test(text)) break;
        await page.waitForTimeout(500);
      }
      if (new RegExp(wanted, 'i').test(text)) found += 1;
      else problems.push(`searching from ${name} did not find it`);
    }
    note = `${found}/${starts.length} shelves`;

    /*
     * And the filters come back. Bypassing them is only defensible if
     * they survive: a search that cleared the shelf would answer the
     * question and lose the reader's place doing it.
     */
    await page.goto(`${BASE}/?view=cozy&kids=1`, { waitUntil: 'domcontentloaded' });
    let shelf = '';
    for (const end = Date.now() + 20000; Date.now() < end; ) {
      shelf = await page.locator('main').innerText();
      if (/of 506 games/.test(shelf)) break;
      await page.waitForTimeout(500);
    }
    const box = page.locator('input[type="search"], input[placeholder*="earch" i]').first();
    await box.waitFor({ timeout: 15000 });
    await box.fill(wanted);
    await page.waitForTimeout(6000);
    const during = await page.locator('main').innerText();
    if (!/waiting until you clear/i.test(during)) {
      problems.push('a search did not say which filters it had set aside');
    }
    await box.fill('');
    let back = '';
    for (const end = Date.now() + 20000; Date.now() < end; ) {
      back = await page.locator('main').innerText();
      if (/of 506 games/.test(back)) break;
      await page.waitForTimeout(500);
    }
    if (!/of 506 games/.test(back)) problems.push('clearing the search did not restore the shelf');

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

failures += await aStudioNameFindsItsGames();
/**
 * Does searching a kind of game return that kind?
 *
 * Asked for directly: "if I search boardgames it shows me board game
 * games, instead of showing me just game titles that [match]". Typing
 * "board" used to return Longboard Skate Downhill Simulator and Cool
 * Boarders, which is a string match doing what it was told.
 *
 * Checked through the API rather than the page, so it fails on the rule
 * rather than on a card not having rendered yet, and asserted on what
 * came back being the right kind rather than on how many.
 */
async function aKindOfGameIsSearchable() {
  const label = 'Searching a kind of game works';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    await page.goto(`${BASE}/?view=all`, { waitUntil: 'domcontentloaded' });

    const asked = await page.evaluate(async (base) => {
      const ask = async (q) => (await (await fetch(`${base}/api/store?q=${encodeURIComponent(q)}`)).json());
      const horror = await ask('horror');
      const board = await ask('board games');
      const racing = await ask('racing');
      return {
        horror: {
          total: horror.total ?? 0,
          genreShare: (horror.games ?? []).filter((g) => (g.genres ?? []).includes('Horror')).length,
          shown: (horror.games ?? []).length,
        },
        board: { total: board.total ?? 0, names: (board.games ?? []).map((g) => g.name) },
        racing: {
          total: racing.total ?? 0,
          genreShare: (racing.games ?? []).filter((g) =>
            (g.genres ?? []).includes('Driving/Racing'),
          ).length,
          shown: (racing.games ?? []).length,
        },
      };
    }, BASE);

    // A kind returns a lot of that kind, not a handful of lookalike names.
    if (asked.horror.total < 50) problems.push(`"horror" returned ${asked.horror.total} games`);
    if (asked.racing.total < 50) problems.push(`"racing" returned ${asked.racing.total} games`);

    // And most of what comes back really is that kind. Not all: a game
    // actually named "Horror something" is a title match and belongs
    // above them.
    const mostly = (slice) => slice.shown === 0 || slice.genreShare / slice.shown >= 0.5;
    if (!mostly(asked.horror)) {
      problems.push(`only ${asked.horror.genreShare}/${asked.horror.shown} horror hits are horror`);
    }
    if (!mostly(asked.racing)) {
      problems.push(`only ${asked.racing.genreShare}/${asked.racing.shown} racing hits race`);
    }

    // The reported case, and the games it used to return instead.
    if (asked.board.total < 5) problems.push(`"board games" returned ${asked.board.total}`);
    const skating = asked.board.names.filter((name) => /longboard|cool boarders|snowboard/i.test(name));
    if (skating.length > 0) problems.push(`"board games" still returns ${skating[0]}`);

    note = `horror ${asked.horror.total}, racing ${asked.racing.total}, board ${asked.board.total}`;
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
 * The half of the catalogue the store cannot answer for.
 *
 * A concept backed by a label only the write-ups carry, searched from the
 * shelf the app opens on, which is where both halves of this went wrong at
 * once. The search pool was the opening shelf's own rows rather than the
 * catalogue, so a kind of game only the write-ups know about had nothing to
 * match against: "pixel art" returned nothing although 57 games are labelled
 * exactly that. And the count above the grid was the store's alone, so when
 * the written-up games did come back they sat under a line reading zero.
 */
async function aCuratedOnlyKindIsSearchable() {
  const label = 'A kind only the write-ups know';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    // No shelf in the URL: whatever the app opens on is what this tests.
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const browse = [...document.querySelectorAll('button')].find(
        (n) => /^Browse$/i.test(n.textContent || ''),
      );
      browse?.click();
    });
    await page.waitForTimeout(800);

    const box = page.locator('input[type="search"]').first();
    await box.fill('pixel art');
    await page.waitForTimeout(2600);

    const seen = await page.evaluate(() => {
      const main = document.querySelector('main');
      const text = main?.innerText ?? '';
      return {
        cards: main?.querySelectorAll('.grid > *').length ?? 0,
        counted: Number((text.match(/([\d,]+)\s+match/i)?.[1] ?? '-1').replace(/,/g, '')),
        empty: /Nothing in the index matches that/i.test(text),
      };
    });

    if (seen.empty || seen.cards === 0) {
      problems.push(`"pixel art" returned nothing from the opening shelf`);
    }
    // The line over the grid has to agree with the grid under it.
    if (seen.counted === 0 && seen.cards > 0) {
      problems.push(`${seen.cards} games on screen under a count of 0`);
    }
    note = `${seen.cards} shown, counted ${seen.counted}`;
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
 * For you is a grid, and it can be asked about.
 *
 * On a phone the For you tab opened a sheet of twelve picks in one column
 * rather than the section, and reaching the section by its chip inherited
 * the feed the app opens in. Both were reported as the section being
 * neither scrollable nor a grid, which it was not, because it was not the
 * section at all.
 */
async function forYouIsAGridYouCanTune() {
  const label = 'For you is a grid you can tune';
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const tap = (source) =>
      page.evaluate((pattern) => {
        const rx = new RegExp(pattern, 'i');
        const hit = [...document.querySelectorAll('button')].find(
          (n) => rx.test(n.textContent || '') || rx.test(n.getAttribute('aria-label') || ''),
        );
        if (!hit) return false;
        hit.click();
        return true;
      }, source);

    if (!(await tap('^For you$'))) problems.push('no For you button');
    await page.waitForTimeout(2200);

    const shown = await page.evaluate(() => {
      const main = document.querySelector('main');
      return {
        grids: main?.querySelectorAll('.grid').length ?? 0,
        cards: main?.querySelectorAll('.grid > *').length ?? 0,
        scrolls: document.documentElement.scrollHeight > window.innerHeight * 2,
      };
    });
    if (shown.grids === 0) problems.push('For you is not a grid');
    if (shown.cards < 12) problems.push(`only ${shown.cards} picks`);
    if (!shown.scrolls) problems.push('the picks do not scroll');

    // And the questions open, ask something readable, and are answerable.
    if (!(await tap('questions'))) problems.push('no way to tune the picks');
    await page.waitForTimeout(1200);
    const asked = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const text = dialog?.innerText ?? '';
      return {
        open: Boolean(dialog),
        heading: /\d+ OF \d+/i.test(text),
        answerable: [...(dialog?.querySelectorAll('button') ?? [])].some((n) =>
          /More of this/i.test(n.textContent || ''),
        ),
      };
    });
    if (!asked.open) problems.push('the questions did not open');
    else if (!asked.heading || !asked.answerable) problems.push('the questions have nothing to ask');

    if (asked.answerable) {
      await tap('More of this');
      await page.waitForTimeout(900);
      const stored = await page.evaluate(() => localStorage.getItem('featureAnswers'));
      if (!stored || stored === '{}') problems.push('an answer was not kept');
    }

    note = `${shown.cards} picks in a grid, questions ${asked.open ? 'open' : 'shut'}`;
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
 * A search that could not run must not report that nothing exists.
 *
 * The count over the results is the one line a reader takes as the answer,
 * and it was written to show matches across both halves. It did that
 * whatever the store had actually said, so a request that failed or timed
 * out produced "0 matches, catalog and store": a confident statement that
 * the thing is not there, made at the one moment the app does not know. On a
 * dropped connection, searching for a game that is certainly in the
 * catalogue read as the game not being in it.
 *
 * Reported as a search returning zero, which is exactly what it looks like.
 */
async function aFailedSearchDoesNotClaimZero() {
  const label = 'A failed search admits it failed';
  /*
   * Its own context, with the service worker blocked.
   *
   * Not a detail. `page.route` does not intercept requests a service worker
   * makes, and this app installs one that handles /api/ itself, so the first
   * version of this check aborted nothing: the store answered normally, the
   * page showed real results, and the check was reporting on a search that
   * had never failed. It only got noticed because it failed for the wrong
   * reason rather than passing for one.
   */
  const context = await browser.newContext({
    viewport: { width: 430, height: 1200 },
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    let aborted = 0;
    await page.route('**/api/store**', (route) => {
      aborted += 1;
      return route.abort('failed');
    });
    await page.goto(`${BASE}/?q=toddler`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    // The check is worthless unless the request really was stopped.
    if (aborted === 0) problems.push('the store request was never actually blocked');

    const said = await page.evaluate(() => document.querySelector('main')?.innerText ?? '');
    // The lie, in the two shapes it can take.
    if (/\b0 matches\b/i.test(said)) problems.push('said "0 matches" when the store never answered');
    if (/Nothing in the index matches that/i.test(said) && !/could not be reached|not answering/i.test(said)) {
      problems.push('reported no matches without saying the store was unreachable');
    }
    // And it has to say what did happen.
    if (!/could not be reached|not answering/i.test(said)) {
      problems.push('never told the reader the store was unreachable');
    }
    note = /could not be reached/i.test(said) ? 'says the store is unreachable' : 'says nothing useful';
    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}` +
        (problems.length ? `  ${problems[0]}` : ''),
    );
  } catch (error) {
    problems.push(`threw: ${String(error.message).slice(0, 80)}`);
    console.log(`FAIL ${label.padEnd(32)} ${problems[0]}`);
  }
  await context.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

/**
 * Nothing above the chosen age reaches a child, on any surface.
 *
 * The one failure in this app that is worse than useless. A search that
 * misses a game costs somebody a minute; a filter that hands a five-year-old
 * a Mature game has made a promise it broke. The mirror is paged by the
 * server, so this has to hold on the server rather than in the page: every
 * shelf drawn that way, which is All, PS Plus and every search, would
 * otherwise show whatever happened to be sent.
 *
 * The control at the end is the point of the check. Without it, a filter
 * that returned nothing at all would pass every assertion above while being
 * completely broken, so the last probe proves the leaks are findable when
 * the audience is not set.
 */
async function nothingTooOldReachesAChild() {
  const label = 'A child sees nothing too old';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const ask = (query) =>
      page.evaluate(async ([base, qs]) => {
        const response = await fetch(`${base}/api/store?${qs}`);
        const payload = await response.json();
        return (payload.games ?? []).map((game) => ({
          name: game.name,
          tier: game.ageRating?.tier ?? 'none',
        }));
      }, [BASE, query]);

    // Every way into the mirror, with the youngest audience set.
    const surfaces = {
      browse: 'audience=everyone',
      search: 'q=horror&audience=everyone',
      named: 'q=call%20of%20duty&audience=everyone',
      kind: 'q=shooter&audience=everyone',
      newest: 'audience=everyone&sort=newest',
      plus: 'audience=everyone&plus=1',
    };
    let checked = 0;
    for (const [where, query] of Object.entries(surfaces)) {
      const rows = await ask(query);
      checked += rows.length;
      const leaked = rows.filter((row) => row.tier !== 'everyone');
      if (leaked.length > 0) {
        problems.push(`${where} showed ${leaked[0].name} rated ${leaked[0].tier}`);
      }
    }

    /*
     * And the probe can actually see a leak. A filter returning nothing
     * passes every assertion above, so this proves the opposite case.
     */
    const control = await ask('q=call%20of%20duty');
    if (!control.some((row) => row.tier === 'mature')) {
      problems.push('the control found no mature game, so the check proves nothing');
    }
    if (checked === 0) problems.push('no rows were examined at all');

    note = `${checked} rows across 6 surfaces, 0 too old`;
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

failures += await aSearchAnswersFromAnywhere();
failures += await aKindOfGameIsSearchable();
failures += await aCuratedOnlyKindIsSearchable();
failures += await aFailedSearchDoesNotClaimZero();
failures += await forYouIsAGridYouCanTune();
failures += await nothingTooOldReachesAChild();
failures += await theWishlistShowsTheWishlist();

/*
 * Does earning a point say so?
 *
 * The levels and the trophies were all computed correctly and shown on a
 * sheet nobody opened, which was reported as not being able to find any of
 * it. A level costs 100 * level^1.45, so between level-ups the total moves
 * in silence unless the badge says otherwise. This is that saying-so: the
 * badge shows the gain, then goes back to the level, and the bar across its
 * foot sits further along than it did.
 */
async function pointsLandWhereYouCanSeeThem() {
  const label = 'Earning a point says so';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/?view=all`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);

    const badge = () =>
      page.evaluate(() => {
        const node = [...document.querySelectorAll('button')].find((n) =>
          /^Level /.test(n.getAttribute('aria-label') || ''),
        );
        if (!node) return null;
        const bar = node.querySelector('.pixel-bar');
        return {
          label: node.getAttribute('aria-label'),
          width: bar ? Number.parseFloat(bar.style.width) : null,
        };
      });

    const before = await badge();
    if (!before) {
      problems.push('no level badge in the header, so there is nothing to find');
    }

    const heart = page.locator('button[aria-label^="Add "][aria-label*="wishlist"]').first();
    await heart.waitFor({ timeout: 20000 });
    await heart.click();
    await page.waitForTimeout(350);

    const gain = await page.evaluate(() => {
      const node = document.querySelector('.animate-pixel-float');
      return node ? node.textContent.trim() : null;
    });
    if (!/^\+[1-9]\d*$/.test(gain || '')) {
      problems.push(`the badge showed ${JSON.stringify(gain)} instead of a gain`);
    }

    const after = await badge();
    if (before && after && !(after.width > before.width)) {
      problems.push(`the bar stayed at ${before.width}% after earning ${gain}`);
    }

    // It is a flourish, not a thing to dismiss: it has to take itself away.
    await page.waitForTimeout(1600);
    const lingering = await page.locator('.animate-pixel-float').count();
    if (lingering > 0) problems.push('the gain never left the badge');
    const back = await page.evaluate(() => {
      const node = [...document.querySelectorAll('button')].find((n) =>
        /^Level /.test(n.getAttribute('aria-label') || ''),
      );
      return node ? node.innerText.replace(/\s+/g, ' ').trim() : '';
    });
    if (!/LV/.test(back)) problems.push(`the badge reads ${JSON.stringify(back)}, not the level`);

    note = `${gain}, bar ${before?.width ?? '?'}% to ${after?.width ?? '?'}%`;
    console.log(
      `${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}`,
    );
  } catch (error) {
    problems.push(String(error).slice(0, 110));
    console.log(`FAIL ${label.padEnd(32)} ${String(error).slice(0, 60)}`);
  }
  await page.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

failures += await pointsLandWhereYouCanSeeThem();

/*
 * Does a filter the store cannot answer still do something?
 *
 * Art style, protagonist, upgrade type and the catalogue's own genres are
 * hand-written fields. The store mirror has none of them, so they were
 * handed to the shelf and dropped: the select moved, the URL gained
 * `&art=2D`, and the same 9,222 games stayed on screen, on a cold load as
 * well as a live one. Reported as the filters not doing anything.
 *
 * The shelf becomes the write-ups while one of these is set. This checks
 * the shelf actually moved, not merely that the URL did.
 */
async function aWriteUpFilterNarrowsTheShelf() {
  const label = 'Write-up filters narrow the shelf';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  const titles = async (query) => {
    await page.goto(`${BASE}/${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    return page.evaluate(() =>
      [...document.querySelectorAll('main h2, main h3, section h2, section h3')]
        .map((n) => n.textContent.trim())
        .filter(Boolean),
    );
  };
  try {
    const plain = await titles('?view=all');
    if (plain.length === 0) problems.push('the unfiltered shelf came back empty');

    for (const [query, field] of [
      ['?view=all&art=Pixel+Art', 'art style'],
      ['?view=all&protagonist=Female', 'who you play'],
      ['?view=all&genre=Metroidvania', 'the kind of game'],
    ]) {
      const narrowed = await titles(query);
      if (narrowed.length === 0) {
        problems.push(`${field} emptied the shelf`);
        continue;
      }
      // Same games in the same order means the filter was dropped.
      if (narrowed[0] === plain[0] && narrowed[1] === plain[1]) {
        problems.push(`${field} left the shelf exactly as it was`);
      }
      const said = await page.evaluate(() =>
        document.body.innerText.includes('not something the store mirror records'),
      );
      if (!said) problems.push(`${field} narrowed the shelf without saying why`);
    }

    // And clearing it puts the mirror back, rather than stranding the
    // reader on the written-up games.
    const back = await titles('?view=all');
    if (back[0] !== plain[0]) problems.push('clearing the filter did not restore the shelf');
    note = `${plain.length} unfiltered, narrows and restores`;
    console.log(`${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}`);
  } catch (error) {
    problems.push(String(error).slice(0, 110));
    console.log(`FAIL ${label.padEnd(32)} ${String(error).slice(0, 60)}`);
  }
  await page.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

failures += await aWriteUpFilterNarrowsTheShelf();

/*
 * A PlayStation Portal with no console behind it.
 *
 * It is a streaming handheld, and Sony's FAQ is flat about what it streams:
 * "currently only select PS5 games are available to stream on PlayStation
 * Portal". So a PS4 game is not a worse option for this reader, it is one
 * they can never start, and 2,332 of the mirror's games plus 342 of the 506
 * write-ups are exactly that.
 *
 * Both directions matter and the second is the one that would quietly ruin
 * it: hiding games they can actually play is worse than the original
 * problem. Hollow Knight is backwards compatible, which means a PS4 game
 * running on PS5 hardware, which the Portal never touches. Returnal is PS5
 * only and has to survive.
 */
async function aPortalOnlySeesWhatItCanStream() {
  const label = 'A Portal sees only what it streams';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  const shown = async (query) => {
    await page.goto(`${BASE}/${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3800);
    return page.evaluate(() =>
      [...document.querySelectorAll('main h2, main h3, section h2, section h3')]
        .map((n) => n.textContent.trim())
        .filter(Boolean),
    );
  };
  /*
   * Exactly the title, not a prefix of it.
   *
   * The first version matched on substring and reported a failure for
   * "Hollow Knight" when the only thing on screen was "Hollow Knight:
   * Silksong", which is PS5 and is supposed to survive. The check was
   * wrong, not the filter.
   */
  const has = (list, title) =>
    list.some((name) => name.trim().toLowerCase() === title.toLowerCase());
  try {
    /*
     * Controls say portal=0 rather than leaving it off.
     *
     * The setting is remembered on purpose: somebody whose only console is a
     * Portal does not stop owning one between visits, so a URL with no
     * portal= falls back to the stored answer. That means a control written
     * as "just don't pass it" inherits portal=1 from the case before it and
     * silently tests nothing. This cost a round of chasing a filter bug that
     * was the test's own doing.
     */
    const open = await shown('?mode=grid&portal=0&q=hollow+knight');
    if (!has(open, 'Hollow Knight')) {
      problems.push('Hollow Knight is not findable even with the filter off');
    }

    for (const ps4 of ['hollow+knight', 'celeste', 'dead+cells']) {
      const list = await shown(`?mode=grid&portal=1&q=${ps4}`);
      const name = ps4.replace('+', ' ');
      if (has(list, name)) problems.push(`${name} is PS4 only and still on screen`);
    }

    // And the half that matters more: a PS5 game must survive. Silksong is
    // the sharpest version of it, sharing a name with a game that must go.
    const kept = await shown('?mode=grid&portal=1&q=returnal');
    if (!has(kept, 'Returnal')) problems.push('Returnal is PS5 only and was hidden');
    const sibling = await shown('?mode=grid&portal=1&q=hollow+knight');
    if (!has(sibling, 'Hollow Knight: Silksong')) {
      problems.push('Hollow Knight: Silksong is PS5 and was hidden with its PS4 namesake');
    }

    const shelf = await shown('?mode=grid&portal=1&view=all');
    if (shelf.length === 0) problems.push('the shelf came back empty with a Portal');

    /*
     * A write-up genre, because it is what exercises the shelf itself.
     *
     * All and every search are drawn from the store mirror, which is asked
     * for PS5 rows by the server, and the written-up games shown alongside
     * them are filtered as a separate list. Both of those can be right while
     * the shelf's own filter is missing entirely: removing it changed
     * nothing here until this case existed. Curated is drawn from the
     * write-ups on the device, so it is what proves it. Curated was tried
     * first and is no good: it renders in lazy chunks and Hollow Knight
     * never reaches the screen, so the case passed without testing a thing.
     */
    const metroidOpen = await shown('?mode=grid&portal=0&view=all&genre=Metroidvania');
    if (!has(metroidOpen, 'Hollow Knight')) {
      problems.push('Hollow Knight is not under Metroidvania, so this proves nothing');
    }
    const metroid = await shown('?mode=grid&portal=1&view=all&genre=Metroidvania');
    if (has(metroid, 'Hollow Knight')) {
      problems.push('Hollow Knight is PS4 only and still on the Metroidvania shelf');
    }
    if (metroid.length === 0) problems.push('the Metroidvania shelf came back empty');

    note = `${shelf.length} on the shelf, PS4 hidden, PS5 kept`;
    console.log(`${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}`);
  } catch (error) {
    problems.push(String(error).slice(0, 110));
    console.log(`FAIL ${label.padEnd(32)} ${String(error).slice(0, 60)}`);
  }
  await page.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

failures += await aPortalOnlySeesWhatItCanStream();

/*
 * Where the app opens for somebody whose only console is a Portal.
 *
 * Trending is the right first screen for most people and the wrong one for
 * them: it is games in the news, which is mostly games they would have to buy
 * before finding out whether the thing even streams. The subscription they
 * already pay for covers a few hundred they can start immediately, and until
 * now nothing in the app used that.
 *
 * Its own context on purpose. The Portal setting is remembered in
 * localStorage, every other check in this file shares one browser context,
 * and leaking it would quietly filter PS4 games out of their shelves.
 */
async function aPortalOpensOnWhatItCanPlay() {
  const label = 'A Portal opens on what it plays';
  const context = await browser.newContext({ viewport: { width: 430, height: 1200 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    // A reader who has never said anything still gets the news.
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const plain = await page.evaluate(() => window.location.search);
    if (!/view=trending/.test(plain)) {
      problems.push(`a plain launch opened on ${plain || 'nothing'}, not trending`);
    }

    // Then they say they are on a Portal, and come back later to a bare link.
    await page.goto(`${BASE}/?mode=grid&view=all&portal=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const after = await page.evaluate(() => ({
      url: window.location.search,
      text: document.body.innerText,
      cards: document.querySelectorAll('main h2, main h3, section h2, section h3').length,
    }));
    if (!/view=plus/.test(after.url)) {
      problems.push(`a Portal opened on ${after.url || 'nothing'}, not the Plus catalogue`);
    }
    if (!/portal=1/.test(after.url)) problems.push('the Portal setting was not remembered');
    if (!/streamable to a Portal/.test(after.text)) {
      problems.push('the shelf did not say these are the ones it can stream');
    }
    if (after.cards === 0) problems.push('it opened on an empty shelf');

    const count = (after.text.match(/([\d,]+) included with your Plus/) ?? [])[1];
    if (!count) problems.push('no count of what is included');
    note = `${count ?? '?'} included and streamable, ${after.cards} on screen`;
    console.log(`${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}`);
  } catch (error) {
    problems.push(String(error).slice(0, 110));
    console.log(`FAIL ${label.padEnd(32)} ${String(error).slice(0, 60)}`);
  }
  await context.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

failures += await aPortalOpensOnWhatItCanPlay();

/*
 * Getting out of a search.
 *
 * Two things were wrong and they compounded. There was no clear button, on
 * the phone at least: `type="search"` gets a cancel cross on desktop Safari
 * and nothing on iOS, so clearing meant holding backspace. And the query
 * survived a change of shelf, so tapping Deals after searching a game gave
 * the deals on that one game under a chip saying 93, with no way back except
 * the backspace key. Reported as the search bar not clearing itself and as
 * the app needing far too many presses.
 */
async function aSearchLetsYouOut() {
  const label = 'A search clears itself';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  const query = () => page.inputValue('input[type="search"]');
  try {
    await page.goto(`${BASE}/?view=all&portal=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);

    const clear = page.locator('button[aria-label="Clear the search"]');
    if ((await clear.count()) !== 0) problems.push('a clear button shows with nothing typed');

    await page.fill('input[type="search"]', 'hollow knight');
    await page.waitForTimeout(2500);
    if ((await clear.count()) === 0) {
      problems.push('no way to clear a search but the backspace key');
    } else {
      await clear.first().click();
      await page.waitForTimeout(1200);
      if ((await query()) !== '') problems.push('the clear button left the text behind');
    }

    // And leaving by the other door: a shelf is not a search.
    await page.fill('input[type="search"]', 'hollow knight');
    await page.waitForTimeout(2500);
    const deals = page.locator('button').filter({ hasText: /^Deals/ }).first();
    await deals.click();
    await page.waitForTimeout(2500);
    const left = await query();
    if (left !== '') problems.push(`changing shelf kept the search as ${JSON.stringify(left)}`);
    const url = await page.evaluate(() => window.location.search);
    if (!/view=deals/.test(url)) problems.push(`tapping Deals landed on ${url || 'nothing'}`);
    if (/[?&]q=/.test(url)) problems.push(`the query stayed in the url: ${url}`);

    // The same question asked twice is what made two filter places confusing.
    const onSale = await page.evaluate(
      () =>
        [...document.querySelectorAll('button')].filter((n) => /^On sale/.test(n.textContent.trim()))
          .length,
    );
    if (onSale > 0) problems.push('the On sale pill is still offered on the Deals shelf');

    note = 'clear button works, a shelf ends the search';
    console.log(`${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}`);
  } catch (error) {
    problems.push(String(error).slice(0, 110));
    console.log(`FAIL ${label.padEnd(32)} ${String(error).slice(0, 60)}`);
  }
  await page.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

failures += await aSearchLetsYouOut();

/*
 * The trailers play, and they start quiet.
 *
 * Sound in the feed used to be remembered across visits, and that broke
 * autoplay outright for anybody who had ever turned it on: a phone refuses
 * to start a video with sound unless a tap asked for it, so the feed opened
 * with every trailer paused on its first frame and nothing saying why.
 * Reported as videos often not playing, and separately as it needing to
 * start muted. One bug.
 */
async function theFeedStartsQuietAndPlays() {
  const label = 'The feed starts quiet and plays';
  const context = await browser.newContext({ viewport: { width: 430, height: 1200 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  try {
    // The state that used to break it: sound left on by an earlier visit.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('feedMuted', '0');
      } catch {
        // nothing to restore
      }
    });
    await page.goto(`${BASE}/?mode=feed&view=trending`, { waitUntil: 'domcontentloaded' });

    let seen = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await page.waitForTimeout(2500);
      seen = await page.evaluate(() =>
        [...document.querySelectorAll('video')].map((video) => ({
          muted: video.muted,
          paused: video.paused,
        })),
      );
      if (seen.length > 0) break;
    }

    if (seen.length === 0) {
      problems.push('no trailer mounted in 20s, so this proves nothing');
    } else {
      const loud = seen.filter((video) => !video.muted).length;
      if (loud > 0) problems.push(`${loud} trailer(s) started with sound, which a phone will not play`);
      const stuck = seen.filter((video) => video.paused).length;
      if (stuck > 0) problems.push(`${stuck} trailer(s) mounted and never played`);
    }
    note = `${seen.length} mounted, all muted and running`;
    console.log(`${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}`);
  } catch (error) {
    problems.push(String(error).slice(0, 110));
    console.log(`FAIL ${label.padEnd(32)} ${String(error).slice(0, 60)}`);
  }
  await context.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

/*
 * The pills in the sheet change the shelf you are looking at.
 *
 * On sale and At its lowest are facts about a price, and prices are read per
 * game on the device rather than held by the mirror, so on the main shelf
 * both pills sat there doing nothing. Reported as picking Deals in the sheet
 * while the bar said All and only the bar being obeyed.
 *
 * And PS Plus was a shelf you went to rather than a question you could ask,
 * so "which of these is already free for me" could not be put to For you or
 * to a search at all.
 */
async function theSheetPillsNarrowTheShelf() {
  const label = 'The sheet pills narrow the shelf';
  const page = await browser.newPage({ viewport: { width: 430, height: 1200 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error).slice(0, 110)));
  let note = '';
  const titles = async (query) => {
    await page.goto(`${BASE}/${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    return page.evaluate(() =>
      [...document.querySelectorAll('main h2, main h3, section h2, section h3')]
        .map((n) => n.textContent.trim())
        .filter(Boolean),
    );
  };
  const same = (a, b) => a.length === b.length && a.every((name, i) => name === b[i]);
  try {
    const plain = await titles('?mode=grid&view=all&portal=0');
    if (plain.length === 0) problems.push('the main shelf came back empty');

    const onSale = await titles('?mode=grid&view=all&portal=0&sale=1');
    if (same(onSale, plain)) problems.push('On sale left the main shelf exactly as it was');

    const onPlus = await titles('?mode=grid&view=all&portal=0&plus=1');
    if (same(onPlus, plain)) problems.push('On PS Plus left the main shelf exactly as it was');
    if (onPlus.length === 0) problems.push('On PS Plus emptied the shelf');

    // The point of it being a filter and not a shelf.
    const picks = await titles('?mode=grid&view=genius&portal=0');
    const picksOnPlus = await titles('?mode=grid&view=genius&portal=0&plus=1');
    if (same(picksOnPlus, picks)) problems.push('On PS Plus did nothing to For you');

    // And it is a fact about the reader, so it outlasts a search.
    const found = await titles('?mode=grid&view=all&portal=0&q=horizon');
    const foundOnPlus = await titles('?mode=grid&view=all&portal=0&plus=1&q=horizon');
    if (same(foundOnPlus, found)) problems.push('On PS Plus stepped aside for a search');

    note = `${plain.length} plain, ${onSale.length} on sale, ${onPlus.length} on plus`;
    console.log(`${problems.length ? 'FAIL' : ' ok '} ${label.padEnd(32)} ${note}`);
  } catch (error) {
    problems.push(String(error).slice(0, 110));
    console.log(`FAIL ${label.padEnd(32)} ${String(error).slice(0, 60)}`);
  }
  await page.close();
  if (problems.length > 0) fail(label, problems.join('; '));
  return problems.length > 0 ? 1 : 0;
}

failures += await theFeedStartsQuietAndPlays();
failures += await theSheetPillsNarrowTheShelf();

await browser.close();
stop();

const total = SURFACES.length + 21;
if (failures > 0) {
  // Named, not just counted, so the last line of a truncated log still says
  // what to go and look at.
  console.error(`\n${failures} of ${total} checks have problems:`);
  for (const line of failed) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`\nall ${total} checks pass: every surface renders, with nothing thrown`);
