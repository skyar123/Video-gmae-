/**
 * Does the model actually know this person's taste?
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
 * One idea was tried here and rejected, which is worth writing down so it is
 * not thought of again as though it were new. The write-ups and the mirror
 * share no vocabulary, so the obvious move is to learn a translation from the
 * 398 games carrying both: work out which store genres tend to accompany
 * "cozy" or "Metroidvania", and let a taste for the one induce a taste for
 * the other. Measured across seven splits it made things worse at every
 * strength worth using, 1.82x falling to 1.36x and the worst split from 1.44x
 * to 0.70x. The reason is visible in what it learns: cozy maps to an everyone
 * rating, Metroidvania maps to Action. The translations are real and they are
 * useless, because they land on the coarse fields the model already reads.
 * Store-side picks are limited by how little the mirror records, and no
 * rearrangement of the existing fields escapes that.
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
  geniusPicks,
  featuresOf,
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

/**
 * Splits used for choosing are kept apart from splits used for reporting.
 * Picking the fields on the same data the result is quoted from is how 0.91x
 * gets written up as 1.47x.
 */
const CHOOSING = [7, 13, 29];
const REPORTING = [101, 211, 307, 409, 503, 601, 719];

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const pct = (value) => `${(value * 100).toFixed(1)}%`;

function report(label, seeds, options) {
  const lifts = seeds.map((seed) => {
    const base = popularityRecall(seed);
    return modelRecall(seed, options) / (base || 1e-9);
  });
  const value = mean(seeds.map((seed) => modelRecall(seed, options)));
  console.log(
    `${label.padEnd(30)}${pct(value).padStart(7)}  ${mean(lifts).toFixed(2)}x mean  ` +
      `${Math.min(...lifts).toFixed(2)}x worst`,
  );
  return { value, lift: mean(lifts), worst: Math.min(...lifts) };
}

const baseline = mean(REPORTING.map((seed) => popularityRecall(seed)));
console.log(`\nrecall@50 on held-back splits. popularity baseline ${pct(baseline)}.`);
console.log(
  `fields and constants were chosen on splits ${CHOOSING.join(', ')}, ` +
    `and every number below comes from splits ${REPORTING.join(', ')}.`,
);
console.log(`${joined.length} joined write-ups, ${mirror.length} games in the mirror.\n`);

// Scoring on every field is the flattering way to do it, and is here only to
// show the size of the thing being corrected for.
report('every field (leaks)', REPORTING, { only: null });
report('what ships', REPORTING, {});

console.log('\neach shipped field alone:');
const solo = [...SHARED_NAMESPACES]
  .map((ns) => ({ ns, ...report(`  ${ns}`, REPORTING, { only: new Set([ns]) }) }))
  .sort((a, b) => b.lift - a.lift);
// Worth watching rather than celebrating. PS Plus membership is Sony choosing
// notable games, so on its own it part-detects fame rather than taste. It
// earns its place because the whole model still beats it, but if it ever
// stops doing so this is a PS Plus tab wearing another name.
console.log(`strongest single field: ${solo[0].ns} at ${solo[0].lift.toFixed(2)}x`);

console.log('\nwhat diversity costs:');
{
  const { signals, ids, pool } = splitFor(REPORTING[0]);
  const { picks } = geniusPicks(pool, signals, { limit: 48, only: SHARED_NAMESPACES });
  const distinct = new Set();
  for (const pick of picks) {
    for (const feature of featuresOf(pick.game, SHARED_NAMESPACES)) distinct.add(feature);
  }
  const found = picks.filter((pick) => ids.has(pick.game.id)).length;
  const plain = pool
    .map((game) => ({ game, score: scoreGame(game, buildTaste(signals, SHARED_NAMESPACES)).score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 48);
  const plainDistinct = new Set();
  for (const entry of plain) {
    for (const feature of featuresOf(entry.game, SHARED_NAMESPACES)) plainDistinct.add(feature);
  }
  console.log(
    `  undiversified top 48: ${plain.filter((e) => ids.has(e.game.id)).length} hidden, ` +
      `${plainDistinct.size} distinct features`,
  );
  console.log(`  diversified top 48:   ${found} hidden, ${distinct.size} distinct features`);
}
