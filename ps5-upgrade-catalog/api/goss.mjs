/**
 * The Goss: industry chatter, trailer drops and review drops, in bursts.
 *
 * Gossip has no API, so this reads three keyless sources:
 *
 *  - Bluesky's public AppView, which is where the games industry actually
 *    argues with itself. Post search needs no key on `api.bsky.app` (the
 *    `public.api` host refuses `searchPosts` with a 403 but serves everything
 *    else), so both a curated account list and a set of industry queries come
 *    from there.
 *  - Podcast feeds, because half the goss is something somebody said out loud
 *    on a show before it was ever written down.
 *  - The publisher feeds the News tab already reads, sorted into bursts
 *    instead of one flat column. Reusing `loadNews` means its cache is shared
 *    and no feed gets fetched twice.
 *
 * Nothing is restated here as fact. Every burst keeps whoever said it and
 * links back to them, which is the difference between an aggregator and a
 * rumour mill. Posts about named people are presented as "this person posted
 * this", never as "it is true that".
 */

import { loadNews } from './news.mjs';

const BSKY = 'https://api.bsky.app/xrpc';

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'application/json, application/rss+xml, application/xml;q=0.9, */*;q=0.5',
  'accept-language': 'en-US,en;q=0.9',
};

/**
 * Accounts that break or carry industry news. Each one was checked against
 * `getProfile` before being listed; a handle that dies later just returns
 * nothing and is skipped rather than breaking the panel. Remap has no
 * account of its own, so it is here as its writers, its RSS feed and its
 * podcast instead.
 */
const VOICES = [
  { handle: 'aftermath.site', note: 'Worker-owned' },
  { handle: 'rascal.news', note: 'Worker-owned' },
  { handle: 'gibiz.bsky.social', note: 'Trade press' },
  { handle: 'jasonschreier.bsky.social', note: 'Bloomberg' },
  { handle: 'stephentotilo.bsky.social', note: 'Game File' },
  { handle: 'nathangrayson.bsky.social', note: 'Aftermath' },
  { handle: 'patrickklepek.bsky.social', note: 'Remap' },
  { handle: 'moomanibe.bsky.social', note: 'Critic' },
  { handle: 'ramiismail.com', note: 'Developer advocate' },
  { handle: 'timoflegend.bsky.social', note: 'Double Fine' },
  { handle: 'doublefine.com', note: 'Studio' },
];

/**
 * Queries tuned for industry discourse rather than for any one game. Each was
 * run before being listed: wordings that look reasonable return nothing real
 * ("game studio layoffs" found ten posts whose best score was one like, while
 * "games industry layoffs" found the stories everyone was arguing about), a
 * bare "layoffs" pulls in the whole news cycle rather than this industry's,
 * and "games press" turned out to match university presses.
 */
const QUERIES = [
  'games industry',
  'games industry layoffs',
  'games union',
  'game devs',
  'games media',
  'video game drama',
  'game awards',
  'studio shut down',
];

/** Resolved through the iTunes search API, which needs no key either. */
const PODCASTS = [
  { source: 'Girl Mode', url: 'https://feeds.acast.com/public/shows/6393ec46b89a2a0010dee819' },
  { source: 'Remap Radio', url: 'https://rss.art19.com/remap-radio' },
  { source: 'Triple Click', url: 'https://feeds.simplecast.com/6WD3bDj7' },
];

/** Enough to scroll for a while; the panel sorts and filters what it gets. */
const MAX_BURSTS = 140;

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const SEARCH_WINDOW_DAYS = 7;

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

// Checked in this order, because a review-bombing campaign is beef and a
// trailer that leaked is a leak.
const BEEF =
  /\b(backlash|controvers\w+|apolog\w+|slam(?:s|med)?|criticis\w+|criticiz\w+|fires? back|hits? back|calls? out|called out|drama|feud|beef|spat|lawsuit|sues?|suing|layoffs?|laid off|sack(?:s|ed|ing)?|union\w*|unionis\w+|unioniz\w+|walkout|strike|picket|allegation\w*|alleged\w*|accus\w+|resign\w*|steps? down|stepped down|ousted|den(?:y|ies|ied)|leak(?:s|ed|ing)?|fired|quits?|boycott|petition|review bomb\w*|shut(?:ting)? down|shuts down|closure|studio closes?|cancel\w*|delay(?:s|ed|ing)?|postpon\w+|pivot\w*|pulled from sale|walks? back)\b/i;
