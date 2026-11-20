/**
 * IGDB, for the games the PlayStation Store has never heard of.
 *
 * Everything else this app reads is a storefront, and a storefront only
 * knows what it sells. That leaves three holes a reader falls into:
 *
 *   - a game announced but not listed anywhere yet, so Soon cannot see it
 *   - a console exclusive with no Steam page, so cover art has to be guessed
 *   - "is it coming to PlayStation?", which Valve has no reason to know
 *
 * IGDB is a catalog rather than a shop, so it answers all three. It is free
 * and needs no card, but it authenticates through Twitch: a client id and
 * secret exchanged for a bearer token. Without both, every function here
 * answers null and the callers fall back to what they did before. Nothing
 * in this file is required for the app to work.
 *
 * Two deliberate omissions. The game `category` field and
 * `release_dates.category` are both mid-rename upstream (to `game_type` and
 * `date_format`), and IGDB rejects a whole query with a 400 if one field
 * name is wrong, so neither is requested here. Editions and DLC are
 * excluded with `parent_game` and `version_parent` instead, which is both
 * stable and more accurate, and release precision comes from
 * `release_dates.human`, which is already the string a reader wants to see
 * ("Q1 2027", "TBD") rather than an enum to translate.
 */

import { loadBlob, saveBlob } from './history.mjs';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API_URL = 'https://api.igdb.com/v4';
const TOKEN_KEY = 'igdb/token.json';

/** Refresh this far before expiry, so a token never dies mid-request. */
const TOKEN_MARGIN_MS = 24 * 60 * 60 * 1000;

/** IGDB allows four requests a second. Requests here are serialised anyway. */
const GAP_MS = 260;

const PLAYSTATION = { 167: 'PS5', 48: 'PS4', 9: 'PS3', 8: 'PS2', 7: 'PS1', 46: 'Vita', 38: 'PSP' };

/** Which fields a game row is asked for. Every one is long-standing. */
const GAME_FIELDS = [
  'name',
  'slug',
  'summary',
  'first_release_date',
  'url',
  'hypes',
  'rating',
  'rating_count',
  'aggregated_rating',
  'aggregated_rating_count',
  'cover.image_id',
  'genres.name',
  'themes.name',
  'keywords.name',
  'platforms.id',
  'platforms.abbreviation',
  'platforms.name',
  'release_dates.date',
  'release_dates.human',
  'release_dates.platform',
  'involved_companies.developer',
  'involved_companies.publisher',
  'involved_companies.company.name',
].join(',');

/** The credential pair, or null when either half is missing. */
export function igdbKeys(env = process.env) {
  const id = env.TWITCH_CLIENT_ID?.trim();
  const secret = env.TWITCH_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

/**
 * Cover art at a given size.
 *
 * IGDB serves one image under several named crops. `cover_big` is 264x374,
 * which is the shelf size, and `720p` is the modal size. Asking for a crop
 * that does not exist returns a 404 image, so the names are fixed here
 * rather than passed through from a caller.
 */
export const coverUrl = (imageId, size = 'cover_big') =>
  imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : null;

let memoToken = null;
let lastCall = 0;

/**
 * A bearer token, from memory, from the blob store, or from Twitch.
 *
 * Twitch issues these for about sixty days, and asking for a new one does
 * not invalidate the old, but a function instance that asked on every cold
 * start would still burn through the endpoint for no reason. So the token
 * is written to a blob and shared: the common case is a read, the rare case
 * is one POST every two months.
 */
async function token(keys) {
  const now = Date.now();
  if (memoToken && memoToken.expiresAt - now > TOKEN_MARGIN_MS) return memoToken.value;

  const stored = await loadBlob(TOKEN_KEY);
  if (stored?.value && stored.expiresAt - now > TOKEN_MARGIN_MS) {
    memoToken = { value: stored.value, expiresAt: stored.expiresAt };
    return stored.value;
  }

  const url = new URL(TOKEN_URL);
  url.searchParams.set('client_id', keys.id);
  url.searchParams.set('client_secret', keys.secret);
  url.searchParams.set('grant_type', 'client_credentials');

  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    // Twitch says why in plain words ("invalid client", "invalid client
    // secret"). Pass its text through rather than guessing: a wrong secret
    // and a disabled app look identical from here otherwise. The
    // credentials are never in this message.
    const text = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`twitch token http ${response.status}${text ? `: ${text}` : ''}`);
  }
  const body = await response.json();
  if (!body?.access_token) throw new Error('twitch token: no access_token in the reply');

  const expiresAt = now + (Number(body.expires_in) || 3600) * 1000;
  memoToken = { value: body.access_token, expiresAt };
  await saveBlob(TOKEN_KEY, { value: body.access_token, expiresAt });
  return body.access_token;
}

