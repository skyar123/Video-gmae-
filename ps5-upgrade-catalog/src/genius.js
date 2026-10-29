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
  /*
   * storeGenres is the same thing under another name, baked into the
   * written-up catalog by scripts/bake-store-fields.mjs. A phone holds that
   * catalog but not the 5MB mirror, so without it a liked write-up could
   * teach nothing that applies to the 8,800 games nobody has written up, and
   * the profile went out to be ranked against them with no store-side
   * feature in it at all.
   */
  for (const genre of game.genres ?? game.storeGenres ?? []) add(PREFIX.storeGenre, genre);

  const rating = game.ageRating ?? null;
  add(PREFIX.family, rating?.family);
  add(PREFIX.tier, rating?.tier);
  if (rating?.interactive?.length) {
    add(PREFIX.purchases, rating.interactive.some((i) => /purchases/i.test(i)) ? 'yes' : 'no');
  }

  add(PREFIX.era, eraOf(game.releaseDate ?? game.release ?? game.storeRelease));
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
 * A thumbs up is first because it is the only one that means exactly what it
 * says. Owning a game is close behind but not the same thing: people own
 * games they regret, and a shelf records what was bought, not what was
 * enjoyed. Wanting one is softer again, because a wishlist is half aspiration.
 *
 * On the other side, a thumbs down is deliberate and rare, so it is trusted
 * as much as a thumbs up. Hiding something is a quieter no, nearer to "not
 * this one, not now" than to "never show me this", and counts for less.
 */
