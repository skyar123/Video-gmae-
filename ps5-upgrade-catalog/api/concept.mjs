/**
 * Full detail for one PlayStation Store concept.
 *
 * The store mirror's index carries only what a card needs — name, art, genres,
 * publisher, a star rating. Opening a game needs more than that, and the same
 * concept page the price client reads also server-renders the description, the
 * screenshots and, for anything unreleased, the official trailer. So a game
 * from the mirror can be shown the way a curated one is: art, words, a live
 * price, and the drop predictor's reasoning — rather than a link to Sony.
 *
 * Read on demand, one game at a time, cached for an hour.
 */

import { loadPsnPrice, localeFor } from './psn.mjs';
import { predictPriceDrop } from './predict.mjs';

const STORE_ORIGIN = 'https://store.playstation.com';
const CACHE_TTL_MS = 60 * 60 * 1000;
/** Description, screenshots, rating and date all land well inside this. */
const READ_CAP = 140_000;

const cache = new Map();
const inFlight = new Map();

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Reads the head of the page — the rest is reviews and recommendations. */
async function fetchConcept(id, countryCode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `${STORE_ORIGIN}/${localeFor(countryCode)}/concept/${id}`,
      { signal: controller.signal, headers: { 'user-agent': UA, accept: 'text/html' } },
    );
    if (!response.ok) return null;

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let text = '';
    while (text.length < READ_CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pulls one JSON string value out of the raw payload. Going back through
 * JSON.parse is what makes the escapes (\", \n, \uXXXX) come out right.
 */
function jsonStringAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('"', at + marker.length);
  if (start < 0) return null;

  for (let index = start + 1; index < html.length; index += 1) {
    if (html[index] === '\\') {
      index += 1;
      continue;
    }
    if (html[index] === '"') {
      try {
        return JSON.parse(html.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&#x27;': "'", '&nbsp;': ' ', '&#x2F;': '/',
};

/** Store copy is HTML with <br/> for paragraphs; keep the breaks, drop the rest. */
function toPlainText(value) {
  if (!value) return null;
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&[#a-z0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const mediaByRole = (html, role) => [
  ...new Set(
    [
      ...html.matchAll(
        new RegExp(`"role":"${role}"[^}]*?"url":"([^"]+)"|"url":"([^"]+)"[^}]*?"role":"${role}"`, 'g'),
      ),
    ].map((match) => match[1] ?? match[2]),
  ),
];

function parse(id, html) {
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1]?.trim();
  if (!title) return null;

  const stars = html.match(/"averageRating":([\d.]+),"totalRatingsCount":(\d+)/);
  const short = toPlainText(jsonStringAfter(html, '"type":"SHORT","value":'));
  const long = toPlainText(jsonStringAfter(html, '"type":"LONG","value":'));

  return {
    id,
    title,
    // The long copy is the real description; the short one is a tagline.
    tagline: short && short !== long ? short : null,
    description: long ?? short ?? null,
    releaseDate: (html.match(/"releaseDate":"([^"]+)"/) || [])[1] ?? null,
    publisher: (html.match(/"publisherName":"([^"]*)"/) || [])[1] ?? null,
    stars: stars ? Number(stars[1]) : null,
    votes: stars ? Number(stars[2]) : null,
    screenshots: mediaByRole(html, 'SCREENSHOT').slice(0, 8),
    trailer: (html.match(/"role":"PREVIEW","type":"VIDEO","url":"([^"]+)"/) || [])[1] ?? null,
    art:
      mediaByRole(html, 'GAMEHUB_COVER_ART')[0] ??
      mediaByRole(html, 'SIXTEEN_BY_NINE_BANNER')[0] ??
      mediaByRole(html, 'MASTER')[0] ??
      null,
    storeUrl: `${STORE_ORIGIN}/en-us/concept/${id}`,
  };
}

/**
 * Detail plus a live price and the same drop prediction the catalog gets.
 * There is no recorded price history for mirror games, so the predictor works
 * from release age and the current sale alone and says so in its confidence.
 */
export async function loadConceptDetail(id, countryCode = 'US') {
  const key = `${countryCode}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) return hit.value;
  if (inFlight.has(key)) return inFlight.get(key);

  const pending = (async () => {
    const [html, price] = await Promise.all([
      fetchConcept(id, countryCode),
      loadPsnPrice(`concept/${id}`, countryCode),
    ]);

    const detail = html ? parse(id, html) : null;
    if (!detail) {
      // A page we could not read is still worth a price, if the price client
      // managed one — better a partial card than an error.
      const partial = price ? { id, price, prediction: null, partial: true } : null;
      cache.set(key, { value: partial, storedAt: Date.now() });
      return partial;
    }

    const prediction = price
      ? predictPriceDrop({ matched: true, price, releaseDate: detail.releaseDate })
      : null;

    const value = { ...detail, price: price ?? null, prediction };
    cache.set(key, { value, storedAt: Date.now() });
    return value;
  })()
    .catch(() => hit?.value ?? null)
    .finally(() => inFlight.delete(key));

  inFlight.set(key, pending);
  return pending;
}
