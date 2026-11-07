/**
 * Reading IGDB's answer, and surviving its absence.
 *
 * The fixture is a hand-built row in IGDB's documented shape rather than a
 * live capture, because the credentials to capture one are not in this repo.
 * That limit is worth being plain about: these tests prove the parser does
 * the right thing with the shape, not that the shape is what arrives. The
 * live round trip is what igdbStatus() is for, and the first thing to run
 * once a key exists.
 *
 * What is tested here is every decision the parser makes on its own, and
 * every one of them came from a real question about this app:
 *
 *   - "is it on PlayStation?" has three answers, not two: yes, dated; yes,
 *     undated; and no PlayStation release listed at all. Collapsing the last
 *     two into "TBD" would tell a reader a game is coming when nobody said so
 *   - a game out on PC and undated on PS5 is not a TBD game, it is a 2024
 *     game that has not come over, so the earliest dated release is quoted
 *   - critic scores and player scores are two different opinions and must not
 *     be averaged into a third that is nobody's
 *   - with no credentials every entry point answers null, and null is what
 *     the callers already fall back from
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverUrl,
  igdbKeys,
  normaliseGame,
  quote,
  searchIgdb,
  tagsFor,
  upcomingIgdb,
} from '../api/igdb.mjs';

/** A PC game with a dated PC release and an announced, undated PS5 one. */
const crossing = {
  id: 7346,
  name: 'Hollow Knight: Silksong',
  slug: 'hollow-knight-silksong',
  summary: 'A sequel.',
  first_release_date: 1756684800,
  url: 'https://www.igdb.com/games/hollow-knight-silksong',
  hypes: 412,
  rating: 91.4,
  rating_count: 820,
  aggregated_rating: 88.6,
  aggregated_rating_count: 41,
  cover: { id: 99, image_id: 'co5xyz' },
  genres: [{ name: 'Platform' }, { name: 'Adventure' }],
  themes: [{ name: 'Action' }, { name: 'Fantasy' }],
  keywords: [{ name: 'metroidvania' }, { name: 'insects' }],
  platforms: [
    { id: 6, abbreviation: 'PC', name: 'PC (Microsoft Windows)' },
    { id: 167, abbreviation: 'PS5', name: 'PlayStation 5' },
  ],
  release_dates: [
    { date: 1756684800, human: 'Sep 04, 2025', platform: 6 },
    { human: 'TBD', platform: 167 },
  ],
  involved_companies: [
    { developer: true, publisher: false, company: { name: 'Team Cherry' } },
    { developer: false, publisher: true, company: { name: 'Team Cherry' } },
  ],
};

/** A PC-only game: no PlayStation platform at all. */
const pcOnly = {
  id: 11,
  name: 'Dwarf Fortress',
  platforms: [{ id: 6, abbreviation: 'PC', name: 'PC (Microsoft Windows)' }],
  release_dates: [{ date: 1670371200, human: 'Dec 06, 2022', platform: 6 }],
};

/** Announced for PS5 and dated nowhere. */
const unannouncedDate = {
  id: 12,
  name: 'Some Sequel',
  hypes: 300,
  platforms: [{ id: 167, abbreviation: 'PS5', name: 'PlayStation 5' }],
  release_dates: [{ human: 'Q1 2027', platform: 167 }],
};

/** Dated on PS5 first in the list, but out on PC two years earlier. */
const psListedFirst = {
  id: 19,
  name: 'Late Port',
  platforms: [
    { id: 167, abbreviation: 'PS5', name: 'PlayStation 5' },
    { id: 6, abbreviation: 'PC', name: 'PC (Microsoft Windows)' },
  ],
  release_dates: [
    { date: 1767225600, human: 'Jan 01, 2026', platform: 167 },
    { date: 1704067200, human: 'Jan 01, 2024', platform: 6 },
  ],
};

test('"is it on PlayStation" keeps its three separate answers', () => {
  const crossed = normaliseGame(crossing);
  assert.deepEqual(crossed.playstation, ['PS5']);
  assert.equal(crossed.playstationWhen, 'TBD');

  const pc = normaliseGame(pcOnly);
  // null, not []. A reader is owed "no PlayStation release listed", which is
  // a fact, instead of a hedge about one that might exist.
  assert.equal(pc.playstation, null);
  assert.equal(pc.playstationWhen, null);

  const soon = normaliseGame(unannouncedDate);
  assert.deepEqual(soon.playstation, ['PS5']);
  assert.equal(soon.playstationWhen, 'Q1 2027');
});

test('two dated releases are ordered, not taken as listed', () => {
  // IGDB returns release_dates in no guaranteed order, so a 2024 PC game
  // ported to PS5 in 2026 can arrive PS5-first and read as a 2026 game.
  // "When did this come out" has one right answer and it is the first one.
  const row = normaliseGame(psListedFirst);
  assert.equal(row.released, 'Jan 01, 2024');
  assert.notEqual(row.released, 'Jan 01, 2026');
  // And the PlayStation answer is still its own date, not the earliest.
  assert.equal(row.playstationWhen, 'Jan 01, 2026');
});

test('the earliest dated release is the one quoted, not the undated one', () => {
  // The bug this prevents: Silksong has been out on PC since 2025 and says
  // TBD on PS5. Reading release_dates in order given would call it a TBD
  // game and bury the thing a reader most wants, which is that it exists.
  const row = normaliseGame(crossing);
  assert.equal(row.released, 'Sep 04, 2025');
  assert.equal(row.announced, false);

  // Only when nothing at all is dated is it an announcement.
  assert.equal(normaliseGame(unannouncedDate).announced, true);
  assert.equal(normaliseGame(unannouncedDate).released, null);
});

