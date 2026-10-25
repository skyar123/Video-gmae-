/**
 * Taste matching, once the pool is the whole store rather than the 306
 * hand-written games.
 *
 * Both of these only bite when a game arrives with fields missing, which is
 * every game in the mirror and none of the written-up ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProfile, recommend } from '../src/recommend.js';

const written = (over) => ({
  id: 'w1', title: 'Written Up', genre: 'Narrative', artStyle: 'Painterly',
  protagonist: 'Woman', tags: ['cozy'], representation: [], platform: 'PS5',
  ageRating: { family: 'mild' }, ratings: { critic: 90 }, ...over,
});
/** What storeRowAsGame produces: a genre and a rating, and nothing else. */
const fromStore = (over) => ({
  id: 's1', title: 'From The Store', genre: 'Narrative', artStyle: null,
  protagonist: null, tags: [], representation: [], platform: 'PS5',
  ageRating: null, ratings: null, stars: null, votes: null, ...over,
});

test('not knowing something never becomes a reason to recommend', () => {
  // Both of these have art and protagonist missing. If that counted as a
  // shared trait, they would match each other on it, and in a catalog that is
  // mostly store rows "we know nothing about either" would be the single
  // strongest signal in the profile.
  const owned = fromStore({ id: 'seed', genre: 'Strategy' });
  const profile = buildProfile([owned], new Set(['seed']), new Set());
  const picks = recommend([fromStore({ id: 'other', genre: 'Racing' })], profile, {
    exclude: new Set(),
  });
  assert.deepEqual(picks, [], 'a shared absence is not a match');
});

test('a real shared trait still matches', () => {
  const owned = fromStore({ id: 'seed', genre: 'Narrative' });
  const profile = buildProfile([owned], new Set(['seed']), new Set());
  const picks = recommend([fromStore({ id: 'other', genre: 'Narrative' })], profile, {
    exclude: new Set(),
  });
  assert.equal(picks.length, 1);
  assert.match(picks[0].reason, /narrative/i);
});

test('store games are ordered by their stars, not left in index order', () => {
  const seed = fromStore({ id: 'seed', genre: 'Narrative' });
  const profile = buildProfile([seed], new Set(['seed']), new Set());
  const picks = recommend(
    [
      fromStore({ id: 'meh', title: 'Thin', stars: 4.9, votes: 3 }),
      fromStore({ id: 'good', title: 'Loved', stars: 4.6, votes: 9000 }),
      fromStore({ id: 'none', title: 'Unrated' }),
    ],
    profile,
    { exclude: new Set() },
  );
  // Five stars from three people is not five stars: the one thousands of
  // players rated comes first.
  assert.equal(picks[0].game.title, 'Loved');
  assert.equal(picks.length, 3, 'the others still qualify, just lower');
});

test('a written-up game still outscores a store row on the same genre', () => {
  const seed = written({ id: 'seed' });
  const profile = buildProfile([seed], new Set(['seed']), new Set());
  const picks = recommend(
    [written({ id: 'rich' }), fromStore({ id: 'thin', stars: 5, votes: 100000 })],
    profile,
    { exclude: new Set() },
  );
  // Taste beats a high score: matching on cozy, art and lead counts for more
  // than a genre plus a lot of votes.
  assert.equal(picks[0].game.id, 'rich');
});
