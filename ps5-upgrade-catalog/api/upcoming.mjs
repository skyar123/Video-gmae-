/**
 * Upcoming PlayStation releases.
 *
 * The seed list is a set of PS Store concept IDs found by walking the store's
 * ID space; everything shown to the reader is re-read from the store on
 * refresh, so a delayed game moves its own date and a released one drops off
 * the calendar without anyone editing a file.
 */

import { readFile } from 'node:fs/promises';
import { loadBlob, saveBlob } from './history.mjs';

const UA = 'Mozilla/5.0 (compatible; ps5-upgrade-catalog/1.0)';
const READ_CAP = 190_000; // Release date, art, price and genres all land inside this.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const BLOB_KEY = 'upcoming/us.json';

let memory = null;
let inFlight = null;

const seedsUrl = new URL('./upcoming-seeds.json', import.meta.url);

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
  const timer = setTimeout(() => controller.abort(), 12_000);
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

async function build() {
  const seeds = JSON.parse(await readFile(seedsUrl, 'utf8'));
  const pages = await mapWithConcurrency(seeds, 8, async (seed) => {
    const html = await fetchConcept(seed.id);
    return html ? parseConcept(seed.id, html) : null;
  });

  const now = Date.now();
  const games = pages
    .filter(Boolean)
    .filter((game) => new Date(game.releaseDate).getTime() > now)
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));

  return { games, fetchedAt: new Date().toISOString() };
}

/** Cached six hours; a stale copy is served rather than an empty calendar. */
export async function loadUpcoming() {
  if (memory && Date.now() - memory.storedAt < CACHE_TTL_MS) return memory.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const stored = await loadBlob(BLOB_KEY);
    if (stored?.fetchedAt && Date.now() - new Date(stored.fetchedAt).getTime() < CACHE_TTL_MS) {
      memory = { value: stored, storedAt: Date.now() };
      return stored;
    }
    try {
      const value = await build();
      if (value.games.length > 0) {
        memory = { value, storedAt: Date.now() };
        await saveBlob(BLOB_KEY, value);
        return value;
      }
    } catch {
      // Fall through to whatever we last managed to store.
    }
    const fallback = stored ?? { games: [], fetchedAt: null };
    memory = { value: fallback, storedAt: Date.now() };
    return fallback;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}