// Deliberately narrow. A bare "announce" filed a studio's career announcement
// and a delayed-game story under trailers, so this asks for words that mean
// something was actually shown.
const TRAILER =
  /\b(trailer|teaser|first look|gameplay|showcase|state of play|nintendo direct|world premiere|reveal(?:s|ed|ing)?|release date|out now|launch(?:es|ed)? today)\b/i;
const REVIEW =
  /\b((?<!peer[\s-])review\w*|scores?|metacritic|opencritic|verdict|impressions|hands[- ]on|rated|game of the year|goty)\b/i;

// Checked ahead of trailers, because "my written review is out now" otherwise
// matches "out now" and gets filed as a trailer drop.
const REVIEW_CLAIMED =
  /\b(?:my|our|written|full)\s+reviews?\b|\breview:\s|\breviews?\s+(?:are|is)\s+(?:in|out|live|up)\b/i;

function classify(text) {
  if (BEEF.test(text)) return 'beef';
  if (REVIEW_CLAIMED.test(text)) return 'review';
  if (TRAILER.test(text)) return 'trailer';
  if (REVIEW.test(text)) return 'review';
  return 'buzz';
}

/* ------------------------------------------------------------------ *
 * Bluesky
 * ------------------------------------------------------------------ */

/** Accounts that post real things, just never gossip. */
const NOT_GOSS = new Set([
  'wario64.bsky.social',
  'dealabs.bsky.social',
  'isthereanydeal.com',
]);

