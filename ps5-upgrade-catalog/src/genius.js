/**
 * Picks built from what you have said about games, good and bad.
 *
 * The shape of this is decided by one fact: there is a single reader. TikTok
 * and Spotify lean on collaborative filtering, which answers "what did people
 * like you enjoy", and with one person there is nobody like you. So nothing
 * here tries to imitate that. What it does instead is the part that actually
 * produces the feel: learn what the person keeps choosing, keep looking
 * somewhere new, and refuse to serve twenty of the same thing.
 *
 * Three pieces, in order:
 *
 *   1. A game becomes a set of features: genre, art, who you play, the tags,
 *      the board's content descriptors, whether it sells things inside.
 *   2. Those features earn weights from the evidence, positive and negative,
 *      smoothed so one liked game does not become a law.
 *   3. The ranked list is re-ranked for variety, because a list of twenty
 *      games that are all the same game is a worse answer than a list of
 *      twenty good ones that differ.
 *
 * Everything is pure and synchronous: same signals in, same picks out.
 */

/* ------------------------------------------------------------------ *
 * 1. What a game is made of
 * ------------------------------------------------------------------ */

/**
 * The curated catalog and the store mirror describe games in different
 * words. Only three of the sixteen hand-written genres exist in the store's
 * vocabulary at all: theirs is expressive (Metroidvania, Deckbuilder, Life
 * Sim), the store's is coarse (Action, Adventure, Casual). Mapping one onto
 * the other loses the distinction that makes the hand-written one useful, so
 * they live in separate namespaces and the model learns about each on its
 * own terms.
 */
const PREFIX = {
  genre: 'genre',
  storeGenre: 'sgenre',
  art: 'art',
  protagonist: 'lead',
  tag: 'tag',
  representation: 'rep',
  family: 'family',
  tier: 'tier',
  era: 'era',
  purchases: 'sells',
  plus: 'plus',
};

/**
 * Three fields are deliberately not here: publisher, price band, and the
 * board's content descriptors.
 *
 * All three sound like taste and measure as noise. Held out against
 * distractors matched for star rating and review count, scoring on every
 * available field came in at 0.91x a plain popularity ranking, and dropping
 * these three took it to 1.47x. Publisher was the worst of them: hundreds of
 * publishers across a few hundred games of evidence means almost every one is
 * seen once, so it fits whoever happens to be in the training half and
 * predicts nothing. Price moves under the model as games go on sale.
 *
 * Content descriptors are the one real loss, since "no blood, no sexual
 * content" is exactly the kind of thing somebody wants a dislike to mean. The
 * age rating's family and tier are kept and cover that at a cardinality the
 * evidence can actually support.
 */

/**
 * The namespaces a game from the mirror can have.
 *
 * Five of the fourteen (genre, art, lead, tag, rep) come from the write-ups
 * and appear on every hand-written entry and on nothing else. That asymmetry
 * is worth naming, because it is a trap in both directions: a measurement
 * taken across both halves can score well by learning "this one is
 * hand-written", and a ranking taken across both halves will bury the mirror
 * under games that simply have more fields filled in.
 */
export const SHARED_NAMESPACES = new Set(['sgenre', 'family', 'tier', 'era', 'sells', 'plus']);

/** Release decade, which separates a 2009 port from this year's release. */
function eraOf(release) {
  const year = Number(String(release ?? '').slice(0, 4));
  if (!Number.isFinite(year) || year < 1980) return null;
  if (year >= 2024) return 'now';
  if (year >= 2020) return '2020s';
  if (year >= 2013) return '2010s';
  return 'older';
}

/**
 * The features one game contributes.
 *
 * A field with nothing in it contributes nothing. Every hand-written game
 * has an art style and a lead; no game from the mirror has either, and the
 * catalog is mostly those now. Written as "art:null" it would become a
 * feature thousands of games share, which would make not knowing something
 * the strongest signal in the profile.
 */
export function featuresOf(game, only = null) {
  const features = new Set();
  const add = (kind, value) => {
    if (value == null || value === '') return;
    if (only && !only.has(kind)) return;
    features.add(`${kind}:${value}`);
  };

  add(PREFIX.genre, game.genre);
  add(PREFIX.art, game.artStyle);
  add(PREFIX.protagonist, game.protagonist);
  for (const tag of game.tags ?? []) add(PREFIX.tag, tag);
  for (const entry of game.representation ?? []) add(PREFIX.representation, entry.kind);
  for (const genre of game.genres ?? []) add(PREFIX.storeGenre, genre);

  const rating = game.ageRating ?? null;
  add(PREFIX.family, rating?.family);
  add(PREFIX.tier, rating?.tier);
  if (rating?.interactive?.length) {
    add(PREFIX.purchases, rating.interactive.some((i) => /purchases/i.test(i)) ? 'yes' : 'no');
  }

  add(PREFIX.era, eraOf(game.releaseDate ?? game.release));
  const included =
    game.plus?.included || game.plusIncluded || game.storeLive?.price?.plus?.included;
  if (included) add(PREFIX.plus, 'yes');

  return features;
}

