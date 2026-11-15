/**
 * What you played, as opposed to what you bought.
 *
 * The model knew four things about a reader: thumbs, owning, wanting and
 * hiding. Three of those are a glance and one is a purchase, so the single
 * most informative thing a person does with a game, which is play it to the
 * end or put it down after an hour, was not recorded anywhere.
 *
 * The weights here are reasoned rather than measured, which is unusual in
 * this file and deliberate: the holdout harness has no record of anybody
 * playing anything, so there is nothing to fit them against. These tests
 * pin the ordering that the reasoning produced, and pin the one thing that
 * can be verified absolutely: that a profile with no play states ranks
 * exactly as it did before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaste, geniusPicks, SIGNAL_WEIGHTS } from '../src/genius.js';

const game = (id, extra = {}) => ({
  id,
  title: id,
  genre: 'Metroidvania',
  tags: [],
  criticScore: 85,
  playerScore: 90,
  ...extra,
});

test('playing a game says more than buying it, and finishing more again', () => {
  /*
   * The ordering is the claim. A shelf records what was bought; starting a
   * game is a choice made after buying it, and finishing one is twenty hours
   * of agreeing with that choice.
   */
  assert.ok(SIGNAL_WEIGHTS.finished > SIGNAL_WEIGHTS.playing);
  assert.ok(SIGNAL_WEIGHTS.playing > SIGNAL_WEIGHTS.owned);
  assert.ok(SIGNAL_WEIGHTS.owned > SIGNAL_WEIGHTS.wishlisted);

  // But a thumbs up still wins, because it is the one signal that means
  // exactly what it says.
  assert.ok(SIGNAL_WEIGHTS.liked > SIGNAL_WEIGHTS.finished);
});

test('giving up is a real no, and a softer one than a thumbs down', () => {
  /*
   * People put down games they would recommend. Too long, too hard, or life
   * happened at chapter three. A thumbs down has no such excuse.
   */
  assert.ok(SIGNAL_WEIGHTS.bounced < 0);
  assert.ok(SIGNAL_WEIGHTS.bounced > SIGNAL_WEIGHTS.disliked);
  // And well clear of hiding, which costs a glance rather than an evening.
  assert.ok(SIGNAL_WEIGHTS.bounced < SIGNAL_WEIGHTS.hidden);
});

test('a profile with no play states ranks exactly as it did before', () => {
  /*
   * The one thing here that can be checked rather than argued. Adding
   * signal kinds must not move a single existing profile, or every measured
   * number in this project quietly stops being about the thing it measured.
   */
  const signals = [
    { game: game('a', { tags: ['cozy'] }), kind: 'liked' },
    { game: game('b', { genre: 'Platformer' }), kind: 'owned' },
    { game: game('c'), kind: 'wishlisted' },
    { game: game('d', { genre: 'Shooter' }), kind: 'disliked' },
  ];
  const taste = buildTaste(signals);

  /*
   * By hand, so the arithmetic is the test rather than a restatement of the
   * code. Metroidvania is carried by the liked game and the wanted one, so
   * its score is 1 + 0.6 over that same mass plus the smoothing constant.
   * An earlier version of this asserted 1/3.5 for it and was simply wrong
   * about which games shared the genre.
   */
  assert.equal(taste.weights.get('genre:Metroidvania'), 1.6 / (1.6 + 2.5));
  assert.equal(taste.weights.get('tag:cozy'), 1 / (1 + 2.5));
  // Three, not two: liked, owned and wanted all count as something positive
  // having been said. Only the thumbs-down does not.
  assert.equal(taste.positives, 3);

  // And the five that existed before keep their exact values, which is what
  // makes every measured number in this project still about what it measured.
  assert.equal(SIGNAL_WEIGHTS.liked, 1);
  assert.equal(SIGNAL_WEIGHTS.owned, 0.8);
  assert.equal(SIGNAL_WEIGHTS.wishlisted, 0.6);
  assert.equal(SIGNAL_WEIGHTS.disliked, -1);
  assert.equal(SIGNAL_WEIGHTS.hidden, -0.45);
});

test('finishing a game teaches what liking one teaches, very nearly', () => {
  const finished = buildTaste([{ game: game('a', { tags: ['cozy'] }), kind: 'finished' }]);
  const liked = buildTaste([{ game: game('a', { tags: ['cozy'] }), kind: 'liked' }]);
  const owned = buildTaste([{ game: game('a', { tags: ['cozy'] }), kind: 'owned' }]);

  const f = finished.weights.get('tag:cozy');
  assert.ok(f > owned.weights.get('tag:cozy'), 'finishing taught less than owning');
  assert.ok(f < liked.weights.get('tag:cozy'), 'finishing outvoted a thumbs up');
  assert.equal(finished.positives, 1, 'finishing a game is a positive');
});

test('a game you finished is never suggested back to you', () => {
  /*
   * The clearest possible sign the app is not paying attention. Exclusion
   * is handled by the signal itself rather than by the caller remembering
   * to pass an id, which is the mistake that once had the model
   * recommending Celeste to somebody who owned Celeste.
   */
  const pool = [game('played'), game('fresh'), game('also-fresh')];
  const { picks } = geniusPicks(pool, [{ game: game('played'), kind: 'finished' }]);
  assert.ok(picks.length > 0, 'finishing one game emptied the list');
  assert.ok(!picks.some((p) => p.game.id === 'played'), 'suggested a game already finished');

  // Same for one put down: you have seen it and decided.
  const bounced = geniusPicks(pool, [
    { game: game('played'), kind: 'bounced' },
    { game: game('fresh'), kind: 'liked' },
  ]);
  assert.ok(!bounced.picks.some((p) => p.game.id === 'played'));
});

test('giving up on a kind of game moves that kind down, not off', () => {
  const pool = [];
  for (let i = 0; i < 6; i += 1) pool.push(game(`metro-${i}`));
  for (let i = 0; i < 6; i += 1) pool.push(game(`cozy-${i}`, { genre: 'Life Sim', tags: ['cozy'] }));

  const { picks } = geniusPicks(pool, [
    { game: game('seed', { genre: 'Life Sim', tags: ['cozy'] }), kind: 'liked' },
    { game: game('quit'), kind: 'bounced' },
  ]);
  /*
   * The top half leans the way the evidence does, rather than being swept
   * clean. An earlier version of this demanded the first four picks all be
   * Life Sim, which fights the diversity pass on purpose: a list of four of
   * the same game is the thing that pass exists to prevent, so the test was
   * asserting against a deliberate feature and would have passed only if
   * variety were broken.
   */
  const top = picks.slice(0, 6).map((p) => p.game.genre);
  const liked = top.filter((g) => g === 'Life Sim').length;
  assert.ok(liked > top.length - liked, `top picks were ${top.join(', ')}`);
  assert.equal(picks[0].game.genre, 'Life Sim', 'the first pick ignored the evidence');
  // Not banished either: one put-down game is not a verdict on a whole genre.
  assert.ok(picks.some((p) => p.game.genre === 'Metroidvania'), 'a genre vanished from one bounce');
});
