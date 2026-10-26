/**
 * The whole PlayStation Store, as far as we have walked it.
 *
 * This is the mirror: every concept ID that renders as a game, with the facts
 * the store itself publishes — name, date, platforms, genres, publisher, art,
 * price and PlayStation's own star rating. Nothing here is hand-judged, which
 * is exactly the difference between it and the curated catalog. The 298
 * hand-picked entries keep their descriptions, kid-friendly verdicts and
 * representation notes; these are the long tail behind them.
 *
 * Searching happens here rather than in the browser because the index is a few
 * megabytes and nobody should download it to look up one name.
 */

import baked from './store-index.json' with { type: 'json' };
import { loadPlusIndex } from './plus.mjs';
import { loadBlob } from './history.mjs';
import { DISCOVERED_KEY, STEAM_MATCH_KEY } from './keys.mjs';
import { fold, indexText, parseQuery, scoreMatch } from './search.mjs';

const PAGE_SIZE = 36;
const MERGE_TTL_MS = 30 * 60 * 1000;

let merged = null;
let plusCache = null;

/*
 * Read separately from the merged index, and far more often.
 *
 * PS Plus coverage was folded into the merge, which is cached for half an
 * hour. That meant a game the scan had just confirmed could not show its
 * badge until the merge expired, so the scan appeared to be doing nothing
 * for up to thirty minutes at a time. The index is expensive and changes
 * nightly; this is one small blob that changes every fifty games.
 */
const PLUS_TTL_MS = 60 * 1000;

/**
 * Whether a rating means a child can play it, matching the catalog's rule.
 *
 * The content verdict is not enough on its own: the board tier is applied as
 * a floor when deriving it, so a Teen game with bland descriptors reads as
 * "mild", and mild was passing. The tier gets a veto here too.
 */
/**
 * Whether a game asks for money once you are already inside it.
 *
 * Straight from the rating board rather than inferred: ESRB publishes these
 * as interactive elements alongside the content descriptors, and names the
 * loot-box case separately as "In-Game Purchases (Includes Random Items)".
 * So this is a fact about the game, not a guess from its genre or its price.
 */
const SELLS_INSIDE = /purchases/i;
export const hasInGamePurchases = (ageRating) =>
  (ageRating?.interactive ?? []).some((entry) => SELLS_INSIDE.test(entry));

const isKidFriendly = (ageRating) =>
  ['safe', 'mild'].includes(ageRating?.family) &&
  (ageRating?.tier === 'everyone' || ageRating?.tier === 'everyone10');

/*
 * What is covered by PS Plus, and how old everything is rated, from both
 * places that know.
 *
 * The crawler that bakes the index is already holding the exact bytes that
 * answer both questions, so it now reads them while it is there. That is the
 * base: every game in the mirror has an answer the day it ships, rather than
 * waiting on a nightly scan that had reached 2,833 of 8,885 after weeks.
 *
 * The scan still runs and still wins, because the catalog changes monthly and
 * a baked answer is only as fresh as the last deploy. It goes on top.
 */
async function plusIndex() {
  if (plusCache && Date.now() - plusCache.at < PLUS_TTL_MS) return plusCache.games;

  const games = {};
  for (const row of await index()) {
    const baked = {
      ...(row.plus ?? {}),
      ...(row.ageRating ? { ageRating: row.ageRating } : {}),
    };
    if (Object.keys(baked).length > 0) games[row.id] = baked;
  }
  Object.assign(games, await loadPlusIndex());

  plusCache = { games, at: Date.now() };
  return games;
}

