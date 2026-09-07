/**
 * Gaming news, merged from publisher RSS feeds.
 *
 * Feeds need no key and no scraping: publishers offer them precisely so this
 * can be done. Each item keeps its source so the reader always knows who wrote
 * it, and links go to the publisher rather than being republished here.
 */

const FEEDS = [
  { source: 'Kotaku', url: 'https://kotaku.com/rss', tone: 'general' },
  { source: 'IGN', url: 'https://feeds.ign.com/ign/games-all', tone: 'general' },
  { source: 'Eurogamer', url: 'https://www.eurogamer.net/feed', tone: 'general' },
  { source: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed', tone: 'general' },
  { source: 'The Gamer', url: 'https://www.thegamer.com/feed/', tone: 'general' },
  { source: 'GamesRadar', url: 'https://www.gamesradar.com/feeds/articletype/news/', tone: 'general' },
  { source: 'VGC', url: 'https://www.videogameschronicle.com/feed/', tone: 'general' },
  { source: 'Push Square', url: 'https://www.pushsquare.com/feeds/latest', tone: 'playstation' },
  { source: 'PlayStation Blog', url: 'https://blog.playstation.com/feed/', tone: 'playstation' },
  { source: 'Gayming Magazine', url: 'https://gaymingmag.com/feed/', tone: 'queer' },
  {
    source: 'Autostraddle',
    url: 'https://www.autostraddle.com/tag/video-games/feed/',
    tone: 'queer',
  },
];

const CACHE_TTL_MS = 15 * 60 * 1000;
let cache = null;

const decodeEntities = (value) =>
  value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

const stripTags = (value) => decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');

/** WordPress feeds append their own footer to every excerpt. */
const cleanSummary = (value) =>
  stripTags(value)
    .replace(/\s*The post .*? appeared first on .*$/i, '')
    .replace(/\s*The post .*$/i, '')
    .replace(/\s*(Continue reading|Read more).*$/i, '')
    .trim();

const tag = (block, name) => {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decodeEntities(match[1]) : null;
};

/** Handles both RSS <item> and Atom <entry>, which is all these feeds use. */
function parseFeed(xml, feed) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.slice(0, 12).map((block) => {
    const link =
      tag(block, 'link') ||
      (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1] ||
      tag(block, 'guid');
    const published = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    const summaryRaw = tag(block, 'description') || tag(block, 'summary') || '';
    const image =
      (block.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i) || [])[1] ||
      (block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i) || [])[1] ||
      (summaryRaw.match(/<img[^>]*src="([^"]+)"/i) || [])[1] ||
      null;

    return {
      source: feed.source,
      tone: feed.tone,
      title: stripTags(tag(block, 'title') ?? ''),
      link: link?.trim() ?? null,
      publishedAt: published ? new Date(published).toISOString() : null,
      summary: cleanSummary(summaryRaw).slice(0, 220),
      image,
    };
  });
}

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ps5-upgrade-catalog/1.0)', accept: 'application/rss+xml, application/xml, text/xml' },
    });
    if (!res.ok) return [];
    return parseFeed(await res.text(), feed);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Newest first, with one publisher never allowed to crowd out the rest. */
export async function loadNews() {
  if (cache && Date.now() - cache.storedAt < CACHE_TTL_MS) return cache.value;

  const batches = await Promise.all(FEEDS.map(fetchFeed));
  const items = batches
    .flatMap((batch) => batch.slice(0, 8))
    .filter((item) => item.title && item.link)
    .sort((a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0));

  const perSource = new Map();
  const balanced = [];
  for (const item of items) {
    const count = perSource.get(item.source) ?? 0;
    if (count >= 4) continue;
    perSource.set(item.source, count + 1);
    balanced.push(item);
  }

  // Queer outlets publish on a slower clock than the wire services, so their
  // stories are kept even when they fall outside the newest few dozen.
  const queer = items.filter(
    (item) => item.tone === 'queer' && !balanced.some((kept) => kept.link === item.link),
  );

  const value = {
    items: [...balanced.slice(0, 28), ...queer.slice(0, 4)].sort(
      (a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0),
    ),
    fetchedAt: new Date().toISOString(),
  };
  cache = { value, storedAt: Date.now() };
  return value;
}
