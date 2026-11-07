/**
 * Does the price predictor actually work?
 *
 * The predictor states a probability that a game will be cheaper within 30
 * days. That claim is checkable, and until it is checked it is just a number
 * with a confident font. This replays it against the price history this site
 * has recorded: at every past moment where a price changed, it re-runs the
 * predictor using only what was known *then*, then looks at what the price
 * actually did over the following 30 days.
 *
 * Two things come out of that. Calibration: of the times it said "70%", did
 * roughly 70% of them get cheaper? And a Brier score, which is the mean
 * squared error of a probabilistic forecast, where lower is better, 0.25 is
 * what you get by always guessing 50%, and beating the base rate is the bar
 * that matters.
 *
 * Right now this returns `ready: false`, because the history is one day old.
 * That is the honest answer and the reason this exists: it is the thing that
 * will tell us, in a few months, whether the heuristic is worth keeping or
 * whether it should be replaced by a model fitted to the same data.
 *
 * Censoring is handled the way the survival literature says it must be: a
 * moment is only scored if the full 30-day window after it was observed. A
 * game whose window runs past the end of the record is dropped rather than
 * counted as "no drop", which would quietly bias every number here downward.
 */

import { predictPriceDrop } from './predict.mjs';
import { summarize } from './history.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 30;

/** Below this there is nothing to say, and saying it anyway would mislead. */
const MIN_SAMPLES = 50;
/** The predictor leans on history, so replay only where it had some. */
const MIN_PRIOR_POINTS = 2;

const BUCKETS = [
  [0, 20],
  [20, 40],
  [40, 60],
  [60, 80],
  [80, 101],
];

const dayOf = (stamp) => new Date(`${stamp}T00:00:00Z`).getTime();
const addDays = (ms, days) => ms + days * DAY_MS;

/** A recorded point back into the price shape the predictor expects. */
const priceFromPoint = (point, currency) => ({
  isFree: false,
  currency: currency ?? 'USD',
  initial: point.i ?? point.f,
  final: point.f,
  discountPercent: point.p ?? 0,
  initialFormatted: null,
  finalFormatted: null,
  saleEndsAt: null,
  plus: null,
});

/**
 * Every scoreable moment in one game's recorded history.
 *
 * A moment is scoreable when the predictor had something to work from before
 * it and the whole 30-day window after it was actually observed.
 */
function momentsFor(entry, lastObserved) {
  const points = entry?.points ?? [];
  if (points.length < MIN_PRIOR_POINTS + 1) return [];

  const moments = [];
  for (let index = MIN_PRIOR_POINTS - 1; index < points.length; index += 1) {
    const at = dayOf(points[index].d);
    const windowEnds = addDays(at, HORIZON_DAYS);
    // Right-censored: we cannot say what happened, so we do not guess.
    if (windowEnds > lastObserved) continue;

    const laterInWindow = points
      .slice(index + 1)
      .filter((point) => dayOf(point.d) > at && dayOf(point.d) <= windowEnds);
    const cheapest = laterInWindow.reduce(
      (low, point) => Math.min(low, point.f),
      points[index].f,
    );

    moments.push({
      at,
      date: points[index].d,
      prior: points.slice(0, index + 1),
      price: points[index],
      droppped: cheapest < points[index].f,
      dropTo: cheapest,
    });
  }
  return moments;
}

/**
 * Replays the predictor over every recorded history and scores it.
 *
 * `histories` is a map of chunk key to the stored `{gameId: entry}` object,
 * exactly as the history store holds it.
 */
export function replayCalibration(histories, now = new Date()) {
  const observations = [];
  let gamesSeen = 0;
  let earliest = null;
  let latest = null;

  for (const chunk of Object.values(histories ?? {})) {
    for (const [gameId, entry] of Object.entries(chunk ?? {})) {
      const points = entry?.points ?? [];
      if (points.length === 0) continue;
      gamesSeen += 1;

      const last = points[points.length - 1];
      const lastObserved = dayOf(last.seen || last.d);
      const first = dayOf(points[0].d);
      earliest = earliest === null ? first : Math.min(earliest, first);
      latest = latest === null ? lastObserved : Math.max(latest, lastObserved);

      for (const moment of momentsFor(entry, lastObserved)) {
        const history = summarize(
          { currency: entry.currency, points: moment.prior },
          new Date(moment.at),
        );
        const prediction = predictPriceDrop(
          {
            matched: true,
            price: priceFromPoint(moment.price, entry.currency),
            releaseDate: entry.releaseDate ?? null,
          },
          history,
          new Date(moment.at),
        );
        if (typeof prediction.score !== 'number') continue;

        observations.push({
          gameId,
          date: moment.date,
          predicted: prediction.score / 100,
          verdict: prediction.verdict,
          actual: moment.droppped ? 1 : 0,
        });
      }
    }
  }

  const samples = observations.length;
  const observedDays =
    earliest !== null && latest !== null ? Math.round((latest - earliest) / DAY_MS) : 0;

  if (samples < MIN_SAMPLES) {
    return {
      ready: false,
      samples,
      gamesTracked: gamesSeen,
      observedDays,
      needs: `${MIN_SAMPLES} scoreable moments; a moment needs a price change with a full ${HORIZON_DAYS}-day window observed after it.`,
      generatedAt: now.toISOString(),
    };
  }

  const positives = observations.reduce((sum, o) => sum + o.actual, 0);
  const baseRate = positives / samples;
  const brier =
    observations.reduce((sum, o) => sum + (o.predicted - o.actual) ** 2, 0) / samples;
  // What a forecaster who always predicts the base rate would score. Beating
  // this is the only result that means the features carry information.
  const baseRateBrier =
    observations.reduce((sum, o) => sum + (baseRate - o.actual) ** 2, 0) / samples;

  const buckets = BUCKETS.map(([from, to]) => {
    const inBucket = observations.filter(
      (o) => o.predicted * 100 >= from && o.predicted * 100 < to,
    );
    return {
      from,
      to: Math.min(to, 100),
      n: inBucket.length,
      predicted: inBucket.length
        ? Math.round((inBucket.reduce((s, o) => s + o.predicted, 0) / inBucket.length) * 100)
        : null,
      actual: inBucket.length
        ? Math.round((inBucket.reduce((s, o) => s + o.actual, 0) / inBucket.length) * 100)
        : null,
    };
  });

  const byVerdict = {};
  for (const observation of observations) {
    const row = (byVerdict[observation.verdict] ??= { n: 0, dropped: 0 });
    row.n += 1;
    row.dropped += observation.actual;
  }
  for (const row of Object.values(byVerdict)) {
    row.actualPercent = Math.round((row.dropped / row.n) * 100);
  }

  return {
    ready: true,
    samples,
    gamesTracked: gamesSeen,
    observedDays,
    horizonDays: HORIZON_DAYS,
    baseRatePercent: Math.round(baseRate * 100),
    brier: Number(brier.toFixed(4)),
    baseRateBrier: Number(baseRateBrier.toFixed(4)),
    // Positive means the predictor is carrying real information.
    skill: Number((baseRateBrier - brier).toFixed(4)),
    buckets,
    byVerdict,
    generatedAt: now.toISOString(),
  };
}
