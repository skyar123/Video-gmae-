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

import { loadBlob, saveBlob } from './history.mjs';
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

  // Added against your own list. Every handle below was checked with
  // getProfile for its display name and follower count, because the handle
  // existing proves nothing: alyssamercante.bsky.social resolves fine and is
  // an empty account with no posts, while the real one is alyssamerc. Bluesky
  // search is no better, offering Alyssa Milano for her and Mark Hamill for
  // Hard Drive, so nothing here came from search alone.
  { handle: 'laurakbuzz.bsky.social', note: 'LauraKBuzz' },
  { handle: 'midimyers.com', note: 'Mothership' },
  { handle: 'alyssamerc.bsky.social', note: 'Reporter' },
  { handle: 'ckunzelman.bsky.social', note: 'Rascal, tabletop' },
  { handle: 'nicolecarpenter.bsky.social', note: 'Polygon' },
  { handle: 'polygon.com', note: 'Polygon' },
  { handle: 'unwinnable.com', note: 'Unwinnable' },
  // Time Extension is deliberately not here, though its account is real and
  // was confirmed like the rest. It has an RSS feed in the press list, and
  // an outlet in both places loses stories: dedupe drops the press copy in
  // favour of the post carrying engagement, and that post is then subject to
  // the Bluesky allowance, which the press copy was not. Measured, it turned
  // six Time Extension stories into two. Kotaku and Polygon are fine in both
  // because Kotaku's press copies all survive and Polygon has no working
  // feed to lose.
  { handle: 'lilsimsie.bsky.social', note: 'Sims' },
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

/**
 * YouTube, which turned out to be the best trailer source here: the channels
 * post a release date trailer the day the press write it up a day later.
 *
 * Every id was read off the channel's own page and then confirmed by loading
 * `/channel/<id>` back and checking the name it answered with, because the
 * ids are unguessable and a wrong one fails silently as an empty feed. Two
 * candidates were dropped at that step: the handle `@Nintendo` resolves to a
 * channel called "koi", and `@Xbox`'s id served a page titled "Forza".
 *
 * There is no connection to anyone's own YouTube account here. These are the
 * public uploads feeds, which need no key and know nothing about the reader,
 * so a subscription list is not something this can see.
 */
/**
 * YouTube, your own list first.
 *
 * The first thirty-nine are the channels you named. Each was resolved by
 * searching YouTube for the name, then confirmed by loading /channel/<id>
 * back and checking the page title against what you asked for: all thirty
 * nine matched, the one apparent exception being "D&amp;D Beyond" coming back
 * HTML-escaped. Resolving matters because an id is unguessable and a wrong
 * one fails silently as an empty feed rather than as an error.
 *
 * The rest are the ones already here. They are the trailer and news channels
 * the press feeds do not duplicate in video form, so they stay underneath
 * yours rather than being dropped.
 *
 * There is still no connection to your YouTube account. These are the public
 * uploads feeds, which need no key and know nothing about the viewer, so
 * what you are subscribed to is not something this can see. Your list is
 * here because you typed it out, not because anything read it.
 */
