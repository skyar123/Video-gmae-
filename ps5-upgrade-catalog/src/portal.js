/**
 * What you can actually play on a PlayStation Portal with no PS5 behind it.
 *
 * The Portal is a streaming handheld. With a console at home it remote-plays
 * almost anything; on its own it can only cloud stream, and Sony's own FAQ is
 * unambiguous about what that covers: "currently only select PS5 games are
 * available to stream on PlayStation Portal", with a PS Plus Premium
 * membership required.
 *
 * Two consequences, and the second is the one worth building on:
 *
 *   A PS4 game can never stream to a Portal. Not "probably not" or "not
 *   yet": there is no PS4 streaming on the device at all. That is a hard
 *   no this app can state on its own, from data it already holds.
 *
 *   A PS5 game is a candidate, not a promise. Sony streams a selection,
 *   the selection moves, and it differs by country. The official list is a
 *   JavaScript widget that renders no titles to a reader, so there is no
 *   honest way to mirror it here. Anything that claimed a specific PS5
 *   game streams would be inventing the bit it cannot know.
 *
 * So this answers the question it can answer: is there a PS5 version of this
 * game at all? That removes 2,332 games from the store mirror and 342 of the
 * 506 write-ups, which is two thirds of the hand-written catalogue, and
 * every one of them is a game the reader genuinely cannot play.
 */

/**
 * Upgrade values that mean a PS5 edition of the game exists.
 *
 * "Backwards Compatible" is deliberately absent. It means the PS4 game runs
 * on PS5 hardware, which is a different claim from there being a PS5 game,
 * and backwards compatibility is a console feature the Portal never touches:
 * streaming a PS4 game is exactly what the device cannot do.
 */
const PS5_UPGRADES = new Set([
  'Free PS5 Upgrade',
  'Paid PS5 Upgrade',
  'PS4 & PS5 Cross-Buy',
  'PS5 Only',
]);

/**
 * Is there a PS5 version of this game?
 *
 * Takes either shape the app carries: a store mirror row (`platforms`), a
 * written-up entry with the store's answer baked in (`storePlatforms`), or a
 * written-up entry with only its own fields.
 *
 * Unknown is false, not true. It is the same rule the age filters follow: a
 * game nobody has checked is not evidence of anything, and the cost of being
 * wrong here is a reader buying something they cannot play.
 */
export function hasPs5Edition(game) {
  if (!game) return false;

  const listed = game.platforms ?? game.storePlatforms;
  if (Array.isArray(listed) && listed.length > 0) return listed.includes('PS5');

  if (game.platform === 'PS5') return true;
  // A PS4 game with a PS5 edition is still playable: the PS5 edition streams.
  if (PS5_UPGRADES.has(game.ps5Upgrade)) return true;

  return false;
}

/**
 * Can this be streamed to a Portal with nothing else plugged in?
 *
 * Today this is exactly `hasPs5Edition`, and it is a separate name on
 * purpose: the two are the same only while Sony's rule is "PS5 games".
 * If PS4 streaming ever arrives, or a real per-game list becomes readable,
 * this is the one place that has to change.
 */
export function playsOnPortal(game) {
  return hasPs5Edition(game);
}

/** What to tell somebody, rather than leaving the shelf silently shorter. */
export const PORTAL_CAVEAT =
  'A Portal on its own streams PS5 games only, so the PS4 ones are hidden. Sony streams a selection of PS5 games and it changes by country, so check the game itself before buying.';
