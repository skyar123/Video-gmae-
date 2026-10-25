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

import { loadBlob, readBlob, saveBlob } from './history.mjs';
import { PLUS_KEY, PLUS_LOG_KEY } from './keys.mjs';
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

/**
 * What a stored entry is expected to contain.
 *
 * Age ratings were added to this scan after about 1,400 games had already
 * been recorded, and those entries are not wrong, just thin. Without a
 * version they would have looked complete and sat unread behind a 30-day
 * recheck, so the library would have shown no ratings for a month. Bumping
 * this makes every older entry due again at once.
 */
const ENTRY_VERSION = 2;

/** How much of a run goes to games never seen before, rather than re-reads. */
const FRESH_SHARE = 0.7;

/** Runs an unreadable index is stepped around before it is rebuilt instead. */
const READ_FAILURES_BEFORE_REBUILD = 3;

/** The store page's own answer, or null when the page cannot be read. */
export function parsePlusHtml(html) {
  if (!/"discountedPrice":"Included"/.test(html)) return { included: false, tier: null };
  const upsell = (html.match(/"displayUpsellText":"([^"]{5,200})"/) || [])[1] ?? '';
  const tier = (upsell.match(/PlayStation Plus (Extra|Premium|Deluxe)/) || [])[1] ?? null;
  // Essential is online play, not a game catalog, so it is not inclusion.
  if (!tier) return { included: false, tier: null };
  return { included: true, tier: `PlayStation Plus ${tier}` };
}

/*
 * Read until both answers are in hand, then stop.
 *
 * These pages run from 430KB to 1.1MB and most of that is reviews and
 * recommendations. What this scan wants sits much earlier: the price block,
 * carrying the Plus marker and the tier, around 80KB, and the content rating
 * about 100KB to 130KB in. Measured across eight games the furthest either
 * ran was 133KB.
 *
 * Downloading the remainder 500 times a run is a few hundred MB for nothing,
 * on a function with fifteen minutes to live. So the body is read in chunks
 * and dropped once both blocks have gone by with room to spare.
 *
 * It waits for both rather than the first one it sees. Stopping at the price
 * block alone looked right and was not: a first attempt did that, and the
 * rating sits well past it, so every game came back correctly flagged for PS
 * Plus and silently unrated. Eight of eight disagreed with a full read. That
 * is the shape of mistake this cannot make, because nothing about it looks
 * like a failure afterwards, so the cap is the backstop rather than the plan
 * and sits far above anything observed.
 */
const READ_CAP = 400_000;
const PRICE_MARKER = '"discountedPrice"';
const RATING_MARKER = '"contentRating":{"__typename":"ProductContentRating"';
/** Past the price block, and past the rating's own 2600-byte window. */
const PRICE_TAIL = 4000;
const RATING_TAIL = 3000;

const satisfied = (text) => {
  const price = text.indexOf(PRICE_MARKER);
  if (price < 0 || text.length < price + PRICE_TAIL) return false;
  const rating = text.indexOf(RATING_MARKER);
  return rating >= 0 && text.length >= rating + RATING_TAIL;
};

async function readCapped(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < READ_CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (satisfied(text)) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return text;
}