const YOUTUBE = [
  // Yours. PlayStation is the one pinned out of the rotation, because a State
  // of Play should not wait its turn on a PlayStation app.
  { source: "PlayStation", id: "UC-2Y8dQb0S6DtpxNgAKoJKA", pinned: true },
  { source: "Gab Smolders", id: "UCYLHs-NR2le96KKqXofUOXg" },
  { source: "ENFANT TERRIBLE", id: "UCX1sraLIy6wS2R-SMcdoakg" },
  { source: "Indie Games Hub", id: "UCt8CJiye87FMbEwt0npPMuQ" },
  { source: "LauraKBuzz", id: "UCgBcTeH9MIsQteTNufpiuxA" },
  { source: "BlackRose", id: "UCOjP_vCoOxwSZmNaD22WefQ" },
  { source: "Nintendo of America", id: "UCGIY_O-8vW4rfX98KlMkvRg" },
  { source: "Pokemon", id: "UCipBC02N5hqOYwVr5KYlExQ" },
  { source: "Cambonano", id: "UCFk6kGRcHXaXWCzEWq8JEsg" },
  { source: "Valkyrae", id: "UCWxlUwW9BgGISaakjGM37aw" },
  { source: "Emiru", id: "UCZprw7Bxzfh2IysXNnl1S3g" },
  { source: "Sabrinoca", id: "UC9ps3J42mMj5adk_9HxDgOw" },
  { source: "Serasly", id: "UCMhxi0J2XnvbLChXUpj41Kw" },
  { source: "lilsimsie", id: "UC_TYFButglZuuDbD-0Q_IzQ" },
  { source: "Markiplier", id: "UC7_YxT-KID8kRbqZo7MyscQ" },
  { source: "shofu", id: "UCbr6TI0Mujw2iFAQE4R8yrQ" },
  { source: "Cinna", id: "UC8I_85S7LB_-gPG8UceWzJg" },
  { source: "AI Dungeon", id: "UC4MDHO1RIEwGcXOGGRjP4rA" },
  { source: "Voyage", id: "UCKmVog8RvluGkUOE38PEleQ" },
  { source: "Ginny Di", id: "UCe5KNXqT7970K8vkHb5BQ5Q" },
  { source: "Continue?", id: "UCWN49rf6HI1Zb5T-Mism74g" },
  { source: "Stephanie Sterling", id: "UCWCw2Sd7RlYJ2yuNVHDWNOA" },
  { source: "Ashikai", id: "UCJsx9l8WXBm2_zD5REgpERA" },
  { source: "The Sphere Hunter", id: "UCJhsl2VeLfSXzkutwlICyZw" },
  { source: "Skurry", id: "UCYX2-exnYmc6gDObfooTGZg" },
  { source: "Kyedae", id: "UCxjdy5n9BxX_6RTL8Dt_7pg" },
  { source: "Roll20", id: "UCHC1kWACzA7G6D2fqkqsRDg" },
  { source: "Dicebreaker", id: "UC0jMXccxfvnwXvTpngFwbNA" },
  { source: "D&D Beyond", id: "UCPy-338BEVgDkQade0qJmkw" },
  { source: "nickisnotgaming", id: "UCm48V9P_cpk8ObO0BbGoFHQ" },
  { source: "Lomadiah", id: "UCj_dHQWv08dQ0fv6IrzTChQ" },
  { source: "Super Best Friends Play", id: "UC84X0epDRFdTrybxEX8ZWkA" },
  { source: "PewDiePie", id: "UC-lHJZR3Gqxm24_Vd_AJ5Yw" },
  { source: "Gaming Historian", id: "UCnbvPS_rXp4PC21PG2k1UVg" },
  { source: "ZombieCleo", id: "UCjI5qxhtyv3srhWr60HemRw" },
  { source: "PlayStation Europe", id: "UCg_JwOXFtu3iEtbr4ttXm9g" },
  { source: "BuzzFeed Multiplayer", id: "UCBUVGPsJzc1U8SECMgBaMFw" },
  // Already here: trailers and games news as video.
  { source: "PlayStation Access", id: "UC6yzV_xgKn8r77FkcmZyMSg" },
  { source: "IGN", id: "UCKy1dAqELo0zrOtPkf0eTMw" },
  { source: "GameSpot", id: "UCbu2SsF-Or3Rsn3NxqODImw" },
  { source: "GameSpot Trailers", id: "UCUnRn1f78foyP26XGkRfWsA" },
  { source: "Push Square", id: "UCbI-X9F07inmxYvQKDBOU7Q" },
  { source: "Eurogamer", id: "UCciKycgzURdymx-GRSY2_dA" },
  { source: "GamesRadar", id: "UCk2ipH2l8RvLG0dr-rsBiZw" },
  { source: "VGC", id: "UCuzaJiIORaXi7DsuEs03Gow" },
  { source: "Game Informer", id: "UCK-65DO2oOxxMwphl2tYtcw" },
  { source: "Digital Foundry", id: "UC9PBzalIcEQCsiIkq36PyUA" },
  { source: "YongYea", id: "UCT6iAerLNE-0J1S_E97UAuQ" },
  { source: "gameranx", id: "UCNvzD7Z-g64bPXxGzaQaa4g" },
  { source: "Bellular News", id: "UC3nPaf5MeeDTHA2JN7clidg" },
  { source: "The Act Man", id: "UC7WDD6yHgzdqijHluCi1z-Q" },
  { source: "penguinz0", id: "UCq6VFHwMzcMXbuKyG7SQYIg" },
  { source: "Luke Stephens", id: "UCe4_UPAmhz2sqorGbF8oZHA" },
  { source: "Alanah Pearce", id: "UCKpBmnEfSy20al-Fk_2YzVA" },
  { source: "Skill Up", id: "UCZ7AeeVbyslLM_8-nVy2B8Q" },
  { source: "Kinda Funny Games", id: "UCT6QFE3peNry9PdO5uGj96g" },
  { source: "Easy Allies", id: "UCZrxXp1reP8E353rZsB3jaA" },
  { source: "Second Wind", id: "UC1wZGocgLvopgOqBUFCyIJA" },
  { source: "Noclip", id: "UC0fDG3byEcMtbOqPMymDNbw" },
  { source: "People Make Games", id: "UCZB6V9fUov0Mx_us3MWWILg" },
  { source: "Jacob Geller", id: "UCeTfBygNb1TahcNpZyELO8g" },
  { source: "Razbuten", id: "UCfHmyqCntYHQ81ZukNu66rg" },
  { source: "NakeyJakey", id: "UCSdma21fnJzgmPodhC9SJ3g" },
  { source: "Girlfriend Reviews", id: "UC2eEGT06FrWFU6VBnPOR9lg" },
  { source: "MandaloreGaming", id: "UClOGLGPOqlAiLmOvXW5lKbw" },
  { source: "Summoning Salt", id: "UCtUbO6rBht0daVIOGML3c8w" },
  { source: "Caddicarus", id: "UCOkL7q2SeGZeZuj22njMYEA" },
  { source: "ACG", id: "UCK9_x1DImhU-eolIay5rb2Q" },
  { source: "Jauwn", id: "UC-nIhxjNqjcm8EmpPWBg3wA" },
  { source: "videogamedunkey", id: "UCsvn_Po0SmunchJYOWpOxMg" },
];

