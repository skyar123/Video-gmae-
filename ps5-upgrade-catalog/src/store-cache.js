/**
 * Which cached store rows to keep when there are too many.
 *
 * The app remembers the raw row behind any store game somebody saves, rates,
 * hides or watches a price on, because a stored id is only half the record:
 * the row is what turns `store:10020501` back into a game with a name, a
 * rating and a genre. Lose the row and the id refers to nothing, so a rating
 * stops counting and a price alert can never fire, and neither failure looks
 * like a failure from outside.
 *
 * Kept out here, and out of the component, so the rule can be tested against
 * the function the app actually calls rather than against a copy of it.
 */

/** Enough to never be reached in ordinary use, low enough to bound the key. */
export const MAX_SAVED_STORE = 500;

/**
 * Drops the oldest rows nothing refers to until the cache is back at its cap.
 *
 * A row something still points at is never dropped, even if that means
 * staying over the cap: the cap exists to stop an unbounded cache of games
 * nobody asked about, not to put a ceiling on how many games somebody is
 * allowed to have an opinion about.
 */
export function evictStoreRows(rows, spokenFor, cap = MAX_SAVED_STORE) {
  let over = rows.length - cap;
  if (over <= 0) return rows;
  return rows.filter((row) => {
    if (over <= 0 || spokenFor.has(`store:${row.id}`)) return true;
    over -= 1;
    return false;
  });
}