/** Baked at deploy, topped up by the nightly sweep. */
async function index() {
  if (merged && Date.now() - merged.at < MERGE_TTL_MS) return merged.rows;

  const discovered = (await loadBlob(DISCOVERED_KEY))?.games ?? [];
  const byId = new Map();
  for (const row of baked) byId.set(row.id, row);
  /*
   * Folded in, not dropped on top.
   *
   * A swept row carries what the sweep collects: name, price, stars, art and
   * so on. It does not carry the age rating or the PS Plus answer, because
   * the sweep is looking for release dates. Setting it over the baked row
   * replaced the whole thing, so every game a sweep touched lost both, and a
   * sweep touches 1,500 a night. Coverage that took a full crawl to build
   * would have drained away a night at a time, invisibly, because nothing
   * about a game quietly losing its rating looks like a failure.
   *
   * So the sweep wins on what it actually saw, and anything it does not
   * collect survives underneath. An empty genre list is not something it saw.
   */
  for (const row of discovered) {
    const base = byId.get(row.id);
    if (!base) {
      byId.set(row.id, row);
      continue;
    }
    const merged = { ...base };
    for (const [key, value] of Object.entries(row)) {
      if (value == null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      merged[key] = value;
    }
    byId.set(row.id, merged);
  }

  // Steam ids found by the nightly matcher, which is what lets a mirror game
  // carry review scores and the pros and cons drawn from them. Absent until
  // that game's turn comes round, and absent for good for the many console
  // releases that are not on Steam at all.
  const matches = (await loadBlob(STEAM_MATCH_KEY))?.byId ?? {};

  const rows = [...byId.values()].map((row) => ({
    ...row,
    steamAppId: row.steamAppId ?? matches[row.id] ?? null,
    search: indexText(row.name ?? ''),
  }));
  merged = { rows, at: Date.now() };
  return rows;
}

/**
 * PlayStation's own rating, discounted until enough people have voted.
 *
 * Exported because the PS Plus scan walks the mirror in this order too. It
 * used to walk index order, which begins with one-vote shovelware, while the
 * reader's default view is this one. Full coverage takes a couple of hours
 * of scanning either way; the order decides whether the first badges land on
 * games anybody is looking at.
 */
export const ratingScore = (row) => {
  if (!row.stars) return 0;
  const confidence = Math.min((row.votes ?? 0) / 500, 1);
  return row.stars * confidence;
};

/** What counts as new. A season, which is how storefronts tend to think of it. */
export const NEW_RELEASE_DAYS = 90;

export async function searchStore({
  q = '',
  genre = '',
  platform = '',
  sort = 'relevance',
  page = 0,
  exclude = [],
  plusOnly = false,
  familyOnly = false,
  noPurchases = false,
  newOnly = false,
} = {}) {
  const rows = await index();
  const plus = await plusIndex();
  const query = parseQuery(q);
  const skip = new Set(exclude.map((title) => fold(title)));
  const newestFrom = Date.now() - NEW_RELEASE_DAYS * 86_400_000;
  const now = Date.now();

  let hits = rows.filter((row) => {
    if (!row.name) return false;
    // Only games the scan has actually confirmed. A game it has not reached
    // yet is unknown, so it is absent here rather than assumed excluded.
    if (plusOnly && !plus[row.id]?.included) return false;
    // Same rule the curated list follows: a game whose rating has not been
    // read is unknown, and unknown is not "fine for children".
    if (familyOnly && !isKidFriendly(plus[row.id]?.ageRating)) return false;
    // A game nobody has rated is unknown, not innocent, the same rule the
    // kid filter follows: absence is never read as a clean bill of health.
    if (noPurchases) {
      const rating = plus[row.id]?.ageRating;
      if (!rating || hasInGamePurchases(rating)) return false;
    }
    /*
     * Out in the last ninety days and already out.
     *
     * Both halves matter. The mirror carries games dated months ahead, so
     * asking only for recent dates hands back a list of things nobody can
     * play yet, which is the Soon tab's job and not this one. A game with no
     * date is unknown rather than new, so it is absent here, the same rule
     * the other filters follow.
     */
    if (newOnly) {
      const at = Date.parse(row.release ?? '');
      if (!Number.isFinite(at) || at < newestFrom || at > now) return false;
    }
    if (skip.has(row.search.folded)) return false;
    if (genre && !(row.genres ?? []).includes(genre)) return false;
    if (platform && !(row.platforms ?? []).includes(platform)) return false;
    return true;
  });

  if (query.folded) {
    hits = hits
      .map((row) => ({ row, score: scoreMatch(row.search, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || ratingScore(b.row) - ratingScore(a.row))
      .map((entry) => entry.row);
  } else if (sort === 'new') {
    hits = [...hits].sort((a, b) => new Date(b.release ?? 0) - new Date(a.release ?? 0));
  } else {
    hits = [...hits].sort((a, b) => ratingScore(b) - ratingScore(a));
  }

  const start = page * PAGE_SIZE;
  return {
    total: hits.length,
    page,
    pageSize: PAGE_SIZE,
    // The normalised name is a search artefact; it does not go over the wire.
    games: hits
      .slice(start, start + PAGE_SIZE)
      // `search` is a search artefact and `plus` is reported by name below,
      // so neither goes over the wire.
      .map(({ search: _search, plus: _plus, ...row }) => {
      const seen = plus[row.id];
      if (!seen) return row;
      return {
        ...row,
        ...(seen.included ? { plusIncluded: true, plusTier: seen.tier ?? null } : {}),
        ...(seen.ageRating ? { ageRating: seen.ageRating } : {}),
      };
    }),
    indexedAt: null,
  };
}

/** Every distinct genre in the mirror, for the browse filter. */
export async function storeGenres() {
  const rows = await index();
  const counts = new Map();
  for (const row of rows) {
    for (const genre of row.genres ?? []) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 12)
    .sort((a, b) => b[1] - a[1])
    .map(([genre, count]) => ({ genre, count }));
}

/**
 * The merged mirror, for anything that needs to walk all of it.
 *
 * Exported rather than rebuilt elsewhere: the merge underneath is the part
 * that keeps a nightly sweep from stripping games of their ratings, and a
 * second copy of that reasoning is a second place for it to go wrong.
 */
export const storeRows = () => index();

export const storeSize = async () => (await index()).length;

/**
 * How much of the mirror is marked as covered by PlayStation Plus.
 *
 * Reported because the alternative is guessing. When the badges did not show
 * up in production there was no way to tell a failed fetch of the Plus page
 * from a stale merge cache from a blob that never saved, and that is exactly
 * the blindness the feed diagnostics were added to end this morning.
 */
export const storePlusCount = async () => {
  // Both numbers come from the same place the rows do, so the diagnostic and
  // the badges can never disagree about what has been found.
  const rows = Object.values(await plusIndex());
  return {
    included: rows.filter((row) => row.included).length,
    rated: rows.filter((row) => row.ageRating).length,
    checked: rows.length,
    of: (await index()).length,
  };
};
