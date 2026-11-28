/**
 * Joining a shop row to a catalogue entry, by name, carefully.
 *
 * The store publishes no identifier IGDB knows, so the join is the title and
 * the title alone. That is the same ground the news story matcher lost
 * itself on, filing The Wolf Among Us under Among Us, and it reached the
 * same conclusion this file starts from: a wrong join is worse than no join.
 *
 * A game with no IGDB data looks like what it is, a game nobody described.
 * A game with the wrong IGDB data is a confident lie that spreads, because
 * these fields would feed the searches, the shelves and the sentence under
 * every pick. So nearly every test here is about refusing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichmentOf, pickMatch, titleKeys } from '../api/igdb-match.mjs';

const at = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const PS5 = [{ id: 167 }];
const PS2 = [{ id: 8 }];
const XBOX = [{ id: 49 }];

test('a shop and a catalogue spell the same game differently', () => {
  /*
   * All three of these are real and none matches raw. The store bolts the
   * licensor on the front, sells the edition rather than the game, and tags
   * the platform in brackets.
   */
  assert.ok(titleKeys("Marvel's Spider-Man Remastered").has('spider man remastered'));
  assert.ok(titleKeys('God of War Ragnarök: Digital Deluxe Edition').has('god of war ragnarok'));
  assert.ok(titleKeys('Resident Evil 4 (PS5)').has('resident evil 4'));

  // And the unstripped spelling survives too, because stripping is not
  // always right: a game really called "Deluxe Paint" is still itself.
  assert.ok(titleKeys('Deluxe Paint').has('deluxe paint'));
});

test('one exact title is a match', () => {
  const hit = pickMatch({ name: "Marvel's Spider-Man Remastered" }, [
    { id: 1, name: 'Spider-Man Remastered' },
  ]);
  assert.equal(hit.game.id, 1);
});

test('a remake does not become its ancestor', () => {
  /*
   * The single most likely way to attach the wrong row. The store sells the
   * 2023 Resident Evil 4; IGDB holds the 2005 one under exactly that name.
   * Taking the first result, or the better-known one, gets this wrong.
   */
  const row = { name: 'Resident Evil 4 (PS5)', release: '2023-03-24' };
  const hit = pickMatch(row, [
    { id: 1, name: 'Resident Evil 4', first_release_date: at('2005-01-11'), platforms: PS2 },
    { id: 2, name: 'Resident Evil 4', first_release_date: at('2023-03-24'), platforms: PS5 },
  ]);
  assert.equal(hit.game.id, 2, 'matched the original instead of the remake');
  assert.match(hit.why, /year/);
});

test('a game on no PlayStation loses to one that is', () => {
  const hit = pickMatch({ name: 'Twinned' }, [
    { id: 1, name: 'Twinned', platforms: XBOX },
    { id: 2, name: 'Twinned', platforms: PS5 },
  ]);
  assert.equal(hit.game.id, 2);
  assert.match(hit.why, /platform/);
});

test('an unresolvable tie is left alone', () => {
  /*
   * Two games of one name, same console, same window. Nothing is left to
   * decide it, and picking either is the failure this file exists to stop.
   */
  const row = { name: 'Twin', release: '2021-02-02' };
  const tie = pickMatch(row, [
    { id: 1, name: 'Twin', first_release_date: at('2021-01-01'), platforms: PS5 },
    { id: 2, name: 'Twin', first_release_date: at('2021-06-01'), platforms: PS5 },
  ]);
  assert.equal(tie, null, 'guessed between two equally good candidates');
});

test('a near miss is not a match', () => {
  // No edit distance, no prefix, no "contains". The thing that went wrong
  // before was exactly this kind of near-enough.
  for (const name of ['Among Us', 'Spider', 'The Last of Us Part', 'Hades II']) {
    assert.equal(
      pickMatch({ name: 'Hades' }, [{ id: 1, name, platforms: PS5 }]),
      null,
      `matched "Hades" to "${name}"`,
    );
  }
  // And the other way round, which is the direction that bit the story
  // matcher: a long title must not be satisfied by a short candidate.
  assert.equal(pickMatch({ name: 'The Wolf Among Us' }, [{ id: 1, name: 'Among Us' }]), null);
});

test('nothing to match against is nothing, not a guess', () => {
  assert.equal(pickMatch({ name: 'Anything' }, []), null);
  assert.equal(pickMatch({ name: '' }, [{ id: 1, name: 'Anything' }]), null);
  assert.equal(pickMatch({}, [{ id: 1, name: 'Anything' }]), null);
  assert.equal(pickMatch(null, [{ id: 1, name: 'x' }]), null);
});

test('only labels are kept, and only when there are some', () => {
  const rich = enrichmentOf({
    id: 7,
    name: 'A Game',
    genres: [{ name: 'Platform' }, { name: 'Puzzle' }],
    themes: [{ name: 'Comedy' }],
    keywords: [{ name: 'pixel art' }],
    summary: 'Something a machine should not be repeating.',
    rating: 92,
  });
  assert.deepEqual(rich.genres, ['Platform', 'Puzzle']);
  assert.deepEqual(rich.themes, ['Comedy']);
  assert.deepEqual(rich.keywords, ['pixel art']);
  // A store row has its own star rating and does not need a second opinion,
  // and no summary text is carried over.
  assert.equal(rich.rating, undefined);
  assert.equal(rich.summary, undefined);

  // A game IGDB has but has not described teaches nothing.
  assert.equal(enrichmentOf({ id: 8, name: 'Bare' }), null);
  assert.equal(enrichmentOf(null), null);
});

test('the long tail of keywords is capped', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ name: `kw-${i}` }));
  const out = enrichmentOf({ id: 9, genres: [{ name: 'Puzzle' }], keywords: many });
  assert.ok(out.keywords.length <= 24, `kept ${out.keywords.length} keywords`);
});

test('it reads a normalised row as well as a raw one', async () => {
  /*
   * Two shapes legitimately reach this. IGDB's raw rows carry numeric
   * platform ids and epoch seconds; normaliseGame has already turned those
   * into abbreviations and an ISO string and dropped the ids.
   *
   * Reading only the raw shape would not have thrown. It would have quietly
   * believed every normalised candidate was off-console with an unknown
   * date, which in this file means falling back to a guess.
   */
  const { normaliseGame } = await import('../api/igdb.mjs');
  const normalised = normaliseGame({
    id: 2,
    name: 'Resident Evil 4',
    first_release_date: at('2023-03-24'),
    platforms: [{ id: 167, abbreviation: 'PS5' }],
  });
  const old = normaliseGame({
    id: 1,
    name: 'Resident Evil 4',
    first_release_date: at('2005-01-11'),
    platforms: [{ id: 8, abbreviation: 'PS2' }],
  });

  assert.equal(normalised.playstation?.length, 1, 'fixture is not a PlayStation game');
  const hit = pickMatch({ name: 'Resident Evil 4 (PS5)', release: '2023-03-24' }, [old, normalised]);
  assert.equal(hit?.game.id, 2, 'picked the wrong one from normalised rows');
});
