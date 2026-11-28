/**
 * What is worth talking about right now.
 *
 * The first version of this shelf ranked recent releases by vote count, and
 * the reader's complaint about it was exact: Call of Duty, every single
 * time. The numbers say why. Modern Warfare 4 carries 734,343 ratings, which
 * is eleven times the next game on the list, and it is rated 3.9 stars. A
 * vote count measures how many people bought something, not whether anyone
 * is interested in it this week, so the biggest game in the world wins that
 * ranking permanently and the shelf becomes a photograph.
 *
 * So scale is not a ranking term here at all. The only thing vote count is
 * used for is confidence: a five-star game with four votes is not a
 * five-star game. Everything that moves the order is something that changes
 * week to week.
 *
 * Three reasons a game belongs, which is also what it says on the card:
 *
 *   - the press is writing about it, which is the literal meaning of the
 *     word and was not previously consulted at all
 *   - it only just came out
 *   - it has not come out yet
 *
 * That last one was asked for directly and is the part a storefront is worst
 * at: a game nobody can buy yet has no sales rank, so it is invisible to
 * every popularity ranking including the one this replaces.
 */

/**
 * A rating worth trusting, in 0..1.
 *
 * Pulled toward the middle until enough people have voted, so a lone
 * five-star review cannot outrank a thousand four-star ones. This is the
 * only place a vote count is read, and it can only ever make a game's
 * standing less certain, never more prominent.
 */
export function standing(stars, votes) {
  if (!Number.isFinite(stars) || stars <= 0) return 0.5;
  const confidence = Math.min(1, (votes ?? 0) / 150);
  return 0.5 + (stars / 5 - 0.5) * confidence;
}

const DAY = 86_400_000;

/** How many days from now, negative for the past. */
const daysOut = (iso, now) => {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  return Number.isFinite(at) ? (at - now) / DAY : null;
};

/**
 * Freshness, in 0..1, for something already out.
 *
 * A fortnight old is still news; three months old is not. The curve is
 * deliberately steep early, because "just out" is the whole claim.
 */
const justOut = (age) => {
  if (age == null || age < 0) return 0;
  if (age > 120) return 0;
  return Math.max(0, 1 - age / 120) ** 1.5;
};

/**
 * Anticipation, in 0..1, for something not out yet.
 *
 * Nearest first, and nothing beyond a year, where "upcoming" stops meaning
 * anything a reader can act on. A dateless announcement still counts for
 * something, since those are often the biggest games in the world, but less
 * than a game with a date on it.
 */
const comingUp = (until) => {
  if (until == null) return 0.35;
  if (until < 0 || until > 365) return 0;
  return Math.max(0.2, 1 - until / 365);
};

/** At most this many from one publisher, so no single company owns the shelf. */
const PER_PUBLISHER = 2;

const publisherKey = (game) =>
  String(game?.publisher ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 18) || 'unknown';

/**
 * Build the shelf.
 *
 * `news` is a map of folded title to how many stories mention it, which is
 * what api/goss.mjs already works out in order to hang a game on a headline.
 */
export function rankTrending({
  recent = [],
  upcoming = [],
  news = new Map(),
  now = Date.now(),
  limit = 48,
  perPublisher = PER_PUBLISHER,
} = {}) {
  const seen = new Set();
  const scored = [];

  const consider = (game, kind) => {
    const key = String(game?.id ?? game?.title ?? '');
    if (!key || seen.has(key)) return;
    const title = String(game?.title ?? game?.name ?? '');
    if (!title) return;
    seen.add(key);

    const stories = news.get(foldKey(title)) ?? 0;
    const age = daysOut(game.releaseDate ?? game.release, now);
    const out = age != null && age <= 0 ? -age : null;
    const until = age != null && age > 0 ? age : null;

    const fresh = kind === 'upcoming' ? comingUp(until) : justOut(out);
    // Nothing stale and unremarked belongs on a shelf about right now.
    if (fresh <= 0 && stories === 0) return;

    /*
     * The press counts for more than anything else, because it is the only
     * one of these that is actually a measure of attention rather than of
     * timing. Capped so that one game with a run of coverage cannot take
     * the whole shelf.
     */
    const buzz = Math.min(stories, 4) * 1.2;
    const score = buzz + fresh + standing(game.stars, game.votes) * 0.4;

    scored.push({
      game,
      kind,
      stories,
      score,
      why:
        stories > 0
          ? `${stories} ${stories === 1 ? 'story' : 'stories'} this week`
          : kind === 'upcoming'
            ? untilWords(until)
            : outWords(out),
    });
  };

  for (const game of upcoming) consider(game, 'upcoming');
  for (const game of recent) consider(game, 'recent');

  scored.sort((a, b) => b.score - a.score);

  /*
   * Spread across publishers, after ranking rather than before.
   *
   * Without this the shelf can still be three Call of Duty editions and two
   * EA Sports titles, which is the same complaint in a different shape: a
   * big publisher ships a lot at once, so beating the vote count alone does
   * not stop one company owning the screen.
   */
  const taken = new Map();
  const shelf = [];
  const held = [];
  for (const entry of scored) {
    const key = publisherKey(entry.game);
    const count = taken.get(key) ?? 0;
    if (count >= perPublisher) {
      held.push(entry);
      continue;
    }
    taken.set(key, count + 1);
    shelf.push(entry);
    if (shelf.length >= limit) break;
  }
  // Held-back entries fill any remaining room rather than being thrown away,
  // so a thin week still fills the shelf.
  for (const entry of held) {
    if (shelf.length >= limit) break;
    shelf.push(entry);
  }
  return shelf;
}

export const foldKey = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const outWords = (out) => {
  if (out == null) return 'Out now';
  if (out < 1) return 'Out today';
  if (out < 2) return 'Out yesterday';
  if (out < 14) return `Out ${Math.round(out)} days ago`;
  if (out < 60) return `Out ${Math.round(out / 7)} weeks ago`;
  return 'Out recently';
};

const untilWords = (until) => {
  if (until == null) return 'Announced, no date yet';
  if (until < 1) return 'Out today';
  if (until < 2) return 'Out tomorrow';
  if (until < 14) return `Out in ${Math.round(until)} days`;
  if (until < 60) return `Out in ${Math.round(until / 7)} weeks`;
  return `Out in ${Math.round(until / 30)} months`;
};