async function readConcept(id) {
  try {
    const response = await fetch(`https://store.playstation.com/en-us/concept/${id}`, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const html = await readCapped(response);
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
/**
 * Records what a scan did, so coverage that stops moving can be read rather
 * than guessed at.
 *
 * Coverage sat at exactly 1,700 of 8,885 for two days running. From outside
 * there was no way to tell whether the scan was not running, running and
 * finding nothing, or throwing: the callers catch and log, and the logs are
 * not something a reader of the site can see. The calendar had the same
 * problem and the same answer. A scan that refuses to make progress should
 * say so in the open.
 */
async function notePlusScan(outcome) {
  try {
    await saveBlob(PLUS_LOG_KEY, { ...outcome, at: new Date().toISOString() });
  } catch {
    // A failure to record a failure is not worth propagating.
  }
}

export const lastPlusScan = async () => (await loadBlob(PLUS_LOG_KEY)) ?? null;

export async function scanPlusBatch(ids, options = {}) {
  try {
    const outcome = await runPlusBatch(ids, options);
    await notePlusScan({ ok: true, ...outcome });
    return outcome;
  } catch (error) {
    await notePlusScan({ ok: false, error: String(error?.message ?? error).slice(0, 200) });
    throw error;
  }
}

/**
 * Which games a run spends its budget on, given the two queues.
 *
 * Separated out because the arithmetic is the whole point and it is not
 * obvious by eye: the share has to round, either queue can be shorter than
 * its share, and whatever one queue cannot use has to go to the other or a
 * run ends up asking for far less than its limit.
 */
export function planPlusBatch(fresh, again, limit) {
  const freshShare = Math.min(fresh.length, Math.ceil(limit * FRESH_SHARE));
  const againShare = Math.min(again.length, limit - freshShare);
  const spare = limit - freshShare - againShare;
  return [...fresh.slice(0, freshShare + Math.max(0, spare)), ...again.slice(0, againShare)].slice(
    0,
    limit,
  );
}

/**
 * Reads the index, giving a blip a couple of chances before believing it.
 *
 * Most read failures are a moment's trouble rather than a broken object, and
 * a retry inside the run settles those without involving the rest of this at
 * all. What survives three tries seconds apart is a real problem.
 */
async function readIndex(attempts = 3, gapMs = 400) {
  let last = { ok: false, value: null, error: 'not attempted' };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await readBlob(PLUS_KEY);
    if (last.ok) return last;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  return last;
}

async function runPlusBatch(ids, { limit = PLUS_BATCH, gapMs = 400, now = Date.now() } = {}) {
  /*
   * A failed read must not become a destructive write.
   *
   * This reads the whole index, adds to it and saves it back under one key.
   * A read that fails is indistinguishable from an empty index unless it
   * says so, and treating the first as the second means saving a fresh index
   * holding only what this run collected, over everything already known.
   *
   * That is not hypothetical. Coverage went from 1,941 games to zero between
   * one afternoon and the next: the PS Plus collection answered with nothing,
   * and every age rating went with it, which took the kid-friendly filter
   * too, since it reads the same index. So a read that did not work ends the
   * run, and the index is left exactly as it is for the next one.
   */
  const stored = await readIndex();
  /*
   * Refusing has to be temporary, or it becomes its own outage.
   *
   * An index that cannot be read once is probably a blip worth stepping
   * around. An index that cannot be read three runs running is not coming
   * back, and a scan that keeps declining to touch it leaves the PS Plus
   * collection empty for ever out of respect for data nobody can read.
   * After three it rebuilds from nothing, which is slow but finite.
   */
  const failures = ((await lastPlusScan())?.readFailures ?? 0) + 1;
  if (!stored.ok && failures < READ_FAILURES_BEFORE_REBUILD) {
    return {
      readFailures: failures,
      asked: 0,
      answered: 0,
      due: 0,
      fresh: 0,
      waiting: { fresh: 0, again: 0 },
      offered: ids.length,
      checked: 0,
      included: 0,
      rated: 0,
      remaining: 0,
      skipped: `the index could not be read (${failures} of ${READ_FAILURES_BEFORE_REBUILD}), so nothing was written over it`,
      error: stored.error ?? null,
    };
  }
  const rebuilding = !stored.ok;
  const games = stored.value?.games ?? {};

  const fresh = [];
  const again = [];
  for (const id of ids) {
    const seen = games[id];
    if (!seen) {
      fresh.push(id);
      continue;
    }
    // Written by an older version of this scan, so it is missing something
    // the current one collects.
    if ((seen.v ?? 1) < ENTRY_VERSION) {
      again.push(id);
      continue;
    }
    const at = seen.at ? Date.parse(seen.at) : NaN;
    if (!Number.isFinite(at) || now - at > RECHECK_MS) again.push(id);
  }

  /*
   * A run does both, rather than whichever comes first in browse order.
   *
   * It used to take the due list in browse order and cut it at the limit.
   * Browse order is best-rated first, which is exactly where the already
   * scanned games are, so after the entry version went up every run spent
   * its whole budget re-reading games it already knew. Coverage sat at 1,700
   * of 8,885 for two days while the ratings count climbed underneath it, and
   * from outside that is indistinguishable from a scan that has died: the
   * one number that cannot move during a migration is the one being watched.
   *
   * Most of a run goes on games never seen before, so coverage grows every
   * night, and the rest keeps the re-reads moving. Whichever queue runs dry
   * hands its share to the other, so the last stretch of either is not spent
   * at a fraction of the batch size.
   */
  const batch = planPlusBatch(fresh, again, limit);
  const freshIds = new Set(fresh);
  const due = [...fresh, ...again];

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

  for (const id of batch) {
    asked += 1;
    const result = await readConcept(id);
    if (result) {
      answered += 1;
      unsaved += 1;
      games[id] = { ...result, v: ENTRY_VERSION, at: new Date(now).toISOString() };
    }
    if (unsaved >= CHECKPOINT_EVERY) await checkpoint();
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  await checkpoint();

  const rows = Object.values(games);
  return {
    asked,
    answered,
    readFailures: 0,
    rebuilding: rebuilding || undefined,
    due: due.length,
    // Which queue the work went to. "asked 500, fresh 0" is a migration
    // eating the budget; "asked 500, fresh 350" is coverage growing.
    // Counted against the partition taken before the loop, because `games`
    // is the stored object itself and the loop writes into it: asking it
    // afterwards which ids were new would answer none of them.
    fresh: batch.filter((id) => freshIds.has(id)).length,
    waiting: { fresh: fresh.length, again: again.length },
    offered: ids.length,
    checked: rows.length,
    included: rows.filter((row) => row.included).length,
    rated: rows.filter((row) => row.ageRating).length,
    remaining: due.length - asked,
  };
}
