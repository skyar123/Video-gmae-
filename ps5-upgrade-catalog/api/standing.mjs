/**
 * How today's price stands against the cheapest the record has seen.
 *
 * Shared, because four places show it and they must never disagree: a card has
 * room for two words, the open game has room for a sentence, and an alert email
 * and a push notification each need their own phrasing of the same verdict. Two
 * implementations of "is this cheap" would eventually diverge, and an email
 * saying one thing while the app says the other is worse than neither speaking.
 */

/** Below a week of readings there is nothing worth concluding. */
export const STANDING_MIN_DAYS = 7;

export function priceStanding(price, history) {
  const low = history?.lowest;
  const days = history?.observedDays ?? 0;
  if (!low || typeof price?.final !== 'number' || days < STANDING_MIN_DAYS) return null;

  return {
    atLow: price.final <= low.final,
    low,
    days,
    // How much more than the recorded low you would pay today.
    gap: low.final - price.final,
  };
}
