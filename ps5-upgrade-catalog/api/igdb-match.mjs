/**
 * Deciding which IGDB game a PlayStation Store row is, or refusing to.
 *
 * This is the whole risk in enriching the mirror. The store half is 9,222
 * rows that carry a name, a coarse genre and nothing else; IGDB carries the
 * genres, themes and keywords that would let every kind-of-game search in
 * this app reach beyond the 506 hand-written entries. Joining them is done
 * by name, because the store publishes no identifier IGDB knows.
 *
 * Matching by name is how the news story matcher went wrong, repeatedly and
 * memorably: The Wolf Among Us filed under Among Us, "voting is a true
 * superpower" filed under SuperPower. That matcher ended up almost entirely
 * guard, and so is this one. The rule it settled on applies here too: a
 * wrong join is worse than no join. A game with no IGDB data looks exactly
 * like what it is, a game nobody described. A game with the wrong IGDB data
 * is a lie the app tells confidently, and it would spread, because these
 * fields feed the search, the shelves and the reasons under every pick.
 *
 * So: exact normalised titles only. No fuzzy distance, no "closest match",
 * no accepting the top result because it was first. Where two candidates are
 * equally exact, the tie is broken on evidence (the platform, then the
 * release year) and abandoned if neither settles it.
 */

import { baseTitle, fold } from './search.mjs';

/** IGDB's platform ids for the consoles this app is about. */
const PLAYSTATION_IDS = new Set([167, 48, 9, 8, 7, 46, 38]);

/**
 * How far apart two release years may be and still be one game.
 *
 * A remaster usually lands years after the original and often shares its
 * exact name, which is the single most likely way to attach the wrong row:
 * the store sells the 2023 remake of Resident Evil 4 and IGDB also holds the
 * 2005 original under that name. Two years is wide enough for a staggered
 * console rollout and narrow enough to keep a remake off its ancestor.
 */
const YEAR_SLACK = 2;

const yearOf = (value) => {
  if (value == null) return null;
  // IGDB sends seconds; the store sends an ISO string.
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  const year = date.getUTCFullYear();
  return Number.isFinite(year) ? year : null;
};

/*
 * Two shapes reach this, and both are legitimate.
 *
 * `ask` hands back IGDB's raw rows, where a platform is an object with a
 * numeric id and the date is epoch seconds. `normaliseGame` has already
 * turned those into abbreviations and an ISO string, and dropped the ids on
 * the way. Rather than force one shape on every caller, which would mean the
 * enrichment path and the search path diverging, both are read here.
 *
 * The alternative was a matcher that silently believed every candidate was
 * off-console and every date unknown, because the fields it wanted were
 * named something else. That fails open, which in this file means guessing.
 */
const onPlayStation = (candidate) => {
  if (Array.isArray(candidate?.playstation) && candidate.playstation.length > 0) return true;
  const platforms = candidate?.platforms ?? [];
  return platforms.some((platform) => {
    if (typeof platform === 'number') return PLAYSTATION_IDS.has(platform);
    if (typeof platform === 'string') return /^ps[1-5p]?$|playstation|vita|psp/i.test(platform);
    return PLAYSTATION_IDS.has(platform?.id);
  });
};

/**
 * Every spelling of a store row worth comparing.
 *
 * `baseTitle` already strips the things that differ between a shop and a
 * catalogue: the edition suffix, the platform tag in brackets, and the
 * licensor bolted to the front. The store sells "Marvel's Spider-Man
 * Remastered" and IGDB lists "Spider-Man Remastered"; the store sells "God
 * of War Ragnarök: Digital Deluxe Edition" and IGDB lists "God of War
 * Ragnarök". Both of those are the same game and neither matches raw.
 *
 * The plain fold is kept as well, because stripping is not always right: a
 * game genuinely called "Deluxe Paint" should still match itself.
 */
export function titleKeys(name) {
  const keys = new Set();
  const plain = fold(name);
  if (plain) keys.add(plain);
  const base = baseTitle(name);
  if (base) keys.add(base);
  return keys;
}

/**
 * Which candidate is this row, or null.
 *
 * Returns `{ game, why }` so a caller can report how a join was made rather
 * than only how many were. The counts that matter when judging a run of this
 * are how many matched on a bare title and how many needed a tie broken,
 * because the second number is where a wrong join would hide.
 */
export function pickMatch(row, candidates = []) {
  const wanted = titleKeys(row?.name);
  if (wanted.size === 0 || candidates.length === 0) return null;

  const exact = candidates.filter((candidate) => {
    for (const key of titleKeys(candidate?.name)) if (wanted.has(key)) return true;
    return false;
  });
  if (exact.length === 0) return null;
  if (exact.length === 1) return { game: exact[0], why: 'one exact title' };

  /*
   * More than one game of that name, which is ordinary: a remaster, a
   * regional release, a compilation entry. Narrow on evidence, never on
   * order, because IGDB's result order is relevance and relevance is the
   * thing being decided.
   */
  const onConsole = exact.filter(onPlayStation);
  const pool = onConsole.length > 0 ? onConsole : exact;
  if (pool.length === 1) {
    return { game: pool[0], why: 'exact title, settled by platform' };
  }

  const storeYear = yearOf(row?.release ?? row?.releaseDate);
  if (storeYear != null) {
    const close = pool.filter((candidate) => {
      const year = yearOf(candidate?.first_release_date ?? candidate?.releasedAt);
      return year != null && Math.abs(year - storeYear) <= YEAR_SLACK;
    });
    if (close.length === 1) return { game: close[0], why: 'exact title, settled by year' };
  }

  // Two games of the same name on the same console in the same window. There
  // is nothing left to decide it with, and guessing here is exactly the
  // failure this file exists to prevent.
  return null;
}

/**
 * The fields worth keeping, and only those.
 *
 * Everything here is a label somebody wrote about the game. Nothing derived,
 * nothing scored, no summary text: a store row gets vocabulary it did not
 * have, not a second opinion about quality, which it already has from its
 * own star rating.
 */
export function enrichmentOf(game) {
  if (!game) return null;
  const names = (list) =>
    (list ?? [])
      .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
      .filter(Boolean);

  const genres = names(game.genres);
  const themes = names(game.themes);
  const keywords = names(game.keywords);
  if (genres.length === 0 && themes.length === 0 && keywords.length === 0) return null;

  return {
    igdbId: game.id ?? null,
    genres,
    themes,
    // Keywords are the long tail and the noisiest of the three, so they are
    // capped rather than taken whole: IGDB holds games with over a hundred,
    // and a feature seen once teaches nothing but costs memory everywhere.
    keywords: keywords.slice(0, 24),
  };
}