test('a game with no release_dates at all is not called announced', () => {
  // announced means "somebody said it is coming". An empty list means IGDB
  // has no dates on file, which is not the same claim.
  const row = normaliseGame({ id: 13, name: 'Nothing Known', platforms: [] });
  assert.equal(row.announced, false);
  assert.equal(row.released, null);
});

test('critic and player scores stay two numbers', () => {
  const row = normaliseGame(crossing);
  assert.equal(row.critics, 89);
  assert.equal(row.criticCount, 41);
  assert.equal(row.players, 91);
  assert.equal(row.playerCount, 820);
  // 88.6 and 91.4 average to 90, which is neither score. Nothing reports 90.
  assert.notEqual(row.critics, 90);
  assert.notEqual(row.players, 90);
});

test('a missing score is absent, not zero', () => {
  // Zero is a review score. "Nobody has reviewed it" is not, and an unrated
  // game sorted as a 0 lands below every bad game in the catalog.
  const row = normaliseGame({ id: 14, name: 'Unreviewed' });
  assert.equal(row.critics, null);
  assert.equal(row.players, null);
  assert.equal(row.criticCount, 0);
});

test('developer and publisher come from their own flags', () => {
  const row = normaliseGame(crossing);
  assert.equal(row.developer, 'Team Cherry');
  assert.equal(row.publisher, 'Team Cherry');

  // The flags are what name the role. Taking the first company in the list
  // would credit a publisher as the developer about half the time.
  const published = normaliseGame({
    id: 15,
    name: 'Published Thing',
    involved_companies: [
      { developer: false, publisher: true, company: { name: 'Big Publisher' } },
      { developer: true, publisher: false, company: { name: 'Small Studio' } },
    ],
  });
  assert.equal(published.developer, 'Small Studio');
  assert.equal(published.publisher, 'Big Publisher');
});

test('cover art is a real URL at a real crop, or null', () => {
  assert.equal(
    coverUrl('co5xyz'),
    'https://images.igdb.com/igdb/image/upload/t_cover_big/co5xyz.jpg',
  );
  assert.equal(
    coverUrl('co5xyz', '720p'),
    'https://images.igdb.com/igdb/image/upload/t_720p/co5xyz.jpg',
  );
  assert.equal(coverUrl(null), null);
  assert.equal(coverUrl(undefined), null);
  // No cover must not become a URL ending in "null.jpg", which loads a 404
  // image and looks to a reader exactly like broken art.
  assert.equal(normaliseGame({ id: 16, name: 'Artless' }).art, null);
});

test('a search term cannot break out of its quotes', () => {
  assert.equal(quote('Uncharted'), '"Uncharted"');
  assert.equal(quote('say "what"'), '"say what"');
  assert.equal(quote('back\\slash'), '"backslash"');
  // The query language is plain text, so an unescaped quote would not error,
  // it would silently change which games came back.
  assert.ok(!quote('"; where id = 1; //').slice(1, -1).includes('"'));
});

test('a row with no name is dropped, not half-parsed', () => {
  assert.equal(normaliseGame({ id: 17 }), null);
  assert.equal(normaliseGame(null), null);
  assert.equal(normaliseGame({}), null);
});

test('garbage in the shapes that should be arrays does not throw', () => {
  // Every list field is defended individually because IGDB omits empty
  // ones entirely rather than sending [], and one missing field taking the
  // whole search down with it is the failure that matters.
  const row = normaliseGame({
    id: 18,
    name: 'Odd Row',
    platforms: 'not an array',
    genres: null,
    themes: undefined,
    release_dates: { date: 1 },
    involved_companies: 7,
  });
  assert.equal(row.name, 'Odd Row');
  assert.deepEqual(row.platforms, []);
  assert.deepEqual(row.genres, []);
  assert.equal(row.developer, null);
  assert.equal(row.released, null);
});

test('with no credentials, every entry point answers null', async () => {
  const none = {};
  assert.equal(igdbKeys(none), null);
  assert.equal(await searchIgdb('anything', { env: none }), null);
  assert.equal(await upcomingIgdb({ env: none }), null);
  assert.equal(await tagsFor(['Bloodborne'], { env: none }), null);
});

test('half a credential is no credential', async () => {
  // A half-configured key that threw at request time would take the search
  // bar down with it. It has to read as "not configured".
  assert.equal(igdbKeys({ TWITCH_CLIENT_ID: 'abc' }), null);
  assert.equal(igdbKeys({ TWITCH_CLIENT_SECRET: 'xyz' }), null);
  assert.equal(igdbKeys({ TWITCH_CLIENT_ID: '   ', TWITCH_CLIENT_SECRET: 'xyz' }), null);
  assert.equal(await searchIgdb('anything', { env: { TWITCH_CLIENT_ID: 'abc' } }), null);
});

test('a credential pair is read and trimmed', () => {
  assert.deepEqual(igdbKeys({ TWITCH_CLIENT_ID: ' abc ', TWITCH_CLIENT_SECRET: ' xyz ' }), {
    id: 'abc',
    secret: 'xyz',
  });
});

test('a too-short search asks nothing, even with credentials', async () => {
  // Guard before the network, not after: a one-letter search with a key
  // configured would otherwise spend a request to be told nothing.
  const env = { TWITCH_CLIENT_ID: 'abc', TWITCH_CLIENT_SECRET: 'xyz' };
  assert.equal(await searchIgdb('a', { env }), null);
  assert.equal(await searchIgdb('', { env }), null);
  assert.equal(await searchIgdb('   ', { env }), null);
  assert.equal(await tagsFor([], { env }), null);
});
