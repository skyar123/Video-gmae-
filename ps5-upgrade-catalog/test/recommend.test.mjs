/**
 * The ranking shown before anybody has rated anything.
 *
 * This file used to test a trait-matching recommender that genius.js
 * replaced. Those tests passed for a while after nothing in the app called
 * the functions any more, which is worse than having none: a green suite
 * reporting on code no reader can reach. What is tested here now is the one
 * piece that outlived it, and it is reached on the first run of the app by
 * everybody.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { starterPicks } from '../src/recommend.js';

const rated = (over) => ({
  id: 'a',
  title: 'A',
  genre: 'Narrative',
  platform: 'PS4',
  ratings: { critic: 90, user: { percentPositive: 90, total: 5000 } },
  ...over,
});

/** What storeRowAsGame produces: a genre and the store's stars, nothing else. */
const fromStore = (over) => ({
  id: 's1',
  title: 'From The Store',
  genre: 'Narrative',
  platform: 'PS4',
  ratings: null,
  stars: 4,
  votes: 800,
  ...over,
});

test('a game nobody has scored is not offered as highly rated', () => {
  const picks = starterPicks([rated(), { id: 'b', title: 'B', genre: 'RPG', platform: 'PS4' }], {
    exclude: new Set(),
    limit: 10,
  });
  assert.deepEqual(picks.map((pick) => pick.game.id), ['a']);
});

test('anything ruled out stays out', () => {
  const picks = starterPicks([rated({ id: 'keep' }), rated({ id: 'drop' })], {
    exclude: new Set(['drop']),
    limit: 10,
  });
  assert.ok(!picks.some((pick) => pick.game.id === 'drop'));
});

test('the better reviewed game comes first', () => {
  const picks = starterPicks(
    [
      rated({ id: 'weak', ratings: { critic: 55, user: { percentPositive: 50, total: 5000 } } }),
      rated({ id: 'strong', ratings: { critic: 95, user: { percentPositive: 95, total: 5000 } } }),
    ],
    { exclude: new Set(), limit: 10 },
  );
  assert.equal(picks[0].game.id, 'strong');
});

test('five stars from four people is not five stars', () => {
  // Without the vote weighting every store row scored a flat 0.95 and the
  // thousands sharing a genre came back in whatever order the index held
  // them, which is no order at all.
  const picks = starterPicks(
    [
      fromStore({ id: 'thin', stars: 5, votes: 3 }),
      fromStore({ id: 'solid', stars: 4, votes: 4000 }),
    ],
    { exclude: new Set(), limit: 10 },
  );
  assert.equal(picks[0].game.id, 'solid');
});

test('the top of the list is not one genre five times over', () => {
  const catalog = [
    ...Array.from({ length: 5 }, (_, i) =>
      rated({ id: `n${i}`, genre: 'Narrative', ratings: { critic: 95 - i } }),
    ),
    rated({ id: 'odd', genre: 'Racing', ratings: { critic: 80 } }),
  ];
  const picks = starterPicks(catalog, { exclude: new Set(), limit: 3 });
  const genres = new Set(picks.map((pick) => pick.game.genre));
  assert.ok(genres.size > 1, `all ${picks.length} picks were ${[...genres]}`);
});

test('the reason does not pretend to a match it does not have', () => {
  const [pick] = starterPicks([rated()], { exclude: new Set(), limit: 1 });
  assert.match(pick.reason, /Highly rated/);
  assert.equal(pick.matched, 0, 'nothing was matched, and it says so');
});

test('asking for more than there is returns what there is', () => {
  const picks = starterPicks([rated()], { exclude: new Set(), limit: 40 });
  assert.equal(picks.length, 1);
});