/**
 * One query, in IGDB's own query language.
 *
 * The body is plain text, not JSON: `fields name; where id = 7346;` and so
 * on. Throws with the API's own message, because a malformed query and an
 * expired token both come back as a 4xx and only the body tells them apart.
 */
async function ask(endpoint, query, keys, timeoutMs = 8000) {
  const wait = GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}/${endpoint}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Client-ID': keys.id,
        Authorization: `Bearer ${await token(keys)}`,
        Accept: 'application/json',
      },
      body: query,
    });
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`igdb ${endpoint} http ${response.status}${text ? `: ${text}` : ''}`);
    }
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } finally {
    clearTimeout(timer);
  }
}

/** Escape a search term for IGDB's quoted-string syntax. */
export const quote = (term) => `"${String(term ?? '').replace(/["\\]/g, '')}"`;

/**
 * A game row, flattened into the shape the rest of the app speaks.
 *
 * `platforms` is split in two deliberately. A reader asking after a PC game
 * wants to know one thing: is it on PlayStation. Answering that needs the
 * PlayStation platforms named separately from the other fifteen, so the
 * wording can be "PC only, no PlayStation release listed" rather than a
 * list the reader has to scan.
 */
export function normaliseGame(row) {
  if (!row?.name) return null;

  const platforms = Array.isArray(row.platforms) ? row.platforms : [];
  const playstation = platforms
    .filter((platform) => PLAYSTATION[platform?.id])
    .map((platform) => PLAYSTATION[platform.id]);

  const companies = Array.isArray(row.involved_companies) ? row.involved_companies : [];
  const pick = (role) => companies.find((entry) => entry?.[role])?.company?.name ?? null;

  const dates = Array.isArray(row.release_dates) ? row.release_dates : [];
  // The earliest dated release is the one to quote: a game out on PC in 2024
  // and dated "TBD" on PS5 is a 2024 game that has not come over yet, and
  // saying "TBD" flatly would be wrong.
  const dated = dates
    .filter((entry) => Number.isFinite(entry?.date))
    .sort((a, b) => a.date - b.date);
  const psDates = dates.filter((entry) => PLAYSTATION[entry?.platform]);

  const names = (list) =>
    (Array.isArray(list) ? list : []).map((entry) => entry?.name).filter(Boolean);

  return {
    id: row.id ?? null,
    name: row.name,
    slug: row.slug ?? null,
    summary: row.summary ?? null,
    released: dated[0]?.human ?? null,
    releasedAt: Number.isFinite(row.first_release_date)
      ? new Date(row.first_release_date * 1000).toISOString()
      : null,
    announced: dated.length === 0 && dates.length > 0,
    // What PlayStation owners actually asked. null means IGDB lists no
    // PlayStation release at all, which is a different answer from "TBD".
    playstation: playstation.length ? playstation : null,
    playstationWhen: psDates.find((entry) => entry?.human)?.human ?? null,
    platforms: platforms
      .map((platform) => platform?.abbreviation || platform?.name)
      .filter(Boolean),
    genres: names(row.genres).slice(0, 4),
    themes: names(row.themes),
    keywords: names(row.keywords).slice(0, 24),
    developer: pick('developer'),
    publisher: pick('publisher'),
    // Two scores, kept apart. aggregated_rating is the critic average and
    // rating is the IGDB user score; averaging them together would produce
    // a number that is nobody's opinion.
    critics: Number.isFinite(row.aggregated_rating) ? Math.round(row.aggregated_rating) : null,
    criticCount: row.aggregated_rating_count ?? 0,
    players: Number.isFinite(row.rating) ? Math.round(row.rating) : null,
    playerCount: row.rating_count ?? 0,
    hypes: row.hypes ?? 0,
    art: coverUrl(row.cover?.image_id),
    artLarge: coverUrl(row.cover?.image_id, '720p'),
    link: row.url ?? (row.slug ? `https://www.igdb.com/games/${row.slug}` : null),
  };
}

/**
 * Games matching a search term.
 *
 * `search` is IGDB's own relevance ranking, which is good, but the exact
 * title a reader typed still has to come first, so the sort is reapplied
 * here the same way the Steam path does it.
 *
 * Editions, DLC and expansions are excluded by their parents rather than by
 * type: a row with a `parent_game` is an add-on to something, and a row with
 * a `version_parent` is the Deluxe of something. Excluding both leaves games.
 */
