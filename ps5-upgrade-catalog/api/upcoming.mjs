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
import { DISCOVERED_KEY, STEAM_MATCH_KEY, SWEEP_LOG_KEY } from './keys.mjs';
import { ratingFromConcept } from './rating.mjs';

const UA = 'Mozilla/5.0 (compatible; ps5-upgrade-catalog/1.0)';
const READ_CAP = 190_000; // Release date, art, price and genres all land inside this.
/*
 * Fifteen minutes, not six hours.
 *
 * The calendar is rebuilt nightly, and this cache sat in front of it for six
 * hours while the CDN held its own copy for another six. A sweep could write
 * a new calendar and readers would keep the old one for most of a day, and
 * the instance that ran the sweep is the only one its `memory = null` reaches.
 * That is also why a 46-day-old calendar was so hard to see: every probe was
 * answered from a copy taken before the thing being tested ran.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;
const BLOB_KEY = 'upcoming/us.json';

/** Where the last served calendar came from; read by the debug endpoint. */
let calendarSource = null;
let lastSweep = null;
export const upcomingDiagnostics = () => ({ ...calendarSource, lastSweep });
const SEEDS_KEY = 'upcoming/seeds.json';
const CURSOR_KEY = 'upcoming/cursor.json';

// The store keeps announcing things, so the ID space is swept a slice at a
// time by the nightly job rather than frozen at whatever the last deploy knew.
const SCAN_FROM = 10_006_000;
const SCAN_TO = 10_030_000;
const SCAN_WINDOW = 1_500;

/*
 * How long the id scan may take before it stops and banks what it found.
 *
 * 1,500 concept pages is about two minutes from here and evidently far
 * longer from the platform: the sweep never reached its save, so it wrote
 * neither a calendar nor a record of having failed. Put at the front of the
 * shared background function it then ate that function's whole budget and
 * stopped the PS Plus scan advancing as well.
 *
 * The scan is the part allowed to be cut short. Rebuilding the calendar and
 * saving it are not: they run on whatever the scan managed, and the cursor
 * advances only over ids actually visited, so nothing is skipped. It just
 * takes more nights.
 */
const SCAN_BUDGET_MS = 4 * 60 * 1000;

// A game stays in "just released" for this long after its date, which is how
// something new reaches the app without the catalog itself being rebuilt.
const RECENT_DAYS = 60;

// Every seed costs a store fetch on the nightly rebuild, so the discovered
// list is bounded; the baked seeds are always kept on top of this.
const MAX_DISCOVERED_SEEDS = 120;

// The mirror's blob half only has to cover what the baked index missed, so it
// is bounded too rather than growing without limit.
const MAX_MIRROR_ROWS = 6_000;

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
  const stars = html.match(/"averageRating":([\d.]+),"totalRatingsCount":(\d+)/);
  const ageRating = ratingFromConcept(html);
  // The store ships the official trailer on the page: role PREVIEW, type VIDEO.
  const trailer =
    (html.match(/"role":"PREVIEW","type":"VIDEO","url":"([^"]+)"/) || [])[1] ||
    (html.match(/"url":"([^"]*\.mp4[^"]*)"/) || [])[1] ||
    null;

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
    stars: stars ? Number(stars[1]) : null,
    votes: stars ? Number(stars[2]) : null,
    ageRating,
    trailer,
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
    const live = Array.isArray(stored?.games) && stored.games.length > 0;
    const source = live ? stored : snapshot;
    // Which of the two answered, because they are indistinguishable from
    // outside and the difference is whether the nightly sweep is running at
    // all. The calendar served a deploy-time snapshot for 46 days without
    // anything saying so.
    lastSweep = (await loadBlob(SWEEP_LOG_KEY)) ?? null;
    calendarSource = {
      from: live ? 'nightly sweep' : 'snapshot baked at deploy',
      sweptAt: source?.fetchedAt ?? null,
      ageDays: source?.fetchedAt
        ? Math.round((Date.now() - Date.parse(source.fetchedAt)) / 86_400_000)
        : null,
    };
    const sliced = reslice(source);

    // A calendar game is a store concept like any other, so the Steam ids the
    // nightly matcher finds apply here too and a game keeps the same match
    // after release that it had before it.
    const matches = (await loadBlob(STEAM_MATCH_KEY))?.byId ?? {};
    const withSteam = (rows) =>
      rows.map((row) => ({ ...row, steamAppId: row.steamAppId ?? matches[row.id] ?? null }));

    const value = {
      ...sliced,
      games: withSteam(sliced.games),
      recent: withSteam(sliced.recent),
    };
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
/**
 * Records how the last sweep went, because its logs are not readable here.
 *
 * The sweep runs inside a try/catch in two callers, so a failure is silent
 * from outside: the calendar simply keeps serving the snapshot, which is
 * exactly what it did for 46 days. This writes the outcome where the debug
 * endpoint can read it.
 */
