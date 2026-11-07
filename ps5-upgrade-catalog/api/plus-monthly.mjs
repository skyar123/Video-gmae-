/**
 * What PlayStation Plus is giving away right now, and what just joined the
 * catalog.
 *
 * The per-concept scan answers "is this game included", which covers the
 * catalog but says nothing about the monthly games: the titles an Essential
 * subscription claims and keeps each month. Those are not marked on a game's
 * store page at all. The only place they are named is the blog post
 * announcing them.
 *
 * That post is read from its title alone, which carries the whole list, and
 * the titles are more varied than they look:
 *
 *   PlayStation Plus Monthly Games for October: F1 25, Hunt: Showdown 1896, ...
 *   PlayStation Plus Monthly Games for September - Sniper Elite: Resistance, ...
 *   PlayStation Plus Game Catalog for October: Mafia: The Old Country, ... and more
 *   (For Southeast Asia) PlayStation Plus Monthly Games for January 2025: ...
 *
 * So: three different separators, an optional year, a trailing "and more",
 * game names that contain colons of their own, and regional editions that
 * announce a different line-up to a different part of the world. The last of
 * those is why the prefix is a rejection rather than something to strip: a
 * Southeast Asia post is not wrong, it is simply not this reader's.
 *
 * Nothing it cannot parse is guessed at. A title that does not match is left
 * alone and the app shows nothing, which is the right failure for a panel
 * whose whole job is to say "this one is free".
 */

import { loadBlob, saveBlob } from './history.mjs';

const FEEDS = [
  'https://blog.playstation.com/?s=PlayStation+Plus+Monthly+Games&feed=rss2',
  'https://blog.playstation.com/tag/ps-plus/feed/',
  'https://blog.playstation.com/tag/playstation-plus/feed/',
];

const BLOB_KEY = 'store/ps-plus-announcements.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Past this an announcement is last month's, and saying "now" would be a lie. */
const STALE_MS = 70 * 24 * 60 * 60 * 1000;

const UA = 'Mozilla/5.0 (compatible; ps5-upgrade-catalog/1.0)';

const decode = (text) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/&#8217;|&#039;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…')
    .trim();

/**
 * A line-up out of one post title, or null if this is not one of those posts.
 *
 * Exported because the title formats are the whole difficulty here, and they
 * are worth holding still in a test rather than discovering again later.
 */
export function parseAnnouncement(rawTitle) {
  const title = decode(String(rawTitle ?? ''));

  // A regional edition announces a different line-up to a different part of
  // the world, so it is rejected rather than stripped.
  if (/^\(\s*for\s/i.test(title)) return null;

  const head = title.match(
    /^PlayStation Plus (Monthly Games|Game Catalog) for ([A-Za-z]+)(?:\s+(\d{4}))?\s*[:–—-]\s*(.+)$/i,
  );
  if (!head) return null;

  const [, kindText, month, year, listText] = head;
  const kind = /monthly/i.test(kindText) ? 'monthly' : 'catalog';

  const games = listText
    // "and more" is an admission the title is not the full list, not a game.
    .replace(/,?\s*and\s+more\.?\s*$/i, '')
    .split(/,\s*/)
    .map((name) => name.trim().replace(/\s+/g, ' '))
    .filter((name) => name.length > 1);

  if (games.length === 0) return null;
  return { kind, month, year: year ?? null, games, title };
}

async function fetchFeed(url) {
  try {
    const response = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return [];
    const xml = await response.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
      const block = match[1];
      return {
        title: (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? '',
        link: decode((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] ?? ''),
        publishedAt: (block.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] ?? null,
      };
    });
  } catch {
    return [];
  }
}

/** The newest announcement of each kind, as far as the feeds reach. */
export function newestOfEachKind(items, now = Date.now()) {
  const best = {};
  for (const item of items) {
    const parsed = parseAnnouncement(item.title);
    if (!parsed) continue;
    const at = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    if (!Number.isFinite(at)) continue;
    // Something older than a couple of months is a leftover the feeds still
    // carry, and presenting it as current would be worse than silence.
    if (now - at > STALE_MS) continue;
    if (!best[parsed.kind] || at > best[parsed.kind].at) {
      best[parsed.kind] = { ...parsed, at, link: item.link, publishedAt: item.publishedAt };
    }
  }
  return best;
}

let cache = null;

export async function loadPlusAnnouncements({ now = Date.now() } = {}) {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  const stored = await loadBlob(BLOB_KEY);
  if (stored?.at && now - Date.parse(stored.at) < CACHE_TTL_MS && stored.value) {
    cache = { value: stored.value, at: now };
    return stored.value;
  }

  const items = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  const value = newestOfEachKind(items, now);

  // A read that found nothing keeps whatever was stored: the feeds are the
  // only source, and an empty answer from them is far more likely to be a bad
  // morning than the end of PlayStation Plus.
  if (Object.keys(value).length === 0 && stored?.value) {
    cache = { value: stored.value, at: now };
    return stored.value;
  }

  cache = { value, at: now };
  await saveBlob(BLOB_KEY, { value, at: new Date(now).toISOString() });
  return value;
}
