/**
 * Upcoming PlayStation releases.
 *
 * The seed list is a set of PS Store concept IDs found by walking the store's
 * ID space; everything shown to the reader is re-read from the store on
 * refresh, so a delayed game moves its own date and a released one drops off
 * the calendar without anyone editing a file.
 */

import bakedSeeds from './upcoming-seeds.json' with { type: 'json' };
import snapshot from './upcoming-snapshot.json' with { type: 'json' };
import { loadBlob, saveBlob } from './history.mjs';

const UA = 'Mozilla/5.0 (compatible; ps5-upgrade-catalog/1.0)';
const READ_CAP = 190_000; // Release date, art, price and genres all land inside this.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const BLOB_KEY = 'upcoming/us.json';
const SEEDS_KEY = 'upcoming/seeds.json';
const CURSOR_KEY = 'upcoming/cursor.json';

// The store keeps announcing things, so the ID space is swept a slice at a
// time by the nightly job rather than frozen at whatever the last deploy knew.
const SCAN_FROM = 10_006_000;
const SCAN_TO = 10_030_000;
const SCAN_WINDOW = 1_500;

// A game stays in "just released" for this long after its date, which is how
// something new reaches the app without the catalog itself being rebuilt.
const RECENT_DAYS = 60;

// Every seed costs a store fetch on the nightly rebuild, so the discovered
// list is bounded; the baked seeds are always kept on top of this.
const MAX_DISCOVERED_SEEDS = 120;

let memory = null;
let inFlight = null;

const decodeEntities = (value) =>
  value
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();

/** Reads the head of a concept page — enough for the Apollo payload we need. */
async function fetchConcept(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`https://store.playstation.com/en-us/concept/${id}`, {
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'text/html' },
    });
    if (!response.ok) return null;

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let text = '';
    while (text.length < READ_CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes('"localizedGenres"')) break;
    }
    reader.cancel().catch(() => {});
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const artFor = (html, role) => {
  const match = html.match(
    new RegExp(`"role":"${role}"[^}]*?"url":"([^"]+)"|"url":"([^"]+)"[^}]*?"role":"${role}"`),
  );
  return match ? match[1] ?? match[2] : null;
};

/** Add-ons and pre-order packs share the concept space; a calendar wants games. */
const NOT_A_GAME = /\b(pre-?order|bundle|pack|season pass|dlc|expansion|upgrade|currency|coins?|credits?|avatar|theme|soundtrack)\b/i;

/** "Standard Edition" and friends are the same release under a longer name. */
/** Store listings often tack the platforms onto the end of the name. */
const PLATFORM_SUFFIX = /\s*(PS4|PS5|PlayStation\s*[45])\s*(®|™)?\s*(&|and|\+|\/)\s*(PS4|PS5|PlayStation\s*[45])\s*(®|™)?\s*$/i;

const EDITION_SUFFIX =
  /\s*[:\u2013-]?\s*(standard|digital|deluxe|ultimate|gold|premium|special|launch|day one)\s+edition\b(\s*(PS4|PS5|&|and|\/|\s)+)*$/i;

/** A concept sells a game if any of its SKUs is a game rather than an add-on. */
const GAME_SKUS = new Set(['FULL_GAME', 'PREMIUM_EDITION', 'GAME_BUNDLE', 'CROSS_BUY']);

function parseConcept(id, html) {
  const name = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  const release = (html.match(/"releaseDate":"([^"]+)"/) || [])[1];
  if (!name || !release) return null;

  const skus = [...html.matchAll(/"storeDisplayClassification":"([^"]+)"/g)].map((m) => m[1]);
  const category = (html.match(/"topCategory":"([^"]+)"/) || [])[1];
  if (skus.length > 0 && !skus.some((sku) => GAME_SKUS.has(sku))) return null;
  if (category && category !== 'GAME') return null;
  if (NOT_A_GAME.test(name)) return null;

  const platforms = (html.match(/"platforms":\[([^\]]*)\]/) || [])[1];
  const genres = [...html.matchAll(/"LocalizedGenre","value":"([^"]+)"/g)].map((m) => m[1]);
  const basePrice = (html.match(/"basePrice":"([^"]+)"/) || [])[1];
  const discounted = (html.match(/"discountedPrice":"([^"]+)"/) || [])[1];

  return {
    id,
    title: decodeEntities(name.replace(/\s*[|·-]\s*(PS[45]|PlayStation).*$/i, ''))
      .replace(PLATFORM_SUFFIX, '')
      .replace(EDITION_SUFFIX, '')
      .trim(),
    releaseDate: release,
    publisher: (html.match(/"publisherName":"([^"]*)"/) || [])[1] ?? null,
    platforms: platforms ? platforms.replace(/"/g, '').split(',').filter(Boolean) : [],
    genres: [...new Set(genres)].slice(0, 3),
    price: discounted && discounted !== basePrice ? discounted : basePrice ?? null,
    basePrice: basePrice ?? null,
    art:
      artFor(html, 'GAMEHUB_COVER_ART') ||
      artFor(html, 'SIXTEEN_BY_NINE_BANNER') ||
      artFor(html, 'MASTER') ||
      null,
    portrait: artFor(html, 'PORTRAIT_BANNER') || artFor(html, 'FOUR_BY_THREE_BANNER') || null,
    storeUrl: `https://store.playstation.com/en-us/concept/${id}`,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

/** Baked seeds plus whatever the nightly sweep has since turned up. */
async function currentSeeds() {
  const discovered = (await loadBlob(SEEDS_KEY))?.seeds ?? [];
  const byId = new Map();
  for (const seed of [...bakedSeeds, ...discovered]) byId.set(seed.id, seed);
  return [...byId.values()];
}

/** Exported so the snapshot shipped with a deploy can be baked from it. */
export async function build() {
  const seeds = await currentSeeds();
  const pages = await mapWithConcurrency(seeds, 16, async (seed) => {
    const html = await fetchConcept(seed.id);
    return html ? parseConcept(seed.id, html) : null;
  });

  const now = Date.now();
  const dated = pages.filter(Boolean);
  const games = dated
    .filter((game) => new Date(game.releaseDate).getTime() > now)
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));

  // Yesterday's calendar is today's new releases, so seeds are followed past
  // their date rather than dropped the moment a game comes out.
  const recent = dated
    .filter((game) => {
      const age = now - new Date(game.releaseDate).getTime();
      return age > 0 && age < RECENT_DAYS * 86_400_000;
    })
    .sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));

  return { games, recent, fetchedAt: new Date().toISOString() };
}

