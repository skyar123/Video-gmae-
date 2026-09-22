#!/usr/bin/env node
/**
 * Walks the PlayStation Store's concept ID space and merges what it finds into
 * api/store-index.json.
 *
 * This is a crawler, not a reasoning job: it fetches pages and reads fields out
 * of the Apollo payload the store server-renders. Day to day it does not need
 * running at all — the nightly Netlify job sweeps a slice and tops the index up
 * through Blobs. Run this when you want a full pass in one go, or to re-bake
 * the file that ships with a deploy.
 *
 *   node scripts/index-store.mjs                 # the usual range
 *   node scripts/index-store.mjs 10000000 10030000
 *
 * It resumes: IDs already in the index are skipped unless --refresh is passed.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const INDEX = new URL('../api/store-index.json', import.meta.url);
const CAP = 190_000;
const CONCURRENCY = 12;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const NOT_A_GAME =
  /\b(pre-?order|season pass|dlc pack|expansion pass|currency|coins?|credits?|avatar|dynamic theme|soundtrack|bundle pack)\b/i;
const PLATFORM_SUFFIX =
  /\s*(PS4|PS5|PlayStation\s*[45])\s*(®|™)?\s*(&|and|\+|\/)\s*(PS4|PS5|PlayStation\s*[45])\s*(®|™)?\s*$/i;

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const refresh = process.argv.includes('--refresh');
const from = Number(args[0] ?? 10_000_000);
const to = Number(args[1] ?? 10_030_000);

const existing = new Map(JSON.parse(readFileSync(INDEX, 'utf8')).map((row) => [row.id, row]));
const ids = [];
for (let id = to; id >= from; id -= 1) {
  if (refresh || !existing.has(id)) ids.push(id);
}
console.log(`${ids.length} ids to check (${existing.size} already indexed)`);

const decoder = new TextDecoder();

async function page(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://store.playstation.com/en-us/concept/${id}`, {
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: 'text/html' },
    });
    if (!response.ok) return null;
    const reader = response.body.getReader();
    let text = '';
    while (text.length < CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      // Genres are the last field we want; everything else precedes them.
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
  return match ? (match[1] ?? match[2]) : null;
};

function parse(id, html) {
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  if (!title) return null;

  const category = (html.match(/"topCategory":"([^"]+)"/) || [])[1];
  if (category && category !== 'GAME') return null;

  const name = title
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(PLATFORM_SUFFIX, '')
    .trim();
  if (NOT_A_GAME.test(name)) return null;

  const release = (html.match(/"releaseDate":"([^"]+)"/) || [])[1] ?? null;
  const price = (html.match(/"basePrice":"([^"]+)"/) || [])[1] ?? null;
  const stars = html.match(/"averageRating":([\d.]+),"totalRatingsCount":(\d+)/);
  // No date, no price and no rating means an unlisted placeholder page.
  if (!release && !price && !stars) return null;

  const platforms = (html.match(/"platforms":\[([^\]]*)\]/) || [])[1];
  return {
    id,
    name,
    release,
    platforms: platforms ? platforms.replace(/"/g, '').split(',').filter(Boolean) : [],
    genres: [
      ...new Set([...html.matchAll(/"LocalizedGenre","value":"([^"]+)"/g)].map((m) => m[1])),
    ].slice(0, 4),
    publisher: (html.match(/"publisherName":"([^"]*)"/) || [])[1] ?? null,
    price,
    stars: stars ? Number(stars[1]) : null,
    votes: stars ? Number(stars[2]) : null,
    art:
      artFor(html, 'GAMEHUB_COVER_ART') ||
      artFor(html, 'SIXTEEN_BY_NINE_BANNER') ||
      artFor(html, 'MASTER'),
  };
}

const save = () => {
  const rows = [...existing.values()].sort((a, b) => b.id - a.id);
  writeFileSync(INDEX, `${JSON.stringify(rows)}\n`);
  return rows.length;
};

let cursor = 0;
let checked = 0;
let added = 0;
const started = Date.now();

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      const html = await page(id);
      checked += 1;
      if (html) {
        const row = parse(id, html);
        if (row) {
          existing.set(id, row);
          added += 1;
        }
      }
      if (checked % 500 === 0) {
        const rate = checked / ((Date.now() - started) / 1000);
        console.log(
          `${checked}/${ids.length} checked, ${added} added, ` +
            `~${Math.round((ids.length - checked) / rate / 60)}m left`,
        );
        save();
      }
    }
  }),
);

console.log(`Done: ${checked} checked, ${added} added, ${save()} games in the index`);
