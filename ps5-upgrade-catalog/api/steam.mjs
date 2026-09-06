/**
 * Live artwork, screenshots, trailers and sale prices for the catalog.
 *
 * Source is Valve's public storefront API, which needs no key and returns
 * everything in one pair of calls per game: capsule art, screenshots, trailer
 * streams and the current discount. It is a PC storefront, so the price it
 * reports is the PC price — the UI labels it as such and links out to the PS
 * Store, which has no public price API of its own.
 *
 * Shared by the Netlify function and the Vite dev middleware so both
 * environments serve byte-identical responses.
 */

import { loadBlob, recordAndSummarize } from './history.mjs';
import { predictPriceDrop } from './predict.mjs';

const SEARCH_URL = 'https://store.steampowered.com/api/storesearch/';
const DETAILS_URL = 'https://store.steampowered.com/api/appdetails';

/** How long a resolved game stays fresh in the per-instance cache. */
const CACHE_TTL_MS = 30 * 60 * 1000;
/** Games handed back per chunk request. Keeps URLs cache-friendly and small. */
export const CHUNK_SIZE = 15;
/** Blob key prefix for nightly-refreshed review data. */
export const REVIEW_KEY_PREFIX = 'reviews/chunk-';

const cache = new Map();
const inFlight = new Map();

