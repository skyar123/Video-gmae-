/**
 * Which store games a PlayStation Plus subscription actually covers.
 *
 * A game's own store page is the only source that has been right: it carries
 * `"discountedPrice":"Included"` and names the tier in its upsell text, which
 * is what `parsePlus` reads for the hand-written catalog.
 *
 * PlayStation's marketing page at /ps-plus/games/ looks like a shortcut and
 * is not one. It lists 262 concept ids in a single request, which is tempting,
 * and spot-checking them against the store itself settled it: Alan Wake 2,
 * Age of Wonders 4 and AEW: Fight Forever are all on that page and all report
 * not included, while Horizon Forbidden West and DREDGE are absent from it and
 * both report included with Extra. Every one of the 47 catalog games the price
 * read knows to be included was missing from it. Whatever that list is, it is
 * not the current catalog, and badging a game "free" when it is not is worse
 * than showing nothing at all.
 *
 * So this walks the store itself, a batch a night, the way the Steam matcher
 * does. Coverage builds instead of arriving, and what it reports is true.
 */

import { loadBlob, saveBlob } from './history.mjs';
import { PLUS_KEY } from './keys.mjs';
import { ratingFromConcept } from './rating.mjs';

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
};

/** A night's worth of polite requests, at roughly one every 400ms. */
export const PLUS_BATCH = 250;

/** Write progress this often, so a run that is cut short keeps what it got. */
const CHECKPOINT_EVERY = 50;

/** Rechecked after this long: games join and leave the catalog monthly. */
const RECHECK_MS = 30 * 24 * 60 * 60 * 1000;

/** The store page's own answer, or null when the page cannot be read. */
export function parsePlusHtml(html) {
  if (!/"discountedPrice":"Included"/.test(html)) return { included: false, tier: null };
  const upsell = (html.match(/"displayUpsellText":"([^"]{5,200})"/) || [])[1] ?? '';
  const tier = (upsell.match(/PlayStation Plus (Extra|Premium|Deluxe)/) || [])[1] ?? null;
  // Essential is online play, not a game catalog, so it is not inclusion.
  if (!tier) return { included: false, tier: null };
  return { included: true, tier: `PlayStation Plus ${tier}` };
}

async function readConcept(id) {
  try {
    const response = await fetch(`https://store.playstation.com/en-us/concept/${id}`, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    /*
     * The age rating comes along for free.
     *
     * This page is already being fetched and already carries the board
     * rating and its descriptors, which the mirror has for none of its
     * 8,885 games. Unlike a price or a Plus tier it does not go stale: a
     * game is rated once and stays rated, so a reading taken today is still
     * true a month from now, which is the whole reason it is worth storing
     * from a scan that only comes round monthly.
     */
    return { ...parsePlusHtml(html), ageRating: ratingFromConcept(html) ?? null };
  } catch {
    return null;
  }
}

/**
 * Checks the next batch of store concepts and folds the answers in.
 *
 * Only a page that actually answered is recorded, so a timeout leaves that
 * game to be asked again next time rather than being filed as excluded.
 */
export async function scanPlusBatch(ids, { limit = PLUS_BATCH, gapMs = 400, now = Date.now() } = {}) {
  const stored = (await loadBlob(PLUS_KEY)) ?? {};
  const games = stored.games ?? {};

  const due = ids.filter((id) => {
    const seen = games[id];
    if (!seen) return true;
    const at = seen.at ? Date.parse(seen.at) : NaN;
    return !Number.isFinite(at) || now - at > RECHECK_MS;
  });

  /*
   * Saved as it goes, not at the end.
   *
   * The first version wrote once after the whole batch, and a run that hit
   * the function's time limit threw away everything it had learned: two
   * triggers of 1,200 games each left the store reporting nought checked.
   * At roughly a second a game that batch is twenty minutes, and the limit
   * is fifteen. Checkpointing means a killed run still moves coverage
   * forward, and the next one picks up from where it actually got to.
   */
  let asked = 0;
  let answered = 0;
  let unsaved = 0;
  const checkpoint = async () => {
    if (unsaved === 0) return;
    await saveBlob(PLUS_KEY, { games, at: new Date(now).toISOString() });
    unsaved = 0;
  };

  for (const id of due.slice(0, limit)) {
    asked += 1;
    const result = await readConcept(id);
    if (result) {
      answered += 1;
      unsaved += 1;
      games[id] = { ...result, at: new Date(now).toISOString() };
    }
    if (unsaved >= CHECKPOINT_EVERY) await checkpoint();
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  await checkpoint();

  const included = Object.values(games).filter((row) => row.included).length;
  return { asked, answered, checked: Object.keys(games).length, included, remaining: due.length - asked };
}