const PROMO = /(#ad\b|\bsponsored\b|\bgiveaway\b|\buse code\b|\bdiscount code\b|buff\.ly|humble ?bundle|\bon sale\b|\bcoupon\b)/i;

const stripFurniture = (text) =>
  text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#[\w-]+/g, ' ')
    .replace(/@[\w.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A post's own web address, which the API gives only as an `at://` URI. */
const postUrl = (post) => {
  const rkey = String(post?.uri ?? '').split('/').pop();
  const handle = post?.author?.handle;
  return rkey && handle ? `https://bsky.app/profile/${handle}/post/${rkey}` : null;
};

const embedOf = (post) => post?.embed ?? post?.record?.embed ?? null;

const embedImage = (post) => {
  const embed = embedOf(post);
  return (
    embed?.images?.[0]?.thumb ??
    embed?.media?.images?.[0]?.thumb ??
    embed?.external?.thumb ??
    null
  );
};

const embedLink = (post) => embedOf(post)?.external?.uri ?? null;

async function bskyGet(path, params) {
  const query = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${BSKY}/${path}?${query}`, {
      signal: controller.signal,
      headers: HEADERS,
    });
    if (!res.ok) return { error: `http ${res.status}` };
    return { data: await res.json() };
  } catch (error) {
    return { error: error?.name === 'AbortError' ? 'timeout' : 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turns a post into a burst, or returns null if it is noise.
 *
 * `minLikes` is the whole filter for search results, where anybody can match a
 * keyword. Curated accounts are already a filter, so they get a low floor.
 */
function toBurst(post, { minLikes, origin, note = null }) {
  const record = post?.record ?? {};
  const text = String(record.text ?? '').trim();
  if (!text) return null;

  // Replies arrive without the thing they are replying to, so they read as
  // non-sequiturs no matter how popular they are.
  if (record.reply) return null;

  const handle = post?.author?.handle ?? '';
  if (NOT_GOSS.has(handle) || PROMO.test(text)) return null;

  const langs = record.langs;
  if (Array.isArray(langs) && langs.length && !langs.some((l) => String(l).startsWith('en'))) {
    return null;
  }

  const likes = post.likeCount ?? 0;
  const reposts = post.repostCount ?? 0;
  if (likes < minLikes) return null;

  // "xbox" with 800 likes is not a story. Neither is a bare link.
  const body = stripFurniture(text);
  if (body.length < 45) return null;

  const link = postUrl(post);
  if (!link) return null;

  const external = embedLink(post);
  const kind = classify(`${text} ${external ?? ''}`);

  return {
    kind,
    source: 'Bluesky',
    origin,
    note,
    author: handle,
    authorName: post?.author?.displayName ?? null,
    avatar: post?.author?.avatar ?? null,
    title: text.length > 240 ? `${text.slice(0, 237)}…` : text,
    summary: null,
    link,
    externalLink: external,
    image: embedImage(post),
    publishedAt: record.createdAt ? new Date(record.createdAt).toISOString() : null,
    heat: likes + reposts * 3,
    likes,
    reposts,
  };
}

const diagnostics = new Map();

async function searchGoss(since) {
  const results = await Promise.all(
    QUERIES.map(async (q) => {
      const { data, error } = await bskyGet('app.bsky.feed.searchPosts', {
        q,
        limit: '25',
        sort: 'top',
        lang: 'en',
        since,
      });
      if (error) {
        diagnostics.set(`search:${q}`, error);
        return [];
      }
      const posts = data?.posts ?? [];
      const bursts = posts
        .map((post) => toBurst(post, { minLikes: 40, origin: `“${q}” on Bluesky` }))
        .filter(Boolean);
      diagnostics.set(`search:${q}`, `${bursts.length}/${posts.length} kept`);
      return bursts;
    }),
  );
  return results.flat();
}

async function voiceGoss(cutoff) {
  const results = await Promise.all(
    VOICES.map(async ({ handle, note }) => {
      const { data, error } = await bskyGet('app.bsky.feed.getAuthorFeed', {
        actor: handle,
        limit: '15',
        filter: 'posts_no_replies',
      });
      if (error) {
        diagnostics.set(`voice:${handle}`, error);
        return [];
      }
      const feed = data?.feed ?? [];
      const bursts = feed
        .map((entry) => {
          // On a repost the author is someone else, so the voice's own note
          // would credential the wrong person.
          const reposted = Boolean(entry?.reason);
          const burst = toBurst(entry?.post, {
            minLikes: 8,
            origin: reposted ? `${handle} reposted` : handle,
            note: reposted ? null : note,
          });
          if (!burst) return null;
          const at = burst.publishedAt ? Date.parse(burst.publishedAt) : NaN;
          return Number.isFinite(at) && at >= cutoff ? burst : null;
        })
        .filter(Boolean);
      diagnostics.set(`voice:${handle}`, `${bursts.length}/${feed.length} kept`);
      return bursts;
    }),
  );
  return results.flat();
}

/* ------------------------------------------------------------------ *
 * Podcasts
 * ------------------------------------------------------------------ */

const decode = (value) =>
  String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8216;|&lsquo;/g, '‘')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

const plain = (value) => decode(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const field = (block, name) => {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? match[1] : null;
};

async function loadPodcast({ source, url }, cutoff) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS, redirect: 'follow' });
    if (!res.ok) {
      diagnostics.set(`pod:${source}`, `http ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
    const episodes = blocks.slice(0, 6).map((block) => {
      const published = field(block, 'pubDate');
      const at = published ? Date.parse(plain(published)) : NaN;
      const summary = plain(
        field(block, 'itunes:subtitle') ?? field(block, 'description') ?? '',
      );
      return {
        kind: 'pod',
        source,
        origin: source,
        note: 'Podcast',
        author: source,
        authorName: source,
        avatar: null,
        title: plain(field(block, 'title') ?? ''),
        summary: summary.length > 260 ? `${summary.slice(0, 257)}…` : summary,
        link: (plain(field(block, 'link') ?? '') || plain(field(block, 'guid') ?? '')) || null,
        externalLink: null,
        image: (block.match(/<itunes:image[^>]*href="([^"]+)"/i) || [])[1] ?? null,
        publishedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
        heat: 0,
      };
    });
    const kept = episodes.filter(
      (ep) => ep.title && ep.link && ep.publishedAt && Date.parse(ep.publishedAt) >= cutoff,
    );
    diagnostics.set(`pod:${source}`, `${kept.length}/${blocks.length} recent`);
    return kept;
  } catch (error) {
    diagnostics.set(`pod:${source}`, error?.name === 'AbortError' ? 'timeout' : 'failed');
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Press
 * ------------------------------------------------------------------ */

/** The News tab's own items, sorted into bursts instead of one column. */
async function pressGoss() {
  try {
    const { items = [] } = await loadNews();
    diagnostics.set('press', `${items.length} items`);
    return items
      .filter((item) => item.title && item.link)
      .map((item) => ({
        kind: classify(`${item.title} ${item.summary ?? ''}`),
        source: item.source,
        origin: item.source,
        note: item.note ?? null,
        author: item.source,
        authorName: item.source,
        avatar: null,
        title: item.title,
        summary: item.summary ?? null,
        link: item.link,
        externalLink: null,
        image: item.image ?? null,
        publishedAt: item.publishedAt,
        heat: 0,
      }));
  } catch (error) {
    diagnostics.set('press', `failed: ${error?.message ?? error}`);
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

const KINDS = ['beef', 'trailer', 'review', 'pod', 'buzz'];

/** Keeps the loudest copy when the same story arrives from two places. */
function dedupe(bursts) {
  const byLink = new Map();
  const bySubstance = new Map();
  const kept = [];
  for (const burst of bursts) {
    const link = burst.link;
    if (byLink.has(link)) continue;
    // Two outlets writing the same headline, or a post quoted twice.
    const signature = stripFurniture(burst.title).toLowerCase().slice(0, 70);
    const rival = signature.length >= 30 ? bySubstance.get(signature) : undefined;
    if (rival !== undefined) {
      if (burst.heat > kept[rival].heat) kept[rival] = burst;
      continue;
    }
    byLink.set(link, true);
    if (signature.length >= 30) bySubstance.set(signature, kept.length);
    kept.push(burst);
  }
  return kept;
}

const newest = (a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0);

/**
 * Round-robins the kinds rather than sorting everything together.
 *
 * A global sort would be dominated by whichever source counts engagement, and
 * the screen would be one kind of thing over and over. Interleaving means the
 * deck always reads as a mix, which is the point of it.
 */
function interleave(byKind) {
  const queues = KINDS.map((kind) => [...(byKind.get(kind) ?? [])]);
  const out = [];
  let drained = false;
  while (!drained) {
    drained = true;
    for (const queue of queues) {
      const next = queue.shift();
      if (next) {
        out.push(next);
        drained = false;
      }
    }
  }
  return out;
}

let cache = null;

export const gossDiagnostics = () => Object.fromEntries(diagnostics);

export async function loadGoss() {
  if (cache && Date.now() - cache.storedAt < CACHE_TTL_MS) return cache.value;

  const now = Date.now();
  const cutoff = now - SEARCH_WINDOW_DAYS * DAY_MS;
  const since = new Date(cutoff).toISOString();

  const [searched, voices, pods, press] = await Promise.all([
    searchGoss(since),
    voiceGoss(cutoff),
    Promise.all(PODCASTS.map((pod) => loadPodcast(pod, now - 21 * DAY_MS))).then((all) =>
      all.flat(),
    ),
    pressGoss(),
  ]);

  const byKind = new Map();
  for (const kind of KINDS) byKind.set(kind, []);

  // Bluesky first so that when the same story exists as both a post and a
  // headline, the version with the engagement number on it survives dedupe.
  for (const burst of dedupe([...searched, ...voices, ...pods, ...press])) {
    const bucket = byKind.get(burst.kind);
    if (bucket) bucket.push(burst);
  }

  for (const [kind, bucket] of byKind) {
    // Kept by both measures, not one.
    //
    // Ranking purely on engagement and then cutting at twelve threw away two
    // thirds of what had been found, and everything that survived was a few
    // days old: a post needs time to gather likes, so the newest thing in the
    // feed could never be the loudest. Each kind now keeps its loudest and
    // its newest, which is also what makes a Latest view worth having.
    const loudest = [...bucket].sort((a, b) => b.heat - a.heat || newest(a, b));
    const freshest = [...bucket].sort(newest);
    const hotCap = kind === 'beef' ? 30 : 20;
    const freshCap = kind === 'beef' ? 20 : 15;

    const chosen = new Map();
    for (const burst of loudest.slice(0, hotCap)) chosen.set(burst.link, burst);
    for (const burst of freshest.slice(0, freshCap)) chosen.set(burst.link, burst);
    byKind.set(kind, [...chosen.values()]);
  }

  const value = {
    bursts: interleave(byKind).slice(0, MAX_BURSTS),
    counts: Object.fromEntries([...byKind].map(([kind, bucket]) => [kind, bucket.length])),
    fetchedAt: new Date(now).toISOString(),
  };
  cache = { value, storedAt: now };
  return value;
}