/**
 * Thirty-odd uploads feeds is thirty-odd sockets, and the whole response has
 * to come back inside the function's own timeout, which the rest of the feed
 * already spends seven seconds of. So the channels go out in small waves
 * behind one shared deadline: whatever has answered when the clock runs out
 * is what the reader gets, and a slow channel costs the other sources
 * nothing instead of taking the request down with it.
 */
const YOUTUBE_DEADLINE_MS = 6000;
/** A pause between feeds, because the rate is what YouTube objects to. */
const YOUTUBE_GAP_MS = 150;

/**
 * YouTube rate-limits the burst, not the feed.
 *
 * With three channels, all three answered from production. With thirty-four
 * asked at once, twenty-three came back 404 and PlayStation and IGN were
 * among them, having served ten entries each twenty minutes earlier. The
 * feeds are fine; asking for the whole roster in one breath is not.
 *
 * So each rebuild asks for ten channels, the window moves on by ten, and
 * what comes back is merged into a stored pool rather than replacing it.
 * Over about an hour of rebuilds the whole roster has been asked, while no
 * single request ever asks for more than ten. The reader sees the pool, so
 * the rotation is invisible to them: a channel that answered an hour ago is
 * still in the feed, and a channel that 404s this time keeps what it had.
 *
 * The pool rides in the price-history blob store under its own key prefix.
 * That store is just "this app's durable JSON" and its helper already
 * handles the local-dev fallback; standing up a second one would be a second
 * thing to configure for no gain.
 */