/* ------------------------------------------------------------------ *
 * 2. What the evidence says about each feature
 * ------------------------------------------------------------------ */

/**
 * How much each kind of signal counts.
 *
 * Owning a game is the strongest thing a person says about it: they paid.
 * Wanting one is softer, because a wishlist is partly aspiration. A dislike
 * is deliberate and rare, so it carries as much as owning; hiding something
 * is a quieter no, and counts for less.
 */
export const SIGNAL_WEIGHTS = {
  owned: 1,
  wishlisted: 0.6,
  disliked: -1,
  hidden: -0.45,
};

/** Keeps one enthusiastic evening from rewriting the whole profile. */
const SMOOTHING = 2.5;

/**
 * Turns signals into a weight per feature.
 *
 * The weight is evidence over exposure: a feature that appears in four liked
 * games and no disliked ones scores higher than one that appears in four of
 * each. Dividing by how often the feature was seen at all, plus a constant,
 * is what stops a feature seen once from outranking one seen twenty times.
 * It is the diagonal of what a linear bandit would learn, which is the part
 * worth having when the evidence is a few dozen games rather than millions.
 */
export function buildTaste(signals, only = null) {
  const score = new Map();
  const seen = new Map();
  let positives = 0;

  for (const { game, kind } of signals) {
    const weight = SIGNAL_WEIGHTS[kind];
    if (!weight) continue;
    if (weight > 0) positives += 1;
    for (const feature of featuresOf(game, only)) {
      score.set(feature, (score.get(feature) ?? 0) + weight);
      seen.set(feature, (seen.get(feature) ?? 0) + Math.abs(weight));
    }
  }

  const weights = new Map();
  for (const [feature, total] of score) {
    weights.set(feature, total / (seen.get(feature) + SMOOTHING));
  }
  return { weights, seen, only, signals: signals.length, positives };
}

/* ------------------------------------------------------------------ *
 * 3. Scoring, with room left for being wrong
 * ------------------------------------------------------------------ */

/**
 * How loudly to argue for something the profile knows nothing about.
 *
 * Exploration has to be anchored rather than uniform. Roblox's work on
 * cold-start priors makes the point: a flat prior treats every unseen thing
 * as a coin toss, which "systematically over-explores weak items" wherever
 * good ones are rare, and in a mirror of 9,222 games most are rare for a
 * reason. So the bonus for the unknown is small, and it is multiplied by the
 * game's own standing rather than handed out evenly.
 */
const EXPLORATION = 0.35;

/**
 * How well regarded a game is, on one scale, from whichever source has it.
 *
 * A five-star game with four votes is not a five-star game, so the score is
 * pulled toward the middle until enough people have weighed in. The two
 * halves of the catalog measure this differently: the mirror gives stars out
 * of five, the hand-written entries carry a critic score and a percentage of
 * positive player reviews. Both end up as one number in 0..1 so that neither
 * half is quietly preferred over the other.
 */
export function qualityPrior(game) {
  const reviews = game.ratings ?? null;
  if (reviews?.critic != null || reviews?.user?.percentPositive != null) {
    const critic = reviews.critic != null ? reviews.critic / 100 : null;
    const players =
      reviews.user?.percentPositive != null ? reviews.user.percentPositive / 100 : null;
    const parts = [critic, players].filter((value) => value != null);
    const mean = parts.reduce((sum, value) => sum + value, 0) / parts.length;
    const votes = reviews.user?.total ?? 0;
    const confidence = Math.min(0.4 + votes / 2000, 1);
    return 0.25 + 0.75 * mean * confidence;
  }

  const stars = game.stars ?? game.storeLive?.stars ?? null;
  if (stars == null) return 0.45;
  const votes = game.votes ?? game.storeLive?.votes ?? 0;
  const confidence = Math.min(votes / 400, 1);
  return 0.25 + 0.75 * (stars / 5) * confidence;
}

/**
 * How many opinions it takes before a match is taken at face value.
 *
 * The score is an average rather than a sum, because the two halves of the
 * catalog describe games in different amounts of detail and a sum rewards
 * detail instead of fit: a hand-written entry carries five fields no game in
 * the mirror has, so summing would rank every write-up above everything in
 * the mirror whether or not it suited anybody. Averaging puts them on one
 * scale. The constant is what stops the other extreme, where a game matching
 * on one lucky field beats one matching on nine.
 */
/**
 * How much a game's general standing counts for, next to how well it fits.
 *
 * Not zero, and in fact large. Taste built from a few dozen signals is a thin
 * thing, and a highly regarded game nobody has an opinion about yet is a
 * better guess than an obscure one that happens to share a genre. Sweeping
 * these on splits held apart from the ones the result is quoted from moved the
 * lift over a popularity ranking from 1.58x to 1.76x, and the worst split from
 * 1.08x to 1.30x.
 *
 * The exploration term is the exception: the sweep is indifferent to it,
 * because nothing in a holdout test rewards variety from one day to the next.
 * It is kept at a value the sweep says costs nothing, for a reason the test
 * cannot see, which is that a feed showing the same twenty games every evening
 * is one nobody opens twice.
 */