/** Words that appear in a PlayStation title but not in the Steam listing. */
const EDITION_NOISE =
  /\b(the\s+)?(final\s+cut|director'?s?\s+cut|complete|definitive|farewell|reignited|remastered|special|deluxe|ultimate|gold|goty|game\s+of\s+the\s+year)\b|\b(edition|collection|trilogy|remaster)\b/gi;

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Title with edition noise stripped, for a looser second pass. */
function core(value) {
  return normalize(value.replace(EDITION_NOISE, ' ')) || normalize(value);
}

/**
 * Storefront entries that share a game's name but are not the game: outfits,
 * soundtracks, season passes. Steam reports all of them as type "app".
 */
const ACCESSORY =
  /\b(dlc|soundtrack|ost|outfit|costume|skin|pack|bundle|demo|artbook|audiobook|season pass|expansion|upgrade|wallpaper|avatar|beta|server|editor|sdk)\b/;

function isAccessoryFor(wanted, candidate) {
  return ACCESSORY.test(normalize(candidate)) && !ACCESSORY.test(normalize(wanted));
}

/**
 * Score a storefront hit against the title we asked for. Anything below
 * ACCEPT_SCORE is discarded: a placeholder beats confidently wrong artwork.
 */
const ACCEPT_SCORE = 70;

function score(wanted, candidate) {
  const w = normalize(wanted);
  const c = normalize(candidate);
  if (w === c) return 100;
  const wc = core(wanted);
  const cc = core(candidate);
  if (wc === cc) return 90;
  if (c.startsWith(w) && !isSequelOf(w, c)) return 80;
  if (w.startsWith(c) && !isSequelOf(c, w)) return 80;
  if (cc.startsWith(wc) && !isSequelOf(wc, cc) && wc.split(' ').length > 1) return 75;
  return 0;
}

/**
 * True when `longer` is just `shorter` plus a sequel marker — "TOEM 2" is not
 * a better match for "TOEM" than "TOEM: A Photo Adventure" is.
 */
function isSequelOf(shorter, longer) {
  return /^(\d+|i{2,3}|iv|vi{0,3}|ix|x)\b/.test(longer.slice(shorter.length).trim());
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'ps5-upgrade-catalog/1.0' },
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function formatMoney(cents, currency) {
  if (typeof cents !== 'number') return null;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function toPrice(overview, isFree) {
  if (isFree) return { isFree: true, discountPercent: 0, final: 0, finalFormatted: 'Free' };
  if (!overview) return null;
  const currency = overview.currency || 'USD';
  return {
    isFree: false,
    currency,
    initial: overview.initial,
    final: overview.final,
    discountPercent: overview.discount_percent || 0,
    initialFormatted: overview.initial_formatted || formatMoney(overview.initial, currency),
    finalFormatted: overview.final_formatted || formatMoney(overview.final, currency),
  };
}

/**
 * Age rating, reduced to a single "is this ok for a kid" verdict.
 *
 * ESRB is preferred because it is the US board. Most smaller titles were never
 * submitted to it, so the chain falls back through the other boards the
 * storefront carries; those agree with the ESRB rating where both exist.
 * Nothing is inferred from the game itself: with no board at all the answer is
 * "unknown", not "probably fine". Some entries are auto-generated rather than
 * issued by a board, and the detail view says so.
 */
const BOARDS = [
  { key: 'esrb', label: 'ESRB', tiers: { ec: 'everyone', e: 'everyone', e10: 'everyone10', t: 'teen', m: 'mature', ao: 'mature' } },
  { key: 'pegi', label: 'PEGI', tiers: { 3: 'everyone', 7: 'everyone10', 12: 'teen', 16: 'mature', 18: 'mature' } },
  { key: 'usk', label: 'USK', tiers: { 0: 'everyone', 6: 'everyone10', 12: 'teen', 16: 'mature', 18: 'mature' } },
  { key: 'oflc', label: 'OFLC', tiers: { g: 'everyone', pg: 'everyone10', m: 'teen', ma15: 'mature', r18: 'mature', x18: 'mature' } },
  { key: 'dejus', label: 'DJCTQ', tiers: { l: 'everyone', 10: 'everyone10', 12: 'teen', 14: 'teen', 16: 'mature', 18: 'mature' } },
  { key: 'igrs', label: 'IGRS', tiers: { 3: 'everyone', 7: 'everyone10', 12: 'teen', 16: 'mature', 18: 'mature' } },
  { key: 'steam_germany', label: 'Steam Germany', tiers: { 0: 'everyone', 6: 'everyone10', 12: 'teen', 16: 'mature', 18: 'mature' } },
];

const splitDescriptors = (value) =>
  (value ?? '')
    .split(/[\r\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

function toAgeRating(data) {
  const boards = data.ratings ?? {};

  let verdict = null;
  for (const board of BOARDS) {
    const entry = boards[board.key];
    const raw = entry?.rating;
    if (raw == null) continue;
    const tier = board.tiers[String(raw).toLowerCase()];
    if (!tier) continue;
    verdict = {
      tier,
      source: board.label,
      rating: String(raw).toUpperCase(),
      // Steam generates some of these rather than quoting an issued rating.
      official: entry.rating_generated !== '1',
    };
    break;
  }

  // Descriptors are most useful in English, so prefer the English-language
  // boards for them regardless of which one set the tier.
  const descriptors = splitDescriptors(
    boards.esrb?.descriptors ?? boards.pegi?.descriptors ?? boards.oflc?.descriptors,
  );
  const notes = data.content_descriptors?.notes?.trim() || null;

  if (!verdict && !descriptors.length && !notes) return null;

  return {
    tier: verdict?.tier ?? 'unknown',
    source: verdict?.source ?? null,
    rating: verdict?.rating ?? null,
    official: verdict?.official ?? false,
    esrb: boards.esrb?.rating ? String(boards.esrb.rating).toUpperCase() : null,
    pegi: boards.pegi?.rating ? String(boards.pegi.rating) : null,
    descriptors: descriptors.slice(0, 6),
    notes,
  };
}

function toMedia(data) {
  const screenshots = (data.screenshots || []).slice(0, 6).map((shot) => ({
    thumb: shot.path_thumbnail,
    full: shot.path_full,
  }));
  const videos = (data.movies || []).slice(0, 3).map((movie) => ({
    id: String(movie.id),
    name: movie.name,
    thumbnail: movie.thumbnail,
    // Steam serves adaptive streams only; the client plays these through hls.js.
    hls: movie.hls_h264 || null,
    dash: movie.dash_h264 || null,
  }));
  return { screenshots, videos };
}

async function resolveUncached(title, countryCode, knownAppId) {
  // A catalog entry that already carries its storefront id skips the search
  // step entirely: one upstream call instead of two, and no chance of drift.
  if (knownAppId) return detailsFor(title, knownAppId, countryCode, null);

  const search = await fetchJson(
    `${SEARCH_URL}?term=${encodeURIComponent(title)}&cc=${countryCode}&l=en`,
  );
  const items = Array.isArray(search?.items) ? search.items : [];

  const best = pickBest(title, items);
  if (!best) {
    // Second pass: some listings only surface under the plain, edition-free name.
    const relaxed = core(title);
    if (relaxed && relaxed !== normalize(title)) {
      const retry = await fetchJson(
        `${SEARCH_URL}?term=${encodeURIComponent(relaxed)}&cc=${countryCode}&l=en`,
      );
      const fallback = pickBest(title, Array.isArray(retry?.items) ? retry.items : []);
      if (fallback) return detailsFor(title, fallback.item.id, countryCode, fallback.item);
    }
    return { title, matched: false, reason: 'no-confident-match' };
  }

  return detailsFor(title, best.item.id, countryCode, best.item);
}

/** Highest-scoring storefront hit, preferring the least-embellished name. */
function pickBest(title, items) {
  let best = null;
  for (const item of items) {
    if (item.type && item.type !== 'app') continue;
    const name = item.name || '';
    if (isAccessoryFor(title, name)) continue;
    const value = score(title, name);
    if (value < ACCEPT_SCORE) continue;
    if (!best || value > best.value || (value === best.value && name.length < best.item.name.length)) {
      best = { value, item };
    }
  }
  return best;
}

async function detailsFor(title, appId, countryCode, searchItem) {
  const details = await fetchJson(`${DETAILS_URL}?appids=${appId}&cc=${countryCode}&l=en`);
  const entry = details?.[String(appId)];
  if (!entry?.success || !entry.data) {
    return { title, matched: false, reason: 'details-unavailable' };
  }

  const data = entry.data;
  const { screenshots, videos } = toMedia(data);
  return {
    title,
    matched: true,
    appId,
    storeName: data.name,
    heroImage: data.header_image || searchItem?.tiny_image || null,
    background: data.background_raw || null,
    screenshots,
    videos,
    price: toPrice(data.price_overview, data.is_free),
    releaseDate: data.release_date?.date || null,
    metacritic: data.metacritic?.score ?? null,
    ageRating: toAgeRating(data),
    storeUrl: `https://store.steampowered.com/app/${appId}/`,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Resolve one title, collapsing concurrent duplicate lookups and serving a
 * stale entry rather than nothing when the storefront is unreachable.
 */
export async function resolveGame(title, countryCode = 'US', knownAppId = null) {
  const key = `${countryCode}:${normalize(title)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) return hit.value;
  if (inFlight.has(key)) return inFlight.get(key);

  const pending = resolveUncached(title, countryCode, knownAppId)
    .then((value) => {
      cache.set(key, { value, storedAt: Date.now() });
      return value;
    })
    .catch((error) => {
      if (hit) return hit.value;
      return { title, matched: false, reason: String(error.message || error) };
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, pending);
  return pending;
}

/**
 * Resolve a list with bounded concurrency so we stay polite to the upstream.
 * Entries may be plain titles or catalog games carrying a `steamAppId`.
 */
export async function resolveMany(entries, countryCode = 'US', concurrency = 4) {
  const results = new Array(entries.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      const entry = entries[index];
      const title = typeof entry === 'string' ? entry : entry.title;
      if (typeof entry === 'object' && entry.steamAppId == null) {
        // A catalog entry with no store id has no listing to fetch — a console
        // exclusive, or a game sold elsewhere. Never fall back to searching:
        // the ids are resolved offline where a bad match can be caught.
        results[index] = { title, matched: false, reason: 'no-store-listing' };
        continue;
      }
      const appId = typeof entry === 'string' ? null : entry.steamAppId;
      results[index] = await resolveGame(title, countryCode, appId);
    }
  });
  await Promise.all(workers);
  return results;
}

const COUNTRY_PATTERN = /^[A-Za-z]{2}$/;

/**
 * Serve a chunk of the catalog (`?chunk=2`) or an explicit title (`?title=`).
 * Chunk requests produce identical URLs for every visitor, so the CDN can
 * cache them and the storefront only sees traffic once per cache window.
 */
export async function handleGamesRequest(url, catalog) {
  const countryParam = url.searchParams.get('cc') || 'US';
  const countryCode = COUNTRY_PATTERN.test(countryParam) ? countryParam.toUpperCase() : 'US';

  const titleParam = url.searchParams.get('title');
  if (titleParam) {
    const wanted = titleParam.slice(0, 120);
    const known = catalog.find((game) => game.title === wanted);
    const game = await resolveGame(wanted, countryCode, known?.steamAppId ?? null);
    return {
      status: 200,
      body: { countryCode, games: [{ ...game, prediction: predictPriceDrop(game) }] },
    };
  }

  const chunkParam = Number.parseInt(url.searchParams.get('chunk') ?? '', 10);
  const chunkCount = Math.ceil(catalog.length / CHUNK_SIZE);
  if (!Number.isInteger(chunkParam) || chunkParam < 0 || chunkParam >= chunkCount) {
    return {
      status: 400,
      body: { error: `chunk must be an integer from 0 to ${chunkCount - 1}, or pass title=` },
    };
  }

  const slice = catalog.slice(chunkParam * CHUNK_SIZE, (chunkParam + 1) * CHUNK_SIZE);
  const resolved = await resolveMany(slice, countryCode);
  const games = resolved.map((game, index) => ({ ...game, id: slice[index].id }));

  // Recording on read means history starts accruing from the first visit
  // rather than waiting for the first nightly snapshot.
  let histories = {};
  try {
    histories = await recordAndSummarize(chunkParam, countryCode, games);
  } catch {
    // History is an enhancement; never fail the response over it.
  }

  // Ratings ship baked into the catalog so a card is never blank. The nightly
  // job refreshes them into blob storage; anything it has wins.
  let ratings = {};
  try {
    ratings = await loadBlob(`${REVIEW_KEY_PREFIX}${chunkParam}`);
  } catch {
    ratings = {};
  }

  return {
    status: 200,
    body: {
      countryCode,
      chunk: chunkParam,
      chunkCount,
      games: games.map((game) => {
        const history = histories[game.id] ?? null;
        return {
          ...game,
          history,
          ratings: ratings[game.id] ?? null,
          prediction: predictPriceDrop(game, history),
        };
      }),
    },
  };
}

/** Sale data goes stale, artwork does not; half an hour splits the difference. */
export const CACHE_HEADER = 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400';
