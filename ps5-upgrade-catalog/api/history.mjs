/**
 * Recorded price history.
 *
 * Nobody publishes a price history feed we can use, so the app keeps its own:
 * every time a chunk of the catalog is resolved, the day's price is appended
 * if it differs from the last recorded one. Storing only changes keeps a
 * year of history per game down to a few hundred bytes.
 *
 * History is stored per chunk and per region, matching how the catalog is
 * requested — a request reads and writes exactly one blob, and two instances
 * racing on the same chunk on the same day write the same value anyway.
 *
 * On Netlify this is Netlify Blobs. Elsewhere (local dev) it falls back to a
 * gitignored JSON file, so the feature is developable without the platform.
 */

import { formatMoney } from './steam.mjs';

const STORE_NAME = 'price-history';
const LOCAL_FILE = new URL('../.price-history.local.json', import.meta.url);
/** Keep history bounded: a change a week for four years is still under this. */
const MAX_POINTS = 250;

let storePromise;

/** Netlify Blobs when the platform provides it, otherwise null. */
async function getBlobStore() {
  if (storePromise === undefined) {
    storePromise = (async () => {
      try {
        const { getStore } = await import('@netlify/blobs');
        return getStore({ name: STORE_NAME, consistency: 'strong' });
      } catch {
        return null;
      }
    })();
  }
  return storePromise;
}

async function readLocalFile() {
  try {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(LOCAL_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeLocalFile(all) {
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(LOCAL_FILE, JSON.stringify(all), 'utf8');
  } catch {
    // A read-only or missing filesystem just means no local history.
  }
}

const keyFor = (chunk, countryCode) => `${countryCode}/chunk-${chunk}`;

export async function loadChunk(chunk, countryCode) {
  const store = await getBlobStore();
  if (store) {
    try {
      return (await store.get(keyFor(chunk, countryCode), { type: 'json' })) ?? {};
    } catch {
      return {};
    }
  }
  const all = await readLocalFile();
  return all[keyFor(chunk, countryCode)] ?? {};
}

async function saveChunk(chunk, countryCode, data) {
  const store = await getBlobStore();
  if (store) {
    try {
      await store.setJSON(keyFor(chunk, countryCode), data);
    } catch {
      // Losing one day's point is not worth failing a request over.
    }
    return;
  }
  const all = await readLocalFile();
  all[keyFor(chunk, countryCode)] = data;
  await writeLocalFile(all);
}

const today = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Append today's price for each game when it differs from the last recorded
 * point, then hand back a summary per game id. Points are `{d, f, i, p}`:
 * date, final cents, initial cents, discount percent.
 */
export async function recordAndSummarize(chunk, countryCode, games, now = new Date()) {
  const history = await loadChunk(chunk, countryCode);
  const stamp = today(now);
  let changed = false;

  for (const game of games) {
    if (!game.id || !game.matched || !game.price || game.price.isFree) continue;
    const { final, initial, discountPercent, currency } = game.price;
    if (typeof final !== 'number') continue;

    const entry = history[game.id] ?? (history[game.id] = { currency, points: [] });
    entry.currency = currency ?? entry.currency;
    const last = entry.points[entry.points.length - 1];

    if (!last || last.f !== final || last.p !== (discountPercent || 0)) {
      entry.points.push({ d: stamp, f: final, i: initial ?? final, p: discountPercent || 0 });
      if (entry.points.length > MAX_POINTS) entry.points.splice(0, entry.points.length - MAX_POINTS);
      changed = true;
    } else if (last.d !== stamp) {
      // Same price as last time: move the marker so "observed since" stays true
      // without storing a point for every unchanged day.
      last.seen = stamp;
      changed = true;
    }
  }

  if (changed) await saveChunk(chunk, countryCode, history);

  const summaries = {};
  for (const game of games) {
    if (game.id && history[game.id]) summaries[game.id] = summarize(history[game.id], now);
  }
  return summaries;
}

const daysBetween = (a, b) => Math.round((a - b) / 86400000);

/** Turn a stored series into the shape the predictor and the UI want. */
export function summarize(entry, now = new Date()) {
  const points = entry?.points ?? [];
  if (points.length === 0) return null;

  const currency = entry.currency || 'USD';
  const first = points[0];
  const last = points[points.length - 1];
  const lastSeen = last.seen || last.d;

  let lowest = points[0];
  for (const point of points) if (point.f < lowest.f) lowest = point;

  const salePoints = points.filter((point) => point.p > 0);
  const gaps = [];
  for (let i = 1; i < salePoints.length; i += 1) {
    gaps.push(daysBetween(new Date(salePoints[i].d), new Date(salePoints[i - 1].d)));
  }
  const positiveGaps = gaps.filter((gap) => gap > 0);

  return {
    observedDays: daysBetween(new Date(lastSeen), new Date(first.d)),
    since: first.d,
    saleCount: salePoints.length,
    lowest: {
      final: lowest.f,
      formatted: formatMoney(lowest.f, currency),
      date: lowest.d,
      discountPercent: lowest.p,
    },
    daysSinceLastSale: salePoints.length
      ? daysBetween(now, new Date(salePoints[salePoints.length - 1].d))
      : null,
    meanDaysBetweenSales: positiveGaps.length
      ? Math.round(positiveGaps.reduce((sum, gap) => sum + gap, 0) / positiveGaps.length)
      : null,
    // A trimmed series for sparklines, oldest first.
    points: points.slice(-24).map((point) => ({ date: point.d, final: point.f, discount: point.p })),
  };
}
