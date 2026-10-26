/**
 * Picks across the whole mirror, worked out where the mirror is.
 *
 * The phone holds the 506 written-up games and nothing else, so picks made on
 * it can only ever be drawn from those. The other 8,800 are here, in an index
 * that is 5MB and grows every time it is rebuilt, which is not a thing to
 * send to a phone on mobile data so it can sort it.
 *
 * So the profile travels instead of the catalog. It is a few hundred short
 * strings and their weights, it is derived on the device from what the reader
 * has rated, and it says nothing about who they are: no id, no account, no
 * address. Nothing is stored at this end. A request arrives, is ranked
 * against, and is forgotten.
 */
import {
  scoreGame,
  diversify,
  unpackTaste,
  explain,
  normalizeTitle,
  hasDistinctiveReason,
} from '../src/genius.js';
import { storeRows } from './store.mjs';

/**
 * Bounds, because this endpoint accepts a body from anyone who can reach it.
 *
 * A profile is a few hundred features in normal use; the ceiling is an order
 * of magnitude above that so nothing real is turned away, and low enough that
 * a request cannot be made expensive on purpose.
 */
const MAX_FEATURES = 4_000;
const MAX_EXCLUDE = 5_000;
const MAX_LIMIT = 60;

/** Ranking all 9,222 against one profile is fast; diversifying them is not. */
const SHORTLIST = 240;

export function parsePicksRequest(body) {
  if (!body || typeof body !== 'object') return { error: 'expected a JSON object' };

  const weights = body.taste?.weights;
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
    return { error: 'taste.weights must be an object' };
  }
  const features = Object.keys(weights);
  if (features.length > MAX_FEATURES) {
    return { error: `taste.weights holds ${features.length} features, over the ${MAX_FEATURES} limit` };
  }

  const rawExclude = Array.isArray(body.exclude) ? body.exclude : [];
  if (rawExclude.length > MAX_EXCLUDE) {
    return { error: `exclude holds ${rawExclude.length} ids, over the ${MAX_EXCLUDE} limit` };
  }

  /*
   * Titles as well as ids, because the same game has two of them.
   *
   * A write-up is excluded by its slug, spiritfarer. The mirror calls that
   * game "Spiritfarer: Farewell Edition" under a numeric id, so excluding the
   * slug does nothing here and the first thing recommended to somebody who
   * had just said they liked Spiritfarer was Spiritfarer.
   */
  const rawTitles = Array.isArray(body.excludeTitles) ? body.excludeTitles : [];
  if (rawTitles.length > MAX_EXCLUDE) {
    return { error: `excludeTitles holds ${rawTitles.length} entries, over the ${MAX_EXCLUDE} limit` };
  }

  const limit = Number(body.limit);
  return {
    taste: unpackTaste(body.taste),
    // Ids arrive as numbers from the mirror and strings from the write-ups.
    exclude: new Set(rawExclude.map((id) => String(id))),
    excludeTitles: new Set(rawTitles.map((title) => normalizeTitle(title)).filter(Boolean)),
    limit: Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT) : 24,
  };
}

export async function pickFromMirror(body) {
  const parsed = parsePicksRequest(body);
  if (parsed.error) return parsed;

  const { taste, exclude, excludeTitles, limit } = parsed;
  if (taste.weights.size === 0) return { games: [], total: 0, reason: 'no profile' };

  const rows = await storeRows();
  const ranked = [];
  for (const row of rows) {
    if (exclude.has(String(row.id))) continue;
    if (excludeTitles.has(normalizeTitle(row.name))) continue;
    const scored = scoreGame(row, taste);
    if (scored.score <= 0) continue;
    ranked.push({ game: row, score: scored.score, hits: scored.hits });
  }
  ranked.sort((a, b) => b.score - a.score);

  const picks = diversify(ranked.slice(0, SHORTLIST), limit);
  return {
    games: picks.map(({ game, score, hits }) => ({
      ...game,
      // The search text is an index-building detail and is several hundred
      // bytes a row, which is most of the response if it goes out.
      search: undefined,
      pickScore: Math.round(score * 1000) / 1000,
      reason: explain(hits),
      distinctive: hasDistinctiveReason(hits),
    })),
    total: ranked.length,
  };
}
