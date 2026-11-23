/**
 * The phone layout, measured on a phone.
 *
 * Two separate things this guards, because they failed for two different
 * reasons and conflating them sends the next reader down the wrong path.
 *
 * 1. Tap target sizes. Twenty-six controls on the browse shelf, thirty-four
 *    on PS Plus and twenty-six on search were 24px tall and shipped that way
 *    for months. No sweep had ever measured a control's size, at any
 *    viewport, so nothing was hiding the bug: nobody had looked. That is all
 *    this needs to keep being true.
 *
 * 2. The section nav. That one does depend on the context flags below.
 *    Playwright's default context is a mouse (`pointer: fine`, no touch), and
 *    the nav is `.touch-only`, which is `display: none` under
 *    `@media (pointer: fine)`. So a sweep without `hasTouch` cannot see the
 *    nav on any screen: it is not in the DOM. Run this file with those flags
 *    removed and all ten screens report "no section nav" while the real
 *    phone is fine. That false failure cost a round of chasing a nav bug
 *    that did not exist, so do not remove them to make a check pass.
 *
 * Worth knowing when a size check seems not to bite: the chip rows are
 * `flex` containers with the default `align-items: stretch`. Shrinking one
 * chip proves nothing, because its taller siblings set the row height and
 * the short one stretches back up. The shipped bug was a whole row being
 * small at once, and that is what reproduces here.
 *
 *   npm run check:touch
 */
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Playwright, from wherever it is. Same reasoning as scripts/smoke.mjs. */
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

const PORT = Number(process.env.PORT) || 4225;
const BASE = `http://127.0.0.1:${PORT}`;

/*
 * 36px, not 44px.
 *
 * Apple asks for 44 and WCAG 2.5.8 accepts 24. This app's own thumb size is
 * `h-9`, which is 36, so 36 is the floor the design already committed to and
 * the one worth defending. Raising this to 44 is a design change, not a
 * tightening of a check: it would ask for a taller header than the app has.
 *
 * Width is checked at 28 rather than 36 because a lone icon button can be
 * narrower than it is tall and still be an easy target.
 */
const MIN_HEIGHT = 36;
const MIN_WIDTH = 28;

/*
 * The shelves, and the things that open on top of them.
 *
 * The drawers are the half that was missing. The first version of this file
 * swept the ten shelves and called the app clean, while the chip rows inside
 * the goss and upcoming drawers were never rendered on any of them, so
 * breaking one on purpose changed nothing and the check looked blind when it
 * was merely pointed somewhere else. A control the nav can reach is in
 * scope. `open` is the thumb that reaches it.
 */
const SURFACES = [
  ['opening', '/'],
  ['browse', '/?mode=grid&view=all'],
  ['for you', '/?mode=grid&view=genius'],
  ['deals', '/?mode=grid&view=deals'],
  ['plus', '/?mode=grid&view=plus'],
  ['soon', '/?mode=grid&view=soon'],
  ['played', '/?mode=grid&view=backlog'],
  ['curated', '/?mode=grid&view=curated'],
  ['search', '/?mode=grid&q=hollow%20knight'],
  ['trending', '/?mode=grid&view=trending'],
  ['goss', '/?read=goss'],
  ['upcoming', '/?read=upcoming'],
  // Opened by a tap rather than a link, so the check has to do the tapping.
  ['filters', '/?mode=grid&view=all', { open: 'button[aria-label="Filters"]' }],
  ['character', '/?mode=grid&view=all', { open: 'button[aria-label^="Level "]' }],
];