const YOUTUBE_SLICE = 7;
/*
 * Above anything the roster can hold, so the global cap never binds.
 *
 * Each channel is already capped at ten videos where it is fetched, which is
 * the balancing that matters: 70 channels can store at most 700. Cutting that
 * to 500 by recency would have taken the difference from whoever uploads
 * least often, so Ginny Di's monthly video would lose its place to another
 * day of Markiplier. That is the same mistake the press cap was making this
 * morning, and the answer is the same one: when the data is already balanced
 * per source, a second cap only decides who goes unread.
 */
const YOUTUBE_POOL_MAX = 800;

/**
 * The pool is stored one key per channel, not one key for the whole pool.
 *
 * One shared key meant read-modify-write over state several instances share,
 * and they rebuild on their own clocks: an instance that read a pool of 3 and
 * added 1 would write 4 over the 16 another instance had just written. It is
 * the same race the local price-history file hit when chunks went parallel,
 * and guarding against an empty write only covered the worst case of it.
 *
 * Per channel there is no race left to lose: two instances writing the same
 * channel in the same rotation are writing the same ten videos. A channel
 * that 404s is simply not written, so it keeps what it last had rather than
 * having an empty result saved over it.
 */
const poolKeyFor = (source) =>
  `goss/youtube/${source.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;

/** How many pool keys to have in flight at once. */
const POOL_READ_LANES = 6;

/** Map over items with a bounded number of them in flight, order preserved. */
async function mapLimited(items, limit, fn) {
  const queue = [...items.entries()];
  const out = new Array(items.length);
  const lane = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [index, item] = next;
      out[index] = await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return out;
}

/**
 * PlayStation's own channel sits outside the rotation and is asked every
 * rebuild. Waiting your turn is fine for a documentary and wrong for a State
 * of Play, and on a PlayStation app that is the one channel worth a slot of
 * its own. Everything else takes its turn.
 */
const YOUTUBE_PINNED = YOUTUBE.filter((channel) => channel.pinned);
const YOUTUBE_ROTATING = YOUTUBE.filter((channel) => !channel.pinned);

/** Resolved through the iTunes search API, which needs no key either. */
const PODCASTS = [
  { source: 'Girl Mode', url: 'https://feeds.acast.com/public/shows/6393ec46b89a2a0010dee819' },
  { source: 'Remap Radio', url: 'https://rss.art19.com/remap-radio' },
  { source: 'Triple Click', url: 'https://feeds.simplecast.com/6WD3bDj7' },
];

/**
 * Enough to scroll for a while; the panel sorts and filters what it gets.
 * Higher since the news column was folded in, because this is now the only
 * feed and has to carry what both of them did.
 */
const MAX_BURSTS = 280;

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
    channel: 'bluesky',
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
        channel: 'pod',
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
 * YouTube
 * ------------------------------------------------------------------ */

/** The uploads feed is Atom, so entries rather than items. */
async function loadYouTube({ source, id }, cutoff, budgetMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, budgetMs));
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, {
      signal: controller.signal,
      headers: HEADERS,
      redirect: 'follow',
    });
    if (!res.ok) {
      diagnostics.set(`youtube:${source}`, `http ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    const kept = blocks
      .slice(0, 10)
      .map((block) => {
        const title = plain(field(block, 'title') ?? '');
        const link = (block.match(/<link[^>]*href="([^"]+)"/) || [])[1] ?? null;
        const published = field(block, 'published');
        const at = published ? Date.parse(plain(published)) : NaN;
        return {
          // Classified like anything else: an uploads feed carries
          // interviews and reviews as well as trailers.
          kind: classify(title),
          channel: 'youtube',
          source,
          origin: `${source} on YouTube`,
          note: 'Video',
          author: source,
          authorName: source,
          avatar: null,
          title,
          summary: null,
          link,
          externalLink: null,
          image: (block.match(/<media:thumbnail[^>]*url="([^"]+)"/) || [])[1] ?? null,
          publishedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
          heat: 0,
          at,
        };
      })
      .filter((row) => row.title && row.link && Number.isFinite(row.at) && row.at >= cutoff);
    diagnostics.set(`youtube:${source}`, `${kept.length}/${blocks.length} recent`);
    return kept.map(({ at: _at, ...rest }) => rest);
  } catch (error) {
    diagnostics.set(`youtube:${source}`, error?.name === 'AbortError' ? 'timeout' : 'failed');
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Four outlets post the same trailer inside an hour, each with its own
 * "- Official Trailer | Publisher" tail on the end. Keyed on what is left
 * once that furniture comes off, the first channel through wins.
 *
 * The kind is part of the key, so a game's trailer and its review stay two
 * separate things: without it, "Silksong - Review" and "Silksong - Official
 * Trailer" reduce to the same game and one of them disappears.
 */
const videoKey = (burst) => {
  const cut = burst.title.search(/\s+[-|\u2013]\s+/);
  const head = cut > 8 ? burst.title.slice(0, cut) : burst.title;
  return `${burst.kind}|${head.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
};

/**
 * Fill every channel's key in one slow pass, for the nightly job.
 *
 * A request has ten seconds and so can only ever ask for a handful of feeds,
 * which is why the live path rotates: at seven a rebuild, 70 channels take
 * about two and a half hours to come round, and YouTube refuses most of a
 * burst anyway, so in practice the pool held 22 videos from 3 channels.
 *
 * A scheduled function has minutes. This walks the whole roster one feed at a
 * time with a full second between them, which is both the politest pattern
 * available and the one the evidence favours: three feeds asked gently were
 * answered 3/3, thirty-four asked at once were answered 11/34. Roughly ninety
 * seconds for the lot.
 *
 * It writes the same per-channel keys the live path reads, so the next
 * rebuild simply finds a full pool. A channel that fails is skipped, never
 * written empty, exactly as in the rotation.
 */
const WARM_MARKER_KEY = 'goss/youtube/_last-warm.json';

export async function warmYouTubePool({ gapMs = 1000, now = Date.now(), minIntervalMs = 0 } = {}) {
  // A caller that can be triggered from outside says how recently a warm is
  // allowed to have happened, so hitting it repeatedly cannot turn into 70
  // YouTube requests a go from this one address. The nightly job passes
  // nothing and always runs. The marker is not a channel key, so the pool
  // read never sees it.
  if (minIntervalMs > 0) {
    try {
      const mark = await loadBlob(WARM_MARKER_KEY);
      const at = mark?.at ? Date.parse(mark.at) : NaN;
      if (Number.isFinite(at) && now - at < minIntervalMs) {
        return { skipped: true, lastWarmAt: mark.at, asked: 0, answered: [], silent: [], written: 0 };
      }
    } catch {
      // No marker readable: treat it as never warmed and go ahead.
    }
  }

  const cutoff = now - SEARCH_WINDOW_DAYS * DAY_MS;
  const answered = [];
  const silent = [];
  let written = 0;

  for (const channel of YOUTUBE) {
    const rows = await loadYouTube(channel, cutoff);
    if (rows.length > 0) {
      await saveBlob(poolKeyFor(channel.source), {
        videos: rows,
        storedAt: new Date(now).toISOString(),
      });
      answered.push(`${channel.source}:${rows.length}`);
      written += rows.length;
    } else {
      silent.push(channel.source);
    }
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }

  await saveBlob(WARM_MARKER_KEY, { at: new Date(now).toISOString(), answered: answered.length });
  return { skipped: false, asked: YOUTUBE.length, answered, silent, written };
}

/** This rebuild's ten channels, in waves, against one deadline. */
async function loadYouTubeAll(cutoff) {
  const take = Math.max(0, Math.min(YOUTUBE_SLICE - YOUTUBE_PINNED.length, YOUTUBE_ROTATING.length));
  const turn = Math.floor(Date.now() / CACHE_TTL_MS);
  const start = (turn * take) % YOUTUBE_ROTATING.length;
  const queue = [
    ...YOUTUBE_PINNED,
    ...Array.from({ length: take }, (_, offset) => YOUTUBE_ROTATING[(start + offset) % YOUTUBE_ROTATING.length]),
  ];
  const asked = queue.map((channel) => channel.source);

  // One at a time, with a pause. Five in parallel was still a burst, and a
  // burst is the thing being refused: the fourteen requests before this one
  // all go out at once too, so the lanes were adding to a spike rather than
  // forming one. Serial, five of them, this phase costs about three seconds.
  const deadline = Date.now() + YOUTUBE_DEADLINE_MS;
  const fetched = [];
  for (const channel of queue) {
    const left = deadline - Date.now();
    if (left <= 400) {
      diagnostics.set(`youtube:${channel.source}`, 'out of time');
      continue;
    }
    fetched.push(...(await loadYouTube(channel, cutoff, Math.min(3000, left))));
    await new Promise((resolve) => setTimeout(resolve, YOUTUBE_GAP_MS));
  }

  /*
   * Merged newest-wins over what previous rotations found, then aged out.
   * Fetched rows come last so a re-fetch refreshes rather than duplicates.
   *
   * Six keys in flight, not thirty-four. A rebuild read the whole pool as
   * empty one rotation after another rebuild had written three channels to
   * it, and the data was still there when the next rotation looked: the
   * reads had failed, not the writes. loadBlob answers {} for a read it
   * could not do, so thirty-four of those at once failing together is
   * indistinguishable from an empty pool. It is the same bound the price
   * history settled on for the same store.
   */
  const perChannel = await mapLimited(YOUTUBE, POOL_READ_LANES, async (channel) => {
    try {
      const blob = await loadBlob(poolKeyFor(channel.source));
      return Array.isArray(blob?.videos) ? blob.videos : null;
    } catch {
      return null;
    }
  });
  const keysWithVideos = perChannel.filter((rows) => rows?.length > 0).length;
  const stored = perChannel.flatMap((rows) => rows ?? []);

  const pool = new Map();
  for (const burst of [...stored, ...fetched]) {
    if (!burst?.link || !burst.publishedAt) continue;
    if (Date.parse(burst.publishedAt) < cutoff) continue;
    pool.set(burst.link, burst);
  }
  const videos = [...pool.values()]
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, YOUTUBE_POOL_MAX);

  // Only the channels that actually answered are written, each to its own
  // key. A channel that 404d is left alone and keeps what it last had.
  const answered = new Map();
  for (const burst of fetched) {
    if (!answered.has(burst.source)) answered.set(burst.source, []);
    answered.get(burst.source).push(burst);
  }
  const storedAt = new Date().toISOString();
  await Promise.all(
    [...answered].map(([source, rows]) => saveBlob(poolKeyFor(source), { videos: rows, storedAt })),
  );

  /*
   * Read one key straight back.
   *
   * Two rebuilds in a row read the pool as empty right after a rebuild had
   * written three channels to it, and both halves of that round trip fail
   * silently: loadBlob answers {} for a read it could not do, and saveBlob
   * swallows a write it could not do, because this data was only ever meant
   * to be an enhancement. That is the right default and a terrible way to
   * find out which one is broken, so the round trip is now reported.
   */
  if (answered.size > 0) {
    const [probe] = [...answered.keys()];
    try {
      const back = await loadBlob(poolKeyFor(probe));
      diagnostics.set(
        'youtube:store',
        Array.isArray(back?.videos)
          ? `round trip ok: ${probe} read back ${back.videos.length}`
          : `round trip LOST: ${probe} wrote ${answered.get(probe).length}, read back nothing`,
      );
    } catch (error) {
      diagnostics.set('youtube:store', `round trip threw: ${error?.message ?? 'unknown'}`);
    }
  }

  diagnostics.set(
    'youtube',
    `asked ${asked.length} (${asked.join(', ')}), got ${fetched.length} from ${answered.size}, pool ${videos.length} of ${stored.length} stored across ${keysWithVideos}/${YOUTUBE.length} keys`,
  );

  const unique = new Map();
  for (const burst of videos) {
    const key = videoKey(burst);
    if (!unique.has(key)) unique.set(key, burst);
  }
  return [...unique.values()];
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
        channel: 'press',
        source: item.source,
        origin: item.source,
        // Which shelf of the press this came from, so the merged feed can
        // still be narrowed to the queer and worker-owned outlets the way
        // the separate news column could.
        tone: item.tone ?? null,
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

  const [searched, voices, pods, press, videos] = await Promise.all([
    searchGoss(since),
    voiceGoss(cutoff),
    Promise.all(PODCASTS.map((pod) => loadPodcast(pod, now - 21 * DAY_MS))).then((all) =>
      all.flat(),
    ),
    pressGoss(),
    loadYouTubeAll(cutoff),
  ]);

  const byKind = new Map();
  for (const kind of KINDS) byKind.set(kind, []);

  // Bluesky first so that when the same story exists as both a post and a
  // headline, the version with the engagement number on it survives dedupe.
  for (const burst of dedupe([...searched, ...voices, ...pods, ...videos, ...press])) {
    const bucket = byKind.get(burst.kind);
    if (bucket) bucket.push(burst);
  }

  for (const [kind, bucket] of byKind) {
    // Kept by both measures, and per channel.
    //
    // Ranking purely on engagement and cutting at twelve threw away two
    // thirds of what had been found, and everything that survived was days
    // old: a post needs time to gather likes, so the newest thing could never
    // be the loudest. Each kind keeps its loudest and its newest, which is
    // what makes a Latest view worth having.
    //
    // And it does that per channel, because they are not comparable. A
    // Bluesky post carries an engagement count and a headline does not, so
    // one list ranked by heat is a list of posts: when the news column was
    // folded into this feed, the press went from seventy two stories to about
    // twenty. Each channel gets its own allowance instead.
    const pick = (channel, hot, fresh) => {
      const rows = bucket.filter((burst) => burst.channel === channel);
      const loudest = [...rows].sort((a, b) => b.heat - a.heat || newest(a, b));
      const freshest = [...rows].sort(newest);
      return [...loudest.slice(0, hot), ...freshest.slice(0, fresh)];
    };

    const wide = kind === 'beef';
    const chosen = new Map();
    for (const burst of [
      ...pick('bluesky', wide ? 22 : 14, wide ? 14 : 10),
      // No cap on the press at all. loadNews has already balanced it across
      // publishers and guaranteed each one its newest story, so capping
      // again here only decides which of those the reader never sees, and
      // because this pick sorts by recency it takes them from whoever
      // publishes least often, which is most of the queer press.
      //
      // Sixty was written when loadNews returned about seventy stories and
      // the cap almost never bound. Adding eight feeds took it to 101, the
      // cap started binding, and the queer press fell from 22 to 9 while
      // Time Extension, Unwinnable and Game Developer vanished from the feed
      // despite all three serving. The number is above anything loadNews can
      // produce: MAX_ITEMS is 100, plus one rescued story per silent feed.
      ...pick('press', 0, 200),
      ...pick('pod', 0, 10),
      // Thirty-odd channels against three: the old allowance of twelve was
      // set when YouTube was a trailer sidecar, and would now be throwing
      // away most of the largest channel in the feed.
      ...pick('youtube', 0, wide ? 26 : 20),
    ]) {
      chosen.set(burst.link, burst);
    }
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
