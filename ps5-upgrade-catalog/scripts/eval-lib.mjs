/**
 * The shared machinery behind scripts/eval-genius.mjs: the holdout splits,
 * the popularity-matched distractor pools, and the two metrics.
 *
 * The ratings it will run on live in localStorage on a phone, so they cannot
 * be read from here. But the 506 hand-written entries are themselves a long
 * statement of taste: somebody picked those games out of 9,222 and wrote a
 * paragraph on each. So the test is holdout. Train on three quarters of them,
 * hide the rest among games from the mirror, and see how far up the list the
 * hidden ones come.
 *
 * Getting this measurement wrong is easy, and two traps are worth naming
 * because the first numbers this harness produced fell into both.
 *
 * The first is the fields. Every hand-written entry has a genre, an art
 * style, a lead and tags; no game in the mirror has any of them. Score across
 * all fields and the model scores well by learning "this one is
 * hand-written", which is not a thing it can know about a game nobody has
 * written up. Reported that way the lift was 4.7x. So the transfer test uses
 * only fields the mirror can also have, and only write-ups that joined a
 * mirror row, which leaves a hidden game indistinguishable from a distractor
 * except by fit.
 *
 * The second is popularity. Hand-written games are famous games. Matching
 * distractors on star rating is not enough, because review count still gives
 * the hidden games away, and any feature that correlates with being famous
 * then looks like insight: on star-matched pools "is it on PS Plus" alone
 * scored 2.8x, which is notability, not taste. Distractors are matched on
 * rating and on review count together.
 *
 * What is left is a modest, real effect: about 1.5x a popularity ranking.
 *
 * Two more honest limits. The catalog was built to cover ground as well as to
 * record enthusiasm, so it is a blunt proxy for one person's taste. And there
 * are no recorded dislikes anywhere in this data, so the half of the model
 * that learns from them is not measured here at all.
 *
 *   node scripts/eval-genius.mjs
 */
import { readFileSync } from 'node:fs';
import {
  buildTaste,
  scoreGame,
  qualityPrior,
  unify,
  SHARED_NAMESPACES,
} from '../src/genius.js';

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));
const curated = read('../src/games.json');
const games = unify(curated, read('../api/store-index.json'));

const curatedTitles = new Set(curated.map((entry) => entry.title));
/** Write-ups that joined a mirror row, so they carry the mirror's fields too. */
const joined = games.filter((game) => curatedTitles.has(game.title) && game.storeId != null);
const mirror = games.filter((game) => game.fromStore);

/** Seeded, so a run is comparable with the one before it. */
function rng(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const shuffled = (items, random) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** Review counts span four orders of magnitude, so they are compared by band. */
const voteBand = (votes) => {
  const n = votes ?? 0;
  if (n < 10) return 0;
  if (n < 50) return 1;
  if (n < 200) return 2;
  if (n < 1000) return 3;
  if (n < 5000) return 4;
  return 5;
};

const popularityKey = (game) => `${Math.round(game.stars)}:${voteBand(game.votes)}`;

const pools = new Map();
for (const game of mirror) {
  if (game.stars == null) continue;
  const key = popularityKey(game);
  if (!pools.has(key)) pools.set(key, []);
  pools.get(key).push(game);
}

const PER_POSITIVE = 20;

/** Distractors as famous and as well reviewed as the game they hide. */
function distractorsFor(heldOut, random) {
  const picked = [];
  const used = new Set();
  for (const target of heldOut) {
    const candidates = pools.get(popularityKey(target)) ?? [];
    let taken = 0;
    for (let guard = 0; guard < 2000 && taken < PER_POSITIVE; guard += 1) {
      const pick = candidates[Math.floor(random() * candidates.length)];
      if (!pick || used.has(pick.id)) continue;
      used.add(pick.id);
      picked.push(pick);
      taken += 1;
    }
  }
  return picked;
}

const splits = new Map();
function splitFor(seed) {
  if (splits.has(seed)) return splits.get(seed);
  const random = rng(seed);
  const order = shuffled(joined, random);
  const cut = Math.floor(order.length * 0.25);
  const heldOut = order.slice(0, cut);
  const split = {
    heldOut,
    ids: new Set(heldOut.map((game) => game.id)),
    signals: order.slice(cut).map((game) => ({ game, kind: 'owned' })),
    pool: [...heldOut, ...distractorsFor(heldOut, random)],
  };
  splits.set(seed, split);
  return split;
}

const recallAt = (ranked, ids, n) =>
  ranked.slice(0, n).filter((game) => ids.has(game.id)).length / ids.size;

function modelRecall(seed, { only = SHARED_NAMESPACES, n = 50, tuning } = {}) {
  const { signals, ids, pool } = splitFor(seed);
  const taste = buildTaste(signals, only);
  const ranked = pool
    .map((game) => ({ game, score: scoreGame(game, taste, tuning).score }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.game);
  return recallAt(ranked, ids, n);
}

function popularityRecall(seed, n = 50) {
  const { ids, pool } = splitFor(seed);
  const ranked = [...pool].sort((a, b) => qualityPrior(b) - qualityPrior(a));
  return recallAt(ranked, ids, n);
}


export const CHOOSING = [7, 13, 29];
export const REPORTING = [101, 211, 307, 409, 503, 601, 719];
export const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
export { modelRecall, popularityRecall, splitFor, joined, mirror, games, curatedTitles };