export async function searchIgdb(term, { limit = 6, env = process.env } = {}) {
  const keys = igdbKeys(env);
  const query = String(term ?? '').trim();
  if (!keys || query.length < 2) return null;

  const rows = await ask(
    'games',
    `search ${quote(query)};
     fields ${GAME_FIELDS};
     where parent_game = null & version_parent = null;
     limit ${Math.min(Math.max(limit * 3, 10), 50)};`,
    keys,
  );

  const fold = (value) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  const wanted = fold(query);
  const rank = (name) => (fold(name) === wanted ? 0 : fold(name).startsWith(wanted) ? 1 : 2);

  return rows
    .map(normaliseGame)
    .filter(Boolean)
    .sort((a, b) => rank(a.name) - rank(b.name))
    .slice(0, limit);
}

/**
 * Announced PlayStation games, soonest first, including the undated ones.
 *
 * This is the half of Soon the store cannot show. A game announced for PS5
 * with no date has no store page to scan, so it exists here and nowhere
 * else in this app. `hypes` orders the undated ones, which is the only
 * honest ordering available for a pile of games that all say "TBD".
 */
export async function upcomingIgdb({ limit = 60, env = process.env, now = Date.now() } = {}) {
  const keys = igdbKeys(env);
  if (!keys) return null;

  const seconds = Math.floor(now / 1000);
  const platforms = Object.keys(PLAYSTATION).join(',');

  const rows = await ask(
    'games',
    `fields ${GAME_FIELDS};
     where platforms = (${platforms})
       & parent_game = null
       & version_parent = null
       & (first_release_date > ${seconds} | first_release_date = null)
       & hypes > 0;
     sort hypes desc;
     limit ${Math.min(limit, 500)};`,
    keys,
  );

  return rows.map(normaliseGame).filter(Boolean);
}

/**
 * The hand-written tags for a list of games, looked up by name.
 *
 * IGDB `themes` and `keywords` are editorial, not derived from genre, which
 * is the whole reason this is worth a request. This project already measured
 * genre-mapped moods and they made recommendations worse (1.82x to 1.36x),
 * because a genre is a shelf and a mood is not. A tag somebody chose by hand
 * is different data, not the same data relabelled.
 *
 * Returns a map of folded name to tags, so a caller can look up whatever it
 * has without matching ids first.
 */
export async function tagsFor(names, { env = process.env } = {}) {
  const keys = igdbKeys(env);
  const wanted = (Array.isArray(names) ? names : [])
    .map((name) => String(name ?? '').trim())
    .filter(Boolean);
  if (!keys || wanted.length === 0) return null;

  const out = new Map();
  const fold = (value) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

  // Ten names per request. `where name = ("a","b")` is an exact match, which
  // is what is wanted: a fuzzy search for forty names returns forty piles of
  // near misses, and a mood tag on the wrong game is worse than no tag.
  for (let start = 0; start < wanted.length; start += 10) {
    const batch = wanted.slice(start, start + 10);
    const rows = await ask(
      'games',
      `fields name,slug,themes.name,keywords.name,genres.name,cover.image_id;
       where name = (${batch.map(quote).join(',')});
       limit 50;`,
      keys,
    );
    for (const row of rows) {
      if (!row?.name) continue;
      const key = fold(row.name);
      if (out.has(key)) continue;
      out.set(key, {
        name: row.name,
        themes: (row.themes ?? []).map((theme) => theme?.name).filter(Boolean),
        keywords: (row.keywords ?? []).map((word) => word?.name).filter(Boolean),
        genres: (row.genres ?? []).map((genre) => genre?.name).filter(Boolean),
        art: coverUrl(row.cover?.image_id),
      });
    }
  }
  return out;
}

/**
 * Whether the credentials work, in one sentence, for /api/goss?debug=1.
 *
 * Shaped like the YouTube diagnostic next to it: the point is that a reader
 * of the debug output can tell "no key" from "key that does not work" from
 * "working", without reading a log. The failure text is the API's own.
 */
export async function igdbStatus(env = process.env) {
  const keys = igdbKeys(env);
  if (!keys) return 'none set, catalog-only answers';
  try {
    const rows = await ask('games', 'fields name; where id = 1942; limit 1;', keys);
    return rows.length
      ? `set, working (read back ${rows[0].name})`
      : 'set, but the probe read nothing';
  } catch (error) {
    return `set but not working: ${error.message}`;
  }
}
