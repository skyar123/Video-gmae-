/**
 * What is worth talking about right now.
 *
 * Reported in one sentence: "I don't love seeing cod everytime I open the
 * app." The shelf ranked recent releases by vote count, and that is not a
 * measure of interest, it is a measure of how many people own something.
 * Modern Warfare 4 carries 734,343 ratings against 64,488 for the next game
 * and is rated 3.9 stars, so it won that ranking permanently and the
 * opening screen became a photograph.
 *
 * The fix is that scale is not a ranking term any more. These tests exist
 * mostly to keep it that way, because putting it back would look like an
 * improvement: it is the number that makes a shelf full of famous games.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldKey, rankTrending, standing } from '../api/trending.mjs';

const NOW = Date.parse('2026-11-16T00:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();
const daysAhead = (n) => new Date(NOW + n * 86_400_000).toISOString();

const game = (title, extra = {}) => ({
  id: title,
  title,
  publisher: `${title} Publishing`,
  stars: 4,
  votes: 400,
  releaseDate: daysAgo(10),
  ...extra,
});

test('the biggest game in the world does not win by being the biggest', () => {
  /*
   * The whole report, as a test. Both came out the same week; one has a
   * hundred times the ratings and a worse score. Under the old ranking the
   * giant was first every day for ninety days.
   */
  const giant = game('Call of Duty', { votes: 734_343, stars: 3.9 });
  const small = game('A Small Good Game', { votes: 900, stars: 4.7 });
  const shelf = rankTrending({ recent: [giant, small], now: NOW });
  assert.equal(shelf[0].game.title, 'A Small Good Game', 'the vote count still decided it');
});

test('the press outranks everything, because it is the only live signal', () => {
  const quiet = game('Quiet Blockbuster', { votes: 500_000, stars: 4.5, releaseDate: daysAgo(2) });
  const talked = game('Talked About', { votes: 12, stars: 3.5, releaseDate: daysAgo(40) });
  const news = new Map([[foldKey('Talked About'), 3]]);

  const shelf = rankTrending({ recent: [quiet, talked], news, now: NOW });
  assert.equal(shelf[0].game.title, 'Talked About');
  assert.match(shelf[0].why, /3 stories/);
});

test('games nobody can buy yet are on the shelf', () => {
  /*
   * Asked for directly, and the part a storefront is worst at: a game with
   * no release has no sales rank, so every popularity ranking is blind to
   * it however large it is.
   */
  const out = game('Already Out', { releaseDate: daysAgo(30) });
  const soon = game('Not Out Yet', { releaseDate: daysAhead(3), votes: 0, stars: 0 });
  const shelf = rankTrending({ recent: [out], upcoming: [soon], now: NOW });

  const titles = shelf.map((entry) => entry.game.title);
  assert.ok(titles.includes('Not Out Yet'), 'an upcoming game was left off');
  assert.equal(shelf.find((e) => e.game.title === 'Not Out Yet').why, 'Out in 3 days');
  // A game three days out beats one a month old.
  assert.equal(shelf[0].game.title, 'Not Out Yet');
});

test('an announcement with no date still counts, but counts less', () => {
  const dated = game('Dated', { releaseDate: daysAhead(20), votes: 0 });
  const someday = game('Someday', { releaseDate: null, votes: 0 });
  const shelf = rankTrending({ upcoming: [dated, someday], now: NOW });
  const titles = shelf.map((e) => e.game.title);
  assert.ok(titles.includes('Someday'), 'a dateless announcement vanished');
  assert.ok(
    titles.indexOf('Dated') < titles.indexOf('Someday'),
    'a dateless game outranked one with a date',
  );
  assert.match(shelf.find((e) => e.game.title === 'Someday').why, /no date/i);
});

test('one publisher cannot own the screen', () => {
  /*
   * Beating the vote count alone does not fix the complaint. A big
   * publisher ships several things at once, so without this the shelf can
   * still be five games from one company, which reads exactly the same way.
   */
  const many = [];
  // Freshest, so they would sweep the top on merit alone.
  for (let i = 0; i < 6; i += 1) {
    many.push(game(`Huge ${i}`, { publisher: 'One Big Publisher', releaseDate: daysAgo(1) }));
  }
  const others = [];
  for (let i = 0; i < 6; i += 1) {
    others.push(game(`Someone Else ${i}`, { publisher: `Indie ${i}`, releaseDate: daysAgo(20) }));
  }
  /*
   * Enough choice for the cap to be a real decision. An earlier version of
   * this gave it seven candidates and asked for four, where the cap and the
   * rule that a thin week still fills the shelf genuinely conflict, so it
   * was testing the scarce case while claiming to test the ordinary one.
   */
  const shelf = rankTrending({ recent: [...many, ...others], now: NOW, limit: 6 });

  const fromBig = shelf.filter((e) => e.game.publisher === 'One Big Publisher').length;
  assert.ok(fromBig <= 2, `${fromBig} of 6 came from one publisher`);
  assert.ok(shelf.length === 6, 'the shelf came up short');
});

test('a thin week still fills the shelf', () => {
  // The publisher cap holds entries back; it must not throw them away, or a
  // quiet week would leave the opening screen half empty.
  const many = [];
  for (let i = 0; i < 8; i += 1) {
    many.push(game(`Only ${i}`, { publisher: 'The Only Publisher', releaseDate: daysAgo(3) }));
  }
  const shelf = rankTrending({ recent: many, now: NOW, limit: 6 });
  assert.equal(shelf.length, 6, 'the cap emptied the shelf instead of ordering it');
});

test('stale and unremarked is not trending', () => {
  const old = game('Old News', { releaseDate: daysAgo(400) });
  const fresh = game('Fresh', { releaseDate: daysAgo(3) });
  const shelf = rankTrending({ recent: [old, fresh], now: NOW });
  assert.deepEqual(shelf.map((e) => e.game.title), ['Fresh']);

  // Unless somebody is writing about it, which is the point of the shelf.
  const withNews = rankTrending({
    recent: [old, fresh],
    news: new Map([[foldKey('Old News'), 2]]),
    now: NOW,
  });
  assert.ok(withNews.some((e) => e.game.title === 'Old News'));
});

test('a rating is only trusted once enough people have voted', () => {
  /*
   * The one place a vote count is read at all, and it can only ever make a
   * game less certain, never more prominent.
   */
  assert.ok(standing(5, 4) < standing(5, 1000), 'four votes counted as much as a thousand');
  assert.ok(standing(5, 1000) > standing(3, 1000));
  // Unrated sits in the middle rather than at the bottom: unknown is not bad.
  assert.equal(standing(0, 0), 0.5);
  assert.equal(standing(null, null), 0.5);
});

test('the same game is not listed twice', () => {
  const both = game('In Both Lists', { releaseDate: daysAhead(2) });
  const shelf = rankTrending({ recent: [both], upcoming: [both], now: NOW });
  assert.equal(shelf.length, 1);
});
