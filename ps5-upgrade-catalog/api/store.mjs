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
import { DISCOVERED_KEY } from './keys.mjs';
import { fold, indexText, parseQuery, scoreMatch } from './search.mjs';

const PAGE_SIZE = 36;
const MERGE_TTL_MS = 30 * 60 * 1000;

let merged = null;

/** Baked at deploy, topped up by the nightly sweep. */
async function index() {
  if (merged && Date.now() - merged.at < MERGE_TTL_MS) return merged.rows;

  const discovered = (await loadBlob(DISCOVERED_KEY))?.games ?? [];
  const byId = new Map();
  for (const row of baked) byId.set(row.id, row);
  for (const row of discovered) byId.set(row.id, row);

  const rows = [...byId.values()].map((row) => ({ ...row, search: indexText(row.name ?? '') }));
  merged = { rows, at: Date.now() };
  return rows;
}

/** PlayStation's own rating, discounted until enough people have voted. */
const ratingScore = (row) => {
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
} = {}) {
  const rows = await index();
  const query = parseQuery(q);
  const skip = new Set(exclude.map((title) => fold(title)));

  let hits = rows.filter((row) => {
    if (!row.name) return false;
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
    games: hits.slice(start, start + PAGE_SIZE).map(({ search: _search, ...row }) => row),
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