export const SIGNAL_WEIGHTS = {
  liked: 1,
  owned: 0.8,
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
/**
 * How far the noes may outweigh the yeses.
 *
 * Without a limit, enough dislikes drown the likes. Measured against held-out
 * games, being told no helped up to about 25 of them and then turned and hurt:
 * 1.93x with none, 2.01x at 25, and down to 1.59x by 200, with the worst case
 * falling the whole way. The weights say why. At 200 dislikes the number of
 * features with anything good to say had dropped from 32 to 18, and ordinary
 * store genres carried weights near -0.7, so the profile had stopped
 * describing a person's taste and started describing the store: most games
 * are not for you, which is true of everybody and ranks nothing.
 *
 * The cause is that a dislike is cheap and a write-up is not. Somebody can
 * thumb down fifty games in a minute and will never hand-write fifty. So the
 * noes are not allowed to outweigh the yeses, which makes the twentieth no
 * worth less than the first without ever ignoring it: 1.46x at a hundred
 * dislikes against 1.30x uncapped.
 *
 * Held at parity rather than lower, though a harder discount measured
 * slightly better. The negatives in that test are games passed over, not
 * games anybody thumbed down, because no real dislikes exist in this data. An
 * ignored game is weak evidence and deserves discounting; somebody taking the
 * trouble to say no is not, and a result about the first does not license
 * discounting the second. Parity also keeps one no against one yes a wash,
 * which is what a reader would expect of it.
 */
const NEGATIVE_CAP = 1;

export function buildTaste(signals, only = null, { negativeCap = NEGATIVE_CAP } = {}) {
  const score = new Map();
  const seen = new Map();
  let positives = 0;
  let yes = 0;
  let no = 0;

  for (const { kind } of signals) {
    const weight = SIGNAL_WEIGHTS[kind];
    if (!weight) continue;
    if (weight > 0) yes += weight;
    else no -= weight;
  }
  // Only once there is something to balance against. With nothing liked yet
  // there is no positive mass, and scaling to it would zero every dislike and
  // silently throw away the only thing the reader had said.
  const damp = yes > 0 && no > yes * negativeCap ? (yes * negativeCap) / no : 1;

  for (const { game, kind } of signals) {
    const base = SIGNAL_WEIGHTS[kind];
    if (!base) continue;
    if (base > 0) positives += 1;
    const weight = base > 0 ? base : base * damp;
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
 * better guess than an obscure one that happens to share a genre. These were
 * swept on splits held apart from the ones the result is quoted from, which
 * took the lift over a popularity ranking from 1.58x to 1.93x and the worst
 * split from 1.08x to 1.31x.
 *
 * Swept twice. The first pass ran while owning a game counted for 1, and then
 * a thumbs up was added and owning dropped to 0.8 to make room above it,
 * which left the constants fitted to weights that had moved underneath them.
 * They still worked, which is the part worth noticing: a stale fit that
 * happens to improve looks exactly like a fit that is still right. Re-running
 * it against the weights as they stand found better ones anyway.
 *
 * The exploration term is the one the holdout cannot judge, since nothing in
 * a test of hidden games rewards a feed for being different tomorrow than it
 * was today. It is no longer merely free, though: at these settings it is
 * what carries the worst split from 1.23x to 1.31x, so the variety it buys
 * now costs nothing and defends the weakest case.
 *
 * The exploration term is the exception: the sweep is indifferent to it,
 * because nothing in a holdout test rewards variety from one day to the next.
 * It is kept at a value the sweep says costs nothing, for a reason the test
 * cannot see, which is that a feed showing the same twenty games every evening
 * is one nobody opens twice.
 */
export const TUNING = { confidence: 1.5, exploration: EXPLORATION, prior: 0.6 };

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

  /*
   * A thin profile is a weak one, and shrinking it toward reputation does not
   * help. Measured against held-out games, a profile of five likes ranks
   * worse than a plain popularity list, which is the worst possible moment to
   * be wrong: it is when a reader decides whether any of this works. The
   * obvious cure is to believe the taste term in proportion to the evidence
   * behind it and let reputation keep the rest. It was tried across profiles
   * of 5 to 299 likes and made every one of them worse, 1.10x down to 0.89x
   * at forty likes, so it is not here.
   *
   * What does fix a thin profile is more signal, which is why the thumbs are
   * on the picks, the game pages and the feed rather than buried in settings.
   */
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

  /*
   * A game you have already said something about is never suggested back.
   *
   * This used to be left to the caller, and the caller got it wrong: when
   * picks moved over here, owned and wanted games stopped being passed in as
   * exclusions and started being recommended to the people who owned them.
   * The diversity pass hid it rather than showing it, because a game matching
   * your profile exactly is penalised hardest for resembling what is already
   * picked, so Celeste came back at 48 of 48 instead of at the top.
   *
   * Whether a game is already known is something this function can see for
   * itself, so it no longer depends on being told.
   */
  const known = new Set(exclude);
  for (const { game } of signals) known.add(game.id);

  const ranked = [];
  for (const game of pool) {
    if (known.has(game.id)) continue;
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

/* ------------------------------------------------------------------ *
 * 7. Sending a profile somewhere else
 * ------------------------------------------------------------------ */

/**
 * The learned weights, small enough to put in a request body.
 *
 * Ranking the whole mirror has to happen wherever the mirror is, and that is
 * not a phone: the index is 5MB and grows. What travels instead is the
 * profile, which is a few hundred short strings and their weights, and which
 * says nothing about who the reader is. Only features with an opinion behind
 * them are sent, and tiny ones are dropped since they cannot change an order.
 */
export function packTaste(taste, { floor = 0.02 } = {}) {
  const weights = {};
  for (const [feature, weight] of taste.weights) {
    if (Math.abs(weight) < floor) continue;
    weights[feature] = Math.round(weight * 1000) / 1000;
  }
  return { weights, positives: taste.positives, signals: taste.signals };
}

/** The other end of packTaste. Shapes that are not a profile become an empty one. */
export function unpackTaste(packed) {
  const weights = new Map();
  const entries = packed && typeof packed === 'object' ? packed.weights : null;
  if (entries && typeof entries === 'object') {
    for (const [feature, weight] of Object.entries(entries)) {
      if (typeof feature !== 'string' || typeof weight !== 'number') continue;
      if (!Number.isFinite(weight)) continue;
      weights.set(feature, weight);
    }
  }
  return {
    weights,
    seen: new Map(),
    only: null,
    signals: Number(packed?.signals) || 0,
    positives: Number(packed?.positives) || 0,
  };
}

/* ------------------------------------------------------------------ *
 * 8. Saying why
 * ------------------------------------------------------------------ */

const TAG_PHRASES = {
  graphics: 'how it looks',
  social: 'playing with people',
  cozy: 'cozy games',
  queer: 'queer stories',
  disability: 'disabled and neurodivergent characters',
  classic: 'older games',
};

const LEAD_PHRASES = {
  Custom: 'making your own character',
  Female: 'a woman in the lead',
  Male: 'a man in the lead',
  Ensemble: 'a cast rather than one hero',
  'Creature/Animal': 'playing as an animal',
};

const FAMILY_PHRASES = {
  safe: 'games anyone can play',
  mild: 'games with a light touch',
  mature: 'games written for adults',
};

const ERA_PHRASES = {
  now: 'new releases',
  '2020s': 'games from this decade',
  '2010s': 'games from the 2010s',
  older: 'older games',
};

/**
 * One feature, in words a person would use.
 *
 * Returns null for anything with no good phrasing rather than printing the
 * raw key. "Because tier:everyone10" is worse than no reason at all: a reason
 * nobody can read undermines the pick it is attached to.
 */
export function describeFeature(feature) {
  const split = feature.indexOf(':');
  const kind = feature.slice(0, split);
  const value = feature.slice(split + 1);
  switch (kind) {
    case 'genre':
    case 'sgenre':
      return `${value} games`;
    case 'art':
      return `the ${value.toLowerCase()} look`;
    case 'lead':
      return LEAD_PHRASES[value] ?? null;
    case 'tag':
      return TAG_PHRASES[value] ?? null;
    case 'rep':
      return TAG_PHRASES[value] ?? null;
    case 'family':
      return FAMILY_PHRASES[value] ?? null;
    case 'era':
      return ERA_PHRASES[value] ?? null;
    case 'plus':
      return 'games your PS Plus already covers';
    default:
      return null;
  }
}

/**
 * How much a feature is worth saying out loud.
 *
 * Not the same question as how much it is worth scoring. An age rating of
 * teen is shared by thousands of games, so it can carry real weight in a
 * ranking while explaining nothing: "because you go for games from this
 * decade" is true of almost any recommendation and reads as a machine with
 * nothing to say. A genre or a tag names something a person would recognise
 * as their own taste, so it is preferred whenever one is among the reasons
 * the game actually scored on.
 */
const SAYING_IT = {
  tag: 3,
  rep: 3,
  genre: 3,
  sgenre: 2.5,
  art: 2.5,
  lead: 2,
  plus: 1.2,
  family: 0.6,
  era: 0.4,
  tier: 0.3,
};

/**
 * The sentence under a pick.
 *
 * Built only from features the game actually scored on, so the reason is the
 * reason rather than a flattering guess, but ordered by what is worth saying
 * rather than by weight alone. Two is the limit: a pick justified by six
 * things reads as a machine covering itself.
 */
/**
 * Below this, a feature is not worth building a sentence around. Age ratings
 * and release decades describe most of the catalog, so offering one as the
 * reason for a pick is a claim to insight the model does not have.
 */
const WORTH_SAYING = 1.2;

/**
 * Whether the model has anything particular to say about this pick.
 *
 * Worth asking separately from the sentence itself, because a list where
 * every entry falls back to "well reviewed" is a list the model did not
 * really choose, and is better not shown than shown with twelve identical
 * non-reasons under it.
 */
export function hasDistinctiveReason(hits) {
  return hits.some(
    (hit) =>
      (SAYING_IT[hit.feature.slice(0, hit.feature.indexOf(':'))] ?? 1) >= WORTH_SAYING &&
      describeFeature(hit.feature),
  );
}

export function explain(hits, { limit = 2 } = {}) {
  const ranked = hits
    .map((hit) => ({
      hit,
      phrase: describeFeature(hit.feature),
      value: hit.weight * (SAYING_IT[hit.feature.slice(0, hit.feature.indexOf(':'))] ?? 1),
    }))
    .filter((entry) => entry.phrase)
    .sort((a, b) => b.value - a.value);

  // Nothing distinctive to point at. Saying so beats dressing up an age
  // rating as taste, which is what made six picks in a row all claim to have
  // been chosen for being games with a light touch.
  const distinctive = ranked.filter(
    (entry) => (SAYING_IT[entry.hit.feature.slice(0, entry.hit.feature.indexOf(':'))] ?? 1) >= WORTH_SAYING,
  );
  if (distinctive.length === 0) return 'Well reviewed, and close to what you have been picking.';

  const phrases = [];
  const used = new Set();
  for (const { phrase } of distinctive) {
    if (used.has(phrase)) continue;
    used.add(phrase);
    phrases.push(phrase);
    if (phrases.length === limit) break;
  }
  if (phrases.length === 0) return 'Well reviewed, and nothing you have ruled out.';
  if (phrases.length === 1) return `Because you go for ${phrases[0]}.`;
  return `Because you go for ${phrases[0]} and ${phrases[1]}.`;
}