/** Dates drift while a stored copy sits, so the split is redone on read. */
function reslice(value) {
  const now = Date.now();
  const all = [...(value.games ?? []), ...(value.recent ?? [])];
  return {
    games: all
      .filter((game) => new Date(game.releaseDate).getTime() > now)
      .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate)),
    recent: all
      .filter((game) => {
        const age = now - new Date(game.releaseDate).getTime();
        return age > 0 && age < RECENT_DAYS * 86_400_000;
      })
      .sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate)),
    fetchedAt: value.fetchedAt ?? null,
  };
}

/**
 * Reads only. Rebuilding means a store fetch per game, which is the nightly
 * job's work, not a visitor's — so a request serves the last build, or the
 * snapshot baked at deploy time until the first nightly run replaces it.
 */
export async function loadUpcoming() {
  if (memory && Date.now() - memory.storedAt < CACHE_TTL_MS) return memory.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    // A missing blob reads back as {}, so presence is judged on the data.
    const stored = await loadBlob(BLOB_KEY);
    const source = Array.isArray(stored?.games) && stored.games.length > 0 ? stored : snapshot;
    const value = reslice(source);
    memory = { value, storedAt: Date.now() };
    return value;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * One night's slice of the sweep. Concept IDs are dense enough to walk, and a
 * window at a time keeps the job inside a scheduled function's budget while
 * still covering the whole range over a handful of nights.
 */
export async function sweepForReleases() {
  const cursorState = await loadBlob(CURSOR_KEY);
  const from = cursorState?.next && cursorState.next < SCAN_TO ? cursorState.next : SCAN_FROM;
  const to = Math.min(from + SCAN_WINDOW, SCAN_TO);

  const ids = Array.from({ length: to - from }, (_, index) => from + index);
  const found = await mapWithConcurrency(ids, 10, async (id) => {
    const html = await fetchConcept(id);
    return html ? parseConcept(id, html) : null;
  });

  const now = Date.now();
  const fresh = found
    .filter(Boolean)
    .filter(
      (game) =>
        new Date(game.releaseDate).getTime() > now - RECENT_DAYS * 86_400_000,
    )
    .map((game) => ({ id: game.id, title: game.title }));

  // Seeds whose release has passed are dropped so the refresh stays cheap.
  const kept = new Map();
  for (const seed of (await loadBlob(SEEDS_KEY))?.seeds ?? []) kept.set(seed.id, seed);
  for (const seed of fresh) kept.set(seed.id, seed);

  // Only seeds whose release is well behind us are dropped; the rest keep
  // feeding the "just released" list.
  const calendar = await loadBlob(BLOB_KEY);
  const stale = new Set(
    [...(calendar?.games ?? []), ...(calendar?.recent ?? [])]
      .filter(
        (game) => now - new Date(game.releaseDate).getTime() > RECENT_DAYS * 86_400_000,
      )
      .map((game) => game.id),
  );
  for (const id of stale) kept.delete(id);

  await saveBlob(SEEDS_KEY, {
    seeds: [...kept.values()].slice(-MAX_DISCOVERED_SEEDS),
    sweptAt: new Date().toISOString(),
  });
  await saveBlob(CURSOR_KEY, { next: to >= SCAN_TO ? SCAN_FROM : to });

  // Rebuild now, against the new seed list, so no reader ever pays for it.
  // The stored copy is only replaced once the new one comes back non-empty.
  const rebuilt = await build();
  if (rebuilt.games.length > 0 || rebuilt.recent.length > 0) {
    await saveBlob(BLOB_KEY, rebuilt);
  }
  memory = null;

  return {
    scanned: ids.length,
    from,
    to,
    discovered: fresh.length,
    seeds: kept.size,
    calendar: rebuilt.games.length,
    recent: rebuilt.recent.length,
  };
}
