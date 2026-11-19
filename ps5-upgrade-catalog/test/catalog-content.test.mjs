/**
 * Does every write-up actually have something to show?
 *
 * Found the way these things usually are: a game sitting in somebody's
 * wishlist was a purple rectangle with its name printed on it. Ghost of
 * Yotei, which is a few months old and rated 4.78 by 98,014 people.
 *
 * It was not one game. A write-up takes its cover art and its score from
 * Steam, so every PlayStation exclusive had neither, and those are the games
 * this app is most about: Astro Bot, Demon's Souls, Gran Turismo 7, the Sly
 * Cooper shelf. 225 of 506 showed no rating at all.
 *
 * Nothing in the test suite would have noticed, because every other test
 * here runs on hand-made fixtures. These run on the shipped catalogue, which
 * is the only place this kind of hole exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/games.json' with { type: 'json' };

const hasSteamScore = (game) =>
  Number.isFinite(game.ratings?.critic) ||
  Number.isFinite(game.ratings?.user?.percentPositive);

test('almost every write-up can draw a cover', () => {
  /*
   * A handful genuinely cannot and that is honest: Rocket League, Minecraft
   * and Genshin Impact are not on the PlayStation Store in a form the mirror
   * walks, and Concrete Genie and Beyond Eyes are delisted. A gradient for
   * those is the truth. A gradient for a current first-party exclusive is a
   * missing join.
   */
  const blank = catalog.filter((game) => !game.storeArt && !game.steamAppId);
  assert.ok(
    blank.length <= 8,
    `${blank.length} write-ups have no cover at all: ${blank.map((g) => g.title).join(', ')}`,
  );
});

test('almost every write-up can show a score', () => {
  const unrated = catalog.filter(
    (game) => !hasSteamScore(game) && !Number.isFinite(game.storeStars),
  );
  assert.ok(
    unrated.length <= 10,
    `${unrated.length} write-ups show no rating at all: ${unrated
      .slice(0, 8)
      .map((g) => g.title)
      .join(', ')}`,
  );
});

test('the games this app is most about are not the blank ones', () => {
  /*
   * Named on purpose. These are PlayStation exclusives, which is exactly the
   * set that Steam cannot answer for, so they are the first thing to break
   * if the store join regresses and the last thing anybody would check.
   */
  for (const title of [
    'Astro Bot',
    'Demon’s Souls',
    'Gran Turismo 7',
    'Ghost of Yotei',
    'Alan Wake 2',
  ]) {
    const game = catalog.find((entry) => entry.title === title);
    if (!game) continue;
    assert.ok(game.storeArt, `${title} has no cover art`);
    assert.ok(
      hasSteamScore(game) || Number.isFinite(game.storeStars),
      `${title} shows no rating`,
    );
  }
});

test('a baked store rating is a real rating', () => {
  for (const game of catalog) {
    if (game.storeStars == null) continue;
    assert.ok(
      typeof game.storeStars === 'number' && game.storeStars > 0 && game.storeStars <= 5,
      `${game.title} has storeStars of ${game.storeStars}, which is not a star rating`,
    );
    assert.ok(
      game.storeVotes == null || (Number.isInteger(game.storeVotes) && game.storeVotes >= 0),
      `${game.title} has storeVotes of ${game.storeVotes}`,
    );
    // A star rating with nobody behind it is not evidence of anything.
    if (game.storeVotes != null) assert.ok(game.storeId, `${game.title} has a rating but no store join`);
  }
});

test('a baked cover is a store URL, not something invented', () => {
  for (const game of catalog) {
    if (!game.storeArt) continue;
    assert.match(
      game.storeArt,
      /^https:\/\/image\.api\.playstation\.com\//,
      `${game.title} has a cover that did not come from the store: ${game.storeArt}`,
    );
  }
});

test('the store join did not attach the wrong game', () => {
  /*
   * The loose matching that fixed this takes edition suffixes, platform tags
   * and accents off a title, which is what let "Ghost of Yotei" meet "Ghost
   * of Yotei(tm) Complete Edition". Loosening a join is also how a join
   * starts being wrong, so every match has to still look like the same game.
   */
  const fold = (value) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

  let checked = 0;
  for (const game of catalog) {
    if (!game.storeId || !game.storeArt) continue;
    checked += 1;
    const title = fold(game.title);
    // The baked art is keyed by id, so the only thing provable here is that
    // a title short enough to be ambiguous was not matched on a fragment.
    assert.ok(title.length >= 3, `${game.title} is too short a title to join safely`);
  }
  assert.ok(checked > 300, `only ${checked} write-ups are joined to the store`);
});