async function noteSweep(outcome) {
  try {
    await saveBlob(SWEEP_LOG_KEY, { ...outcome, at: new Date().toISOString() });
  } catch {
    // A failure to record a failure is not worth propagating.
  }
}

export async function sweepForReleases(options = {}) {
  try {
    return await runSweep(options);
  } catch (error) {
    await noteSweep({ ok: false, error: String(error?.message ?? error).slice(0, 300) });
    throw error;
  }
}

async function runSweep({ budgetMs = SCAN_BUDGET_MS } = {}) {
  const cursorState = await loadBlob(CURSOR_KEY);
  const from = cursorState?.next && cursorState.next < SCAN_TO ? cursorState.next : SCAN_FROM;
  const to = Math.min(from + SCAN_WINDOW, SCAN_TO);

  /*
   * Rebuild the calendar first, before the scan touches the store.
   *
   * This used to run last, "against the new seed list so no reader ever pays
   * for it", and in production it came back empty every time: the scan asks
   * the store for 1,500 concept pages, and the rebuild's own 139 seed
   * fetches were then being refused. The sweep reported ok with 1,500
   * scanned and saved nothing, for 46 days.
   *
   * Running first means a seed discovered tonight reaches the calendar
   * tomorrow rather than tonight. That is the cost, and it is a great deal
   * cheaper than a calendar that never updates at all.
   */
  const rebuilt = await build();
  const saved = rebuilt.games.length > 0 || rebuilt.recent.length > 0;
  if (saved) await saveBlob(BLOB_KEY, rebuilt);

  const deadline = Date.now() + budgetMs;
  const all = Array.from({ length: to - from }, (_, index) => from + index);
  // The ids are sequential, so an id names its own position in the window
  // and mapWithConcurrency does not need to pass one.
  let reached = 0;
  const found = await mapWithConcurrency(all, 10, async (id) => {
    if (Date.now() > deadline) return null;
    reached = Math.max(reached, id - from + 1);
    const html = await fetchConcept(id);
    return html ? parseConcept(id, html) : null;
  });
  const ids = all.slice(0, reached);
  const stoppedEarly = reached < all.length;

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

  // The same pages feed the store mirror, so every game the sweep sees is
  // recorded whether or not it has a future release date. This is how the
  // mirror keeps growing after the index baked into a deploy goes stale.
  const mirror = new Map();
  for (const row of (await loadBlob(DISCOVERED_KEY))?.games ?? []) mirror.set(row.id, row);
  for (const game of found.filter(Boolean)) {
    mirror.set(game.id, {
      id: game.id,
      name: game.title,
      release: game.releaseDate,
      platforms: game.platforms,
      genres: game.genres,
      publisher: game.publisher,
      price: game.basePrice,
      stars: game.stars,
      votes: game.votes,
      art: game.art,
      portrait: game.portrait,
    });
  }
  await saveBlob(DISCOVERED_KEY, {
    games: [...mirror.values()].slice(-MAX_MIRROR_ROWS),
    sweptAt: new Date().toISOString(),
  });
  const nextCursor = from + ids.length;
  await saveBlob(CURSOR_KEY, { next: nextCursor >= SCAN_TO ? SCAN_FROM : nextCursor });

  memory = null;

  await noteSweep({
    ok: true,
    saved,
    scanned: ids.length,
    stoppedEarly,
    from,
    to: from + ids.length,
    calendar: rebuilt.games.length,
    recent: rebuilt.recent.length,
    mirror: mirror.size,
  });

  return {
    scanned: ids.length,
    stoppedEarly,
    from,
    to: from + ids.length,
    discovered: fresh.length,
    seeds: kept.size,
    calendar: rebuilt.games.length,
    recent: rebuilt.recent.length,
    mirror: mirror.size,
  };
}
