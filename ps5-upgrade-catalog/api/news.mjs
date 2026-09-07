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

  // The queer shelf is not one magazine. It is the LGBTQ+ gaming press, queer
  // publications that cover games, and the worker-owned sites founded and
  // staffed by queer writers who left the big outlets.
  {
    source: 'Gayming Magazine',
    url: 'https://gaymingmag.com/feed/',
    tone: 'queer',
    note: 'LGBTQ+ gaming magazine',
  },
  {
    source: 'Autostraddle',
    url: 'https://www.autostraddle.com/tag/video-games/feed/',
    tone: 'queer',
    note: 'Queer publication, games desk',
  },
  {
    source: 'Them',
    url: 'https://www.them.us/feed/rss',
    tone: 'queer',
    note: 'Queer publication, culture desk',
    filter: /\b(game|gaming|gamer|console|playstation|nintendo|xbox|steam|indie)\b/i,
  },
  {
    source: 'Aftermath',
    url: 'https://aftermath.site/feed',
    tone: 'queer',
    note: 'Worker-owned, queer staff',
  },
  {
    source: 'Remap',
    url: 'https://remapradio.com/rss/',
    tone: 'queer',
    note: 'Worker-owned, queer staff',
  },
  {
    source: 'Uppercut',
    url: 'https://uppercutcrit.com/feed/',
    tone: 'queer',
    note: 'Worker-owned criticism co-op',
  },
  {
    source: 'Rascal',
    url: 'https://rascal.news/rss/',
    tone: 'queer',
    note: 'Worker-owned, queer-led',
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
      note: feed.note ?? null,
      title: stripTags(tag(block, 'title') ?? ''),
      link: link?.trim() ?? null,
      publishedAt: published ? new Date(published).toISOString() : null,
      summary: cleanSummary(summaryRaw).slice(0, 220),
      image,
    };
  });
}

// Several publishers return 403 or 406 to an obviously automated agent even
// though the feed is public, so requests look like a browser's.
const FEED_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
  'accept-language': 'en-US,en;q=0.9',
};

/** Records why a feed came back empty, which is otherwise invisible. */
const feedStatus = new Map();

async function fetchFeed(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: FEED_HEADERS,
      redirect: 'follow',
    });
    if (!res.ok) {
      feedStatus.set(feed.source, `http ${res.status}`);
      return [];
    }
    const items = parseFeed(await res.text(), feed);
    feedStatus.set(feed.source, `${items.length} items`);
    return items;
  } catch (error) {
    feedStatus.set(feed.source, error?.name === 'AbortError' ? 'timeout' : 'failed');
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const feedDiagnostics = () => Object.fromEntries(feedStatus);

/** Newest first, with one publisher never allowed to crowd out the rest. */
export async function loadNews() {
  if (cache && Date.now() - cache.storedAt < CACHE_TTL_MS) return cache.value;

  const batches = await Promise.all(FEEDS.map(fetchFeed));
  const items = batches
    .flatMap((batch, index) => {
      const { filter } = FEEDS[index];
      // A general-culture feed only belongs here for the games it covers.
      const relevant = filter
        ? batch.filter((item) => filter.test(`${item.title} ${item.summary}`))
        : batch;
      return relevant.slice(0, 8);
    })
    .filter((item) => item.title && item.link)
    .sort((a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0));

  const perSource = new Map();
  const balanced = [];
  for (const item of items) {
    const count = perSource.get(item.source) ?? 0;
    if (count >= 3) continue;
    perSource.set(item.source, count + 1);
    balanced.push(item);
  }

  const kept = balanced.slice(0, 30);
  const links = new Set(kept.map((item) => item.link));

  // Sorting by recency alone buries anyone who does not publish hourly, which
  // is most of the queer press, so every feed that returned something is
  // guaranteed its newest story.
  const represented = new Set(kept.map((item) => item.source));
  for (const item of items) {
    if (represented.has(item.source) || links.has(item.link)) continue;
    represented.add(item.source);
    links.add(item.link);
    kept.push(item);
  }

  const value = {
    items: kept.sort((a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0)),
    fetchedAt: new Date().toISOString(),
  };
  cache = { value, storedAt: Date.now() };
  return value;
}

/* ------------------------------------------------------------------ *
 * Per-game news
 * ------------------------------------------------------------------ */

/**
 * News about one game.
 *
 * Publisher feeds only carry the last day or so, which is no use when you open
 * a game that had its moment last month. Google News publishes a search feed
 * that covers the whole press at once, so that is what a single game's news
 * comes from. Its items read "Headline - Publisher", which is split back apart
 * here so the result looks like the rest of the app.
 */
const GAME_NEWS_TTL_MS = 60 * 60 * 1000;
const gameNewsCache = new Map();

const looseMatch = (haystack, needle) => {
  const words = needle
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
  if (words.length === 0) return true;
  const text = haystack.toLowerCase();
  const hits = words.filter((word) => text.includes(word)).length;
  return hits / words.length >= 0.6;
};

export async function loadGameNews(title) {
  const key = title.trim().toLowerCase();
  if (!key) return { items: [], fetchedAt: null };

  const cached = gameNewsCache.get(key);
  if (cached && Date.now() - cached.storedAt < GAME_NEWS_TTL_MS) return cached.value;

  const query = encodeURIComponent(`"${title}" (game OR PlayStation OR PS5)`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let items = [];
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ps5-upgrade-catalog/1.0)' },
    });
    if (response.ok) {
      const parsed = parseFeed(await response.text(), { source: 'Google News', tone: 'general' });
      items = parsed
        .filter((item) => item.title && item.link)
        .map((item) => {
          // "Headline - Publisher" is the shape Google News uses.
          const split = item.title.lastIndexOf(' - ');
          const headline = split > 20 ? item.title.slice(0, split) : item.title;
          const source = split > 20 ? item.title.slice(split + 3) : 'Google News';
          return { ...item, title: headline, source, summary: '' };
        })
        .filter((item) => looseMatch(item.title, title))
        .slice(0, 8);
    }
  } catch {
    // No news is a normal outcome; the panel says so.
  } finally {
    clearTimeout(timer);
  }

  const value = { items, fetchedAt: new Date().toISOString() };
  gameNewsCache.set(key, { value, storedAt: Date.now() });
  if (gameNewsCache.size > 300) gameNewsCache.delete(gameNewsCache.keys().next().value);
  return value;
}