const server = spawn('node', ['scripts/serve-local.mjs', '--port', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
const stop = () => server.kill();
process.on('exit', stop);

const ready = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/`)).ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

if (!(await ready())) {
  console.error(`no server on ${BASE} after 30s`);
  process.exit(1);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
/*
 * A real phone context, and a blocked service worker.
 *
 * The worker serves its own cached copy of the app, so with it running the
 * page under test is whatever was cached on some earlier run rather than the
 * build this check just made. That mistake has been made in this repo before.
 */
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
  serviceWorkers: 'block',
});

/**
 * Everything a thumb can hit, with what is wrong with it.
 *
 * Returning the offenders rather than a count is deliberate: a count says a
 * screen is broken without saying which control to go and fix, and the first
 * version of this sweep printed `small taps 26` and sent me reading the whole
 * component tree.
 */
const measure = ({ minHeight, minWidth }) => {
  const doc = document.documentElement;
  const tooSmall = [];
  const selector = 'button, a[href], [role="button"], input, select, summary';

  /*
   * What a thumb can actually land on, which is not always the element's box.
   *
   * This app uses a stretched-overlay idiom in its cards: the headline is an
   * `<a>` with `after:absolute after:inset-0`, so an invisible layer covers
   * the whole card and a tap anywhere on it opens the story. The anchor's own
   * rect is one line of text, around 19px, and measuring that reported forty
   * perfectly good headlines as unhittable. Reading the pseudo-element is the
   * difference between measuring the target and measuring the label.
   */
  const hitBox = (node) => {
    const box = node.getBoundingClientRect();
    const after = getComputedStyle(node, '::after');
    const stretched =
      after.position === 'absolute' &&
      after.content !== 'none' &&
      ['top', 'right', 'bottom', 'left'].every((side) => after.getPropertyValue(side) === '0px');
    if (!stretched) return box;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).position === 'static') continue;
      const outer = parent.getBoundingClientRect();
      return outer.width > 0 && outer.height > 0 ? outer : box;
    }
    return box;
  };

  for (const node of document.querySelectorAll(selector)) {
    const box = hitBox(node);
    if (box.width === 0 || box.height === 0) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
    if (node.closest('[aria-hidden="true"]')) continue;
    if (box.height >= minHeight && box.width >= minWidth) continue;
    tooSmall.push({
      label: (node.getAttribute('aria-label') || node.textContent || node.tagName).trim().slice(0, 34),
      height: Math.round(box.height),
      width: Math.round(box.width),
    });
  }
  const nav = document.querySelector('nav[aria-label="Sections"]');
  return {
    // Anything wider than the screen is a horizontal-scroll bug on a phone.
    overflow: doc.scrollWidth - doc.clientWidth,
    tooSmall,
    // The nav is how you leave a screen. A screen without it is a dead end.
    hasNav: Boolean(nav) && nav.getBoundingClientRect().height > 0,
  };
};

const failed = [];
for (const [name, url, options] of SURFACES) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 80)));
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  if (options?.open) {
    /*
     * A missing opener is a failure, not a skip.
     *
     * Silently sweeping the shelf underneath would report a pass for a panel
     * this check never opened, which is the failure mode that let the drawers
     * go unmeasured in the first place.
     */
    const opener = page.locator(options.open).first();
    if ((await opener.count()) === 0) {
      failed.push(`${name}: nothing matches ${options.open}, so the panel never opened`);
      console.error(`FAIL ${name.padEnd(10)} nothing matches ${options.open}`);
      await page.close();
      continue;
    }
    await opener.tap();
    await page.waitForTimeout(900);
  }

  const result = await page.evaluate(measure, { minHeight: MIN_HEIGHT, minWidth: MIN_WIDTH });
  const problems = [];
  if (result.overflow > 0) problems.push(`scrolls ${result.overflow}px sideways`);
  if (!result.hasNav) problems.push('no section nav');
  for (const hit of result.tooSmall) {
    problems.push(`"${hit.label}" is ${hit.height}x${hit.width}`);
  }
  for (const message of errors) problems.push(`threw: ${message}`);

  if (problems.length > 0) {
    failed.push(`${name}: ${problems.join('; ')}`);
    console.error(`FAIL ${name.padEnd(10)} ${problems.join('; ')}`);
  } else {
    console.log(` ok  ${name.padEnd(10)} no overflow, every target >= ${MIN_HEIGHT}px, nav present`);
  }
  await page.close();
}

await browser.close();
stop();

if (failed.length > 0) {
  console.error(`\n${failed.length} of ${SURFACES.length} screens have problems:`);
  for (const line of failed) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`\nall ${SURFACES.length} screens pass on a touch phone at 390px`);