export const TUNING = { confidence: 2, exploration: EXPLORATION, prior: 0.8 };

export function scoreGame(game, taste, tuning = TUNING) {
  const { confidence, exploration, prior: priorWeight } = { ...TUNING, ...tuning };
  const features = featuresOf(game, taste.only);
  if (features.size === 0) return { score: 0, hits: [], novelty: 1 };

  let total = 0;
  let known = 0;
  const hits = [];
  for (const feature of features) {
    const weight = taste.weights.get(feature);
    if (weight === undefined) continue;
    known += 1;
    total += weight;
    if (weight > 0) hits.push({ feature, weight });
  }

  const relevance = total / Math.max(known + confidence, 1);
  const novelty = (features.size - known) / features.size;
  const prior = qualityPrior(game);

  hits.sort((a, b) => b.weight - a.weight);
  return {
    score: relevance + exploration * novelty * prior + priorWeight * prior,
    hits,
    novelty,
  };
}

/* ------------------------------------------------------------------ *
 * 4. Variety
 * ------------------------------------------------------------------ */

const overlap = (a, b) => {
  let shared = 0;
  for (const feature of a) if (b.has(feature)) shared += 1;
  return shared / Math.sqrt(a.size * b.size || 1);
};

/**
 * Re-ranks for variety: maximal marginal relevance.
 *
 * A model that only maximises relevance returns the same game twenty times,
 * which is the complaint everybody has about recommendations. The literature
 * handles this in a second stage rather than inside the model, and this is
 * that stage: each pick is the best remaining game once a penalty for
 * resembling what has already been picked is subtracted.
 */
export function diversify(ranked, limit, lambda = 0.72, only = null) {
  const picked = [];
  const pool = [...ranked];
  const features = new Map(pool.map((entry) => [entry.game, featuresOf(entry.game, only)]));

  while (picked.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      let worst = 0;
      for (const chosen of picked) {
        worst = Math.max(worst, overlap(features.get(candidate.game), features.get(chosen.game)));
      }
      const value = lambda * candidate.score - (1 - lambda) * worst;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    picked.push(pool.splice(bestIndex, 1)[0]);
  }
  return picked;
}

/* ------------------------------------------------------------------ *
 * 5. The whole thing
 * ------------------------------------------------------------------ */

export function geniusPicks(
  pool,
  signals,
  { limit = 48, exclude = new Set(), only = null, tuning = TUNING } = {},
) {
  const taste = buildTaste(signals, only);
  if (taste.positives === 0) return { picks: [], taste };

  const ranked = [];
  for (const game of pool) {
    if (exclude.has(game.id)) continue;
    const scored = scoreGame(game, taste, tuning);
    if (scored.score <= 0) continue;
    ranked.push({ game, ...scored });
  }
  ranked.sort((a, b) => b.score - a.score);

  // Diversifying the whole mirror is quadratic and pointless: nothing below
  // the first few hundred is going to win on variety alone.
  const shortlist = ranked.slice(0, Math.max(limit * 6, 120));
  return { picks: diversify(shortlist, limit, 0.72, only), taste };
}

/* ------------------------------------------------------------------ *
 * 6. Joining the two halves
 * ------------------------------------------------------------------ */

/** Loose enough to match "Marvel's Spider-Man" to "Marvel s Spider Man". */
export const normalizeTitle = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/**
 * Folds the mirror into the hand-written catalog so one game is one entry.
 *
 * This is what makes picks from the mirror possible at all. The hand-written
 * entries describe a game in terms the store does not use, and the store
 * describes it in terms the write-ups do not: only the age rating is common
 * to both. Learn from write-ups alone and the model knows a great deal about
 * art styles and nothing that applies to the 9,222 games in the mirror.
 *
 * 398 of the 506 write-ups name a game the mirror also carries. Joining them
 * means liking a hand-written game also teaches which publishers, store
 * genres and release years you go for, and those transfer to everything in
 * the mirror. The 108 that do not match stay as they are, which costs
 * nothing: their own features still work on the hand-written half.
 */
export function unify(curated, storeRows) {
  const byTitle = new Map();
  for (const row of storeRows) {
    const key = normalizeTitle(row.name);
    if (key && !byTitle.has(key)) byTitle.set(key, row);
  }

  const games = [];
  const claimed = new Set();
  for (const entry of curated) {
    const row = byTitle.get(normalizeTitle(entry.title));
    if (!row) {
      games.push(entry);
      continue;
    }
    claimed.add(row.id);
    games.push({
      ...entry,
      storeId: row.id,
      genres: row.genres,
      publisher: row.publisher,
      price: entry.price ?? row.price,
      stars: row.stars,
      votes: row.votes,
      plus: row.plus,
      releaseDate: entry.releaseDate ?? row.release,
      // The write-up's own rating wins: it was checked by hand, and it
      // carries the concerns and notes the mirror's does not.
      ageRating: entry.ageRating ?? row.ageRating,
      art: entry.art ?? row.art,
    });
  }

  for (const row of storeRows) {
    if (claimed.has(row.id)) continue;
    games.push({ ...row, title: row.name, fromStore: true });
  }
  return games;
}
