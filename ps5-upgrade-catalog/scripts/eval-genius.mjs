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
import { buildTaste, scoreGame, geniusPicks, featuresOf, SHARED_NAMESPACES } from '../src/genius.js';
import {
  modelRecall,
  popularityRecall,
  splitFor,
  recallAt,
  rng,
  shuffled,
  joined,
  mirror,
  CHOOSING,
  REPORTING,
  mean,
} from './eval-lib.mjs';

const pct = (value) => `${(value * 100).toFixed(1)}%`;

/*
 * The splits, the pools and the metrics live in eval-lib.mjs, which the
 * ad-hoc experiments import too. They were copied in here once and had
 * already drifted from the copy by the time anybody looked, which is the
 * usual fate of a second copy of a measurement.
 */

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

/*
 * Does being told no actually help?
 *
 * This is the half of the model nothing else here measures, and it is half
 * the model: the write-ups record what somebody liked and nothing anywhere
 * records what they did not, so the weights learned from a thumbs down have
 * never been checked against anything.
 *
 * They can be checked, with one assumption stated plainly. Somebody wrote up
 * 506 games out of 9,222, so a game drawn at random from the rest is
 * overwhelmingly likely to be one they passed over. Treating those as
 * dislikes is the usual implicit-feedback assumption, and it is weaker than a
 * real thumbs down: passed over is not the same as disliked, and somebody who
 * actively dislikes a game is saying something sharper than the silence of
 * 8,834 games nobody mentioned.
 *
 * So this measures whether the mechanism works, not how much real dislikes
 * are worth. The negatives are drawn from games held out of the ranking pool,
 * because learning to push down the very games about to be ranked would make
 * the answer come out yes no matter what the model did.
 */
console.log('\nwhat being told no is worth:');
{
  const negativesFor = (seed, count, excludeIds) => {
    const random = rng(seed * 31 + 7);
    const eligible = mirror.filter((game) => !excludeIds.has(game.id));
    return shuffled(eligible, random)
      .slice(0, count)
      .map((game) => ({ game, kind: 'disliked' }));
  };

  const withNegatives = (count) => {
    const lifts = REPORTING.map((seed) => {
      const { signals, ids, pool } = splitFor(seed);
      const inPool = new Set(pool.map((game) => game.id));
      const taste = buildTaste(
        [...signals, ...negativesFor(seed, count, inPool)],
        SHARED_NAMESPACES,
      );
      const ranked = pool
        .map((game) => ({ game, score: scoreGame(game, taste).score }))
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.game);
      return recallAt(ranked, ids, 50) / (popularityRecall(seed) || 1e-9);
    });
    return { mean: mean(lifts), worst: Math.min(...lifts) };
  };

  for (const count of [0, 10, 25, 50, 100, 200]) {
    const { mean: m, worst: w } = withNegatives(count);
    console.log(
      `  ${String(count).padStart(3)} games thumbed down   ${m.toFixed(2)}x mean  ${w.toFixed(2)}x worst`,
    );
  }
}

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
