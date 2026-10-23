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
import { loadBlob } from './history.mjs';
import { DISCOVERED_KEY, PLUS_KEY, STEAM_MATCH_KEY } from './keys.mjs';
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

async function plusIndex() {
  if (plusCache && Date.now() - plusCache.at < PLUS_TTL_MS) return plusCache.games;
  const games = (await loadBlob(PLUS_KEY))?.games ?? {};
  plusCache = { games, at: Date.now() };
  return games;
}

/** Baked at deploy, topped up by the nightly sweep. */
async function index() {
  if (merged && Date.now() - merged.at < MERGE_TTL_MS) return merged.rows;

  const discovered = (await loadBlob(DISCOVERED_KEY))?.games ?? [];
  const byId = new Map();
  for (const row of baked) byId.set(row.id, row);
  for (const row of discovered) byId.set(row.id, row);

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

export async function searchStore({
  q = '',
  genre = '',
  platform = '',
  sort = 'relevance',
  page = 0,
  exclude = [],
  plusOnly = false,
} = {}) {
  const rows = await index();
  const plus = await plusIndex();
  const query = parseQuery(q);
  const skip = new Set(exclude.map((title) => fold(title)));

  let hits = rows.filter((row) => {
    if (!row.name) return false;
    // Only games the scan has actually confirmed. A game it has not reached
    // yet is unknown, so it is absent here rather than assumed excluded.
    if (plusOnly && !plus[row.id]?.included) return false;
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
    games: hits.slice(start, start + PAGE_SIZE).map(({ search: _search, ...row }) => {
      const covered = plus[row.id];
      return covered?.included
        ? { ...row, plusIncluded: true, plusTier: covered.tier ?? null }
        : row;
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
    checked: rows.length,
    of: (await index()).length,
  };
};
