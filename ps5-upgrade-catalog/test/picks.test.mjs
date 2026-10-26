import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePicksRequest, pickFromMirror } from '../api/picks.mjs';
import { buildTaste, packTaste, explain, hasDistinctiveReason } from '../src/genius.js';

const profile = () =>
  packTaste(
    buildTaste([
      {
        game: {
          id: 1,
          name: 'A',
          genres: ['Action'],
          release: '2022-01-01T00:00:00Z',
          ageRating: { family: 'mild', tier: 'teen' },
        },
        kind: 'liked',
      },
    ]),
  );

test('a body that is not a profile is refused rather than ranked', () => {
  for (const body of [null, 'nope', 42, {}, { taste: {} }, { taste: { weights: [] } }]) {
    assert.ok(parsePicksRequest(body).error, `should refuse ${JSON.stringify(body)}`);
  }
});

test('an oversized profile is refused', () => {
  const weights = Object.fromEntries(Array.from({ length: 4_001 }, (_, i) => [`x:${i}`, 0.1]));
  assert.match(parsePicksRequest({ taste: { weights } }).error, /over the 4000 limit/);
});

test('the limit is clamped rather than trusted', () => {
  const taste = { weights: { 'sgenre:Action': 0.5 } };
  assert.equal(parsePicksRequest({ taste, limit: 9_999 }).limit, 60);
  assert.equal(parsePicksRequest({ taste, limit: -5 }).limit, 1);
  assert.equal(parsePicksRequest({ taste, limit: 'lots' }).limit, 24);
});

test('ids are compared as strings, since the two halves number games differently', () => {
  const parsed = parsePicksRequest({
    taste: { weights: { 'sgenre:Action': 0.5 } },
    exclude: [123, 'outer-wilds'],
  });
  assert.ok(parsed.exclude.has('123'));
  assert.ok(parsed.exclude.has('outer-wilds'));
});

test('titles are excluded too, because the same game has two ids', () => {
  // A write-up is ruled out by its slug; the mirror files that game under a
  // number and a longer name, so the slug alone never reaches it. This is
  // what put Spiritfarer at the top of the picks for somebody who had just
  // said they liked Spiritfarer.
  const parsed = parsePicksRequest({
    taste: { weights: { 'sgenre:Action': 0.5 } },
    excludeTitles: ['Spiritfarer'],
  });
  assert.ok(parsed.excludeTitles.has('spiritfarer'));
});

test('a profile with no weights returns nothing rather than a popularity list', async () => {
  const result = await pickFromMirror({ taste: { weights: {} } });
  assert.deepEqual(result.games, []);
});

test('picks come back ranked, explained, and without the search index', async () => {
  const result = await pickFromMirror({ taste: profile(), limit: 5 });
  assert.equal(result.games.length, 5);
  assert.ok(result.total > 1000, 'the whole mirror is ranked');
  for (const game of result.games) {
    assert.equal(game.search, undefined, 'the search text is an index detail');
    assert.ok(typeof game.reason === 'string' && game.reason.length > 0);
    assert.equal(typeof game.distinctive, 'boolean');
  }
  /*
   * Not "best first" all the way down, which is what this used to assert.
   * The list is re-ranked for variety after scoring, so a slightly weaker
   * game that is unlike everything above it is meant to outrank a stronger
   * one that is the fourth of its kind. Demanding descending scores demands
   * the re-rank does nothing, and the assertion passed for a while only
   * because the top few happened to come out in that order anyway.
   *
   * What does hold: the first pick is chosen before anything can be penalised
   * for resembling what came before it, so it is the highest scoring.
   */
  const scores = result.games.map((game) => game.pickScore);
  assert.equal(scores[0], Math.max(...scores), 'the first pick is the best one');
  assert.ok(
    scores.every((score) => score > 0),
    'a game is never offered on a negative score',
  );
});

test('an excluded title does not come back', async () => {
  const first = await pickFromMirror({ taste: profile(), limit: 3 });
  const [top] = first.games;
  const second = await pickFromMirror({
    taste: profile(),
    limit: 3,
    excludeTitles: [top.name],
  });
  assert.ok(!second.games.some((game) => game.name === top.name));
});

test('an age rating is not dressed up as taste', () => {
  // Six picks in a row once all claimed to have been chosen for being games
  // with a light touch, which is true of a third of the catalog.
  const weak = [
    { feature: 'family:mild', weight: 0.9 },
    { feature: 'tier:teen', weight: 0.8 },
    { feature: 'era:2020s', weight: 0.7 },
  ];
  assert.equal(hasDistinctiveReason(weak), false);
  assert.match(explain(weak), /close to what you have been picking/);

  const real = [...weak, { feature: 'tag:cozy', weight: 0.2 }];
  assert.equal(hasDistinctiveReason(real), true);
  assert.match(explain(real), /cozy games/);
});

test('a distinctive reason leads even when a coarse one scored higher', () => {
  const hits = [
    { feature: 'tier:teen', weight: 0.9 },
    { feature: 'genre:Metroidvania', weight: 0.5 },
  ];
  assert.match(explain(hits), /^Because you go for Metroidvania games/);
});
