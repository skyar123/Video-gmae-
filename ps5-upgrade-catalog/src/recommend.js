/**
 * The ranking shown before there is any taste to work from.
 *
 * This file used to hold the recommender: a trait-matching model built from
 * the catalog's hand-made judgement. That job now belongs to genius.js, which
 * learns from dislikes as well as likes, reaches the store mirror as well as
 * the write-ups, and is measured against a holdout rather than asserted. What
 * is left here is the one piece that outlived it, which is the answer to the
 * question the model cannot answer: what to show somebody who has not told it
 * anything yet.
 *
 * Pure: same catalog in, same picks out, no network.
 */

/** Ratings nudge the order without deciding it: good taste beats a high score. */
function qualityMultiplier(game) {
  const critic = game.ratings?.critic;
  const user = game.ratings?.user?.percentPositive;
  if (critic != null || user != null) {
    const parts = [critic, user].filter((value) => value != null);
    const mean = parts.reduce((sum, value) => sum + value, 0) / parts.length / 100;
    return 0.8 + 0.4 * Math.min(Math.max(mean, 0), 1);
  }

  /*
   * A game from the store mirror has no review pass behind it, only the
   * store's own stars. Without this every one of them scored a flat 0.95 and
   * the thousands that share a genre came back in whatever order the index
   * happened to hold them, which is no order at all.
   *
   * Five stars from four people is not five stars, so the score is scaled by
   * how many voted, the same way the browse order does it.
   */
  if (game.stars != null) {
    const confidence = Math.min((game.votes ?? 0) / 500, 1);
    return 0.8 + 0.4 * Math.min(Math.max((game.stars / 5) * confidence, 0), 1);
  }
  return 0.95;
}

/**
 * Each repeat of a genre is worth less than the last.
 *
 * Without it the top of the list is one genre five times over, because on a
 * plain quality ranking nothing else is pulling the scores apart. The picks
 * proper handle this with a stronger method in genius.js; this is the cheap
 * version, and it is enough for a list nobody has shaped yet.
 */
function diversifyByGenre(scored, limit) {
  const picked = [];
  const genreUses = new Map();
  const pool = scored.slice(0, limit * 4);
  while (picked.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < pool.length; index += 1) {
      const used = genreUses.get(pool[index].game.genre) ?? 0;
      const adjusted = pool[index].score * 0.82 ** used;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = index;
      }
    }
    const [chosen] = pool.splice(bestIndex, 1);
    genreUses.set(chosen.game.genre, (genreUses.get(chosen.game.genre) ?? 0) + 1);
    picked.push(chosen);
  }
  return picked;
}

/**
 * Highly rated across the whole catalog, spread across genres.
 *
 * Nobody has told this collection what they like yet, so the reason under
 * each pick says exactly that rather than pretending to a match it does not
 * have. Shown until the first thumb lands, after which genius.js takes over.
 */
export function starterPicks(catalog, { exclude, limit = 40, includePs5 = true } = {}) {
  const scored = catalog
    .filter((game) => !exclude.has(game.id))
    .filter((game) => includePs5 || game.platform !== 'PS5')
    /*
     * Stars count as being rated.
     *
     * This asked only for a review pass, which no game in the mirror has, so
     * a store row was dropped before reaching the scorer, and the branch
     * below that knows how to weigh its stars could never run. It went unseen
     * while the old recommender was still here, because that had no such
     * filter and did the scoring itself.
     */
    .filter(
      (game) => game.ratings?.critic != null || game.ratings?.user != null || game.stars != null,
    )
    .map((game) => ({ game, score: qualityMultiplier(game) }));

  scored.sort((a, b) => b.score - a.score);

  return diversifyByGenre(scored, limit).map(({ game, score }) => ({
    game,
    score,
    matched: 0,
    reason: 'Highly rated across the catalog',
  }));
}
