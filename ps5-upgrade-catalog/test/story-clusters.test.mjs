/**
 * Everything here is judged inside a real day of the feed.
 *
 * The clusterer weighs a word by how few other stories used it, so it cannot
 * say anything useful about two headlines handed to it on their own: with no
 * feed behind them it has no idea which of their words are ordinary. The
 * first version of this file asserted on bare pairs and every test failed for
 * that reason, which is the right answer to the wrong question.
 *
 * So test/fixtures/press-day.json is a real capture: 101 press headlines from
 * 1 November 2026, the day this was built, with every source and time as
 * published. Of those, eighteen stories were six events. Every pile and every
 * refusal below was read and judged by hand against that day, and the
 * threshold was chosen by looking at all seventeen pairs the rules could
 * make, not by picking a number.
 *
 * The mistakes are asymmetric, which is why the refusals outnumber the piles
 * here. A missed pile costs a reader one duplicate headline, which they can
 * see and ignore. A wrong merge hides a story, and nothing on the screen says
 * so: you cannot notice what you were not shown.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLUSTER_RULES,
  evidenceOf,
  groupStories,
  stem,
  tagStories,
} from '../api/story-clusters.mjs';
import { foldStories } from '../src/story-fold.js';
import day from './fixtures/press-day.json' with { type: 'json' };

const asBursts = (rows) => rows.map((row) => ({ ...row, heat: 0, channel: 'press' }));
const DAY = asBursts(day);

/** The one story whose headline contains this, so a test can name it in English. */
const find = (rows, fragment) => {
  const at = rows.findIndex((row) => row.title.includes(fragment));
  assert.notEqual(at, -1, `no story in the fixture matching "${fragment}"`);
  return at;
};

const pilesOf = (rows) => {
  const { piles } = groupStories(rows);
  return piles.filter((pile) => pile.length > 1);
};

/** Did these two end up in the same pile, by any route? */
const together = (rows, left, right) => {
  const a = find(rows, left);
  const b = find(rows, right);
  return pilesOf(rows).some((pile) => pile.includes(a) && pile.includes(b));
};

/**
 * Were these two joined to each other directly?
 *
 * Distinct from `together`, and both are needed. The Final Fantasy pile holds
 * five stories because each is joined to some other one, so asking whether
 * two of them share a pile cannot tell you whether the rules think *those
 * two* are the same story. The refusals below are about the direct judgement.
 */
const directlyJoined = (rows, left, right) => {
  const a = find(rows, left);
  const b = find(rows, right);
  return groupStories(rows).joins.some(
    (join) =>
      (join.left === a && join.right === b) || (join.left === b && join.right === a),
  );
};

test("the day's six events", () => {
  const piles = pilesOf(DAY);
  assert.equal(piles.length, 6);
  assert.equal(
    piles.reduce((count, pile) => count + pile.length, 0),
    18,
    '18 of the day\'s 101 stories were repeats of six things',
  );

  // The day's biggest story, from four outlets, is one card.
  const ea = piles.find((pile) => pile.includes(find(DAY, 'Over BioWare’s Next Mass Effect')));
  assert.deepEqual(
    ea.map((at) => DAY[at].source).sort(),
    ['GameSpot', 'Game Developer', 'Game Informer', 'VGC'].sort(),
  );
});

test('the possessive comes off before the stemmer gets to it', () => {
  /*
   * "BioWare’s" and "BioWare" have to meet. Folding the apostrophe away
   * first left "biowares", which the stemmer cut to "biowar" while a plain
   * "BioWare" stayed "bioware", so the one word that identifies the story
   * was dropped from every headline that happened to write it possessively.
   *
   * This is asserted on the words rather than on the pile, because the pile
   * is the wrong evidence: removing the fix and re-running the real day
   * showed the four EA reports still grouping, through Game Informer, which
   * writes it both ways. What the bug cost was the strength of the grouping,
   * not the grouping itself, and a test that claimed otherwise would be
   * claiming more than was measured.
   */
  assert.ok(evidenceOf('BioWare’s next game').includes('bioware'));
  assert.ok(evidenceOf('BioWare shut down').includes('bioware'));
  assert.equal(stem('leaks'), 'leak');
  assert.equal(stem('leaked'), 'leak');
});

test('agreeing only on the game is not the same story', () => {
  /*
   * The merge that matters most, and the one that needs no catalog to spot.
   * Phantom Blade Zero turned up four times in this day: an interview about
   * one of its areas, a podcast recommending it, its lead voice actor being
   * replaced, and a Steam key bundle mentioning it in passing. Every pair
   * shares the name, said the same way round, and nothing else.
   */
  assert.equal(
    directlyJoined(DAY, 'What Inspired Phantom Blade Zero', 'GI Podcast: Phantom Blade Zero'),
    false,
  );
  assert.equal(
    directlyJoined(DAY, 'What Inspired Phantom Blade Zero', 'Lead Voice Actor Was Seemingly Replaced'),
    false,
  );
  assert.equal(
    together(DAY, 'What Inspired Phantom Blade Zero', 'GI Podcast: Phantom Blade Zero'),
    false,
  );

  // And this pair is why the guard cannot be built on the matched game name:
  // the catalog is PlayStation only, so it has never heard of either.
  assert.equal(
    directlyJoined(DAY, 'Zelda: Ocarina Of Time Dungeon Crawl', 'Highlights Eight New Things'),
    false,
  );
  assert.equal(together(DAY, 'Zelda: Ocarina Of Time Dungeon Crawl', 'Highlights Eight New Things'), false);

  // Two beats of one expansion that are not the same beat: a new job, and a
  // delay. Both headlines open with the same four words and share nothing
  // after them. They do share a pile, because each is joined to the
  // announcement itself, which is the correct route to it.
  assert.equal(directlyJoined(DAY, 'second job is the ranged Zephyr', 'gets a four week delay'), false);
});

test('a shared date is not a shared story', () => {
  // Three outlets run a what-are-you-playing column every weekend, and on
  // this day the calendar was the only thing holding them together.
  assert.equal(together(DAY, 'Something for the Weekend', 'What Are You Playing This Weekend'), false);
  assert.equal(together(DAY, 'Something for the Weekend', 'You Should Play This Weekend'), false);
  assert.equal(evidenceOf('Launches February 23, 2027').length, 0);
});

test('two ordinary words in common are not coverage', () => {
  assert.equal(together(DAY, 'Crimson Desert DLC', 'Stage Tour lays out its route map'), false);
  assert.equal(together(DAY, 'Halloween Pokopia Event Guide', 'COD MW4 Multiplayer: Halloween event'), false);
  assert.equal(together(DAY, 'Trio of Japanese Devs', 'Horror Devs Think You'), false);
  assert.equal(together(DAY, 'Free Open World Game to Your Rotation', 'As Below so Above Free Update'), false);
});

test('the same facts in a different order are the same story', () => {
  // The flip side, and why the rule is about order rather than about names:
  // each of these outlets wrote its own sentence.
  assert.ok(together(DAY, 'Shigeru Miyamoto Proclaims', 'Shigeru Miyamoto Declares'));
  assert.ok(together(DAY, 'Shigeru Miyamoto Declares', "Nintendo Drops Surprise 'Pikmin Day' Direct"));
  assert.ok(together(DAY, 'Alleged Persona 1 Remake Gameplay Leaks', 'Persona 1 Remake Trailer Has Seemingly Leaked'));
  assert.ok(together(DAY, 'Cut Real-Life Korean Tragedy', 'remove South Korean crush footage'));
  assert.ok(together(DAY, 'Over BioWare’s Next Mass Effect', 'in favor of Star Wars: Battlefront sequel'));
});

test('the threshold still decides the same way on a thinner day', () => {
  /*
   * A word's weight depends on how many other stories used it, so the
   * scores move when the feed does, and a threshold that only works at
   * exactly 101 headlines is a threshold tuned to one afternoon.
   *
   * So the same day is cut roughly in half, keeping real headlines rather
   * than invented filler, because invented filler shares none of the
   * ordinary vocabulary that makes the hard calls hard. Every decision above
   * has to come out the same.
   */
  const keep = new Set(pilesOf(DAY).flat());
  // The stories these assertions name, so thinning cannot quietly remove the
  // very pairs under test and pass by default.
  for (const fragment of [
    'Crimson Desert DLC',
    'Stage Tour lays out its route map',
    'What Inspired Phantom Blade Zero',
    'GI Podcast: Phantom Blade Zero',
  ]) {
    keep.add(find(DAY, fragment));
  }
  const thin = asBursts(day.filter((_, at) => keep.has(at) || at % 2 === 0));
  assert.ok(thin.length < 70 && thin.length > 45, `thinned to ${thin.length}`);

  assert.equal(pilesOf(thin).length, 6);
  assert.ok(together(thin, 'Shigeru Miyamoto Proclaims', 'Shigeru Miyamoto Declares'));
  assert.ok(together(thin, 'Over BioWare’s Next Mass Effect', 'in favor of Star Wars: Battlefront sequel'));
  assert.equal(together(thin, 'Crimson Desert DLC', 'Stage Tour lays out its route map'), false);
  assert.equal(
    together(thin, 'What Inspired Phantom Blade Zero', 'GI Podcast: Phantom Blade Zero'),
    false,
  );
});

test('coverage days apart is a follow-up, not coverage', () => {
  const moved = DAY.map((burst) =>
    burst.title.includes('remove South Korean crush footage')
      ? { ...burst, publishedAt: '2026-11-08T09:00:00.000Z' }
      : burst,
  );
  assert.equal(together(moved, 'Cut Real-Life Korean Tragedy', 'remove South Korean crush footage'), false);
  assert.ok(CLUSTER_RULES.windowHours < 24 * 7);
});

test('a pile is named after its earliest member, and nothing else is tagged', () => {
  const tagged = tagStories(DAY);
  const pile = pilesOf(DAY).find((rows) => rows.includes(find(DAY, 'Shigeru Miyamoto Declares')));
  const earliest = [...pile].sort(
    (a, b) => new Date(DAY[a].publishedAt) - new Date(DAY[b].publishedAt),
  )[0];

  for (const at of pile) assert.equal(tagged[at].story, DAY[earliest].link);
  assert.equal(
    tagged[find(DAY, 'IGN Is Not A Monolith')].story,
    undefined,
    'a story on its own is left alone',
  );
  assert.equal(tagged.filter((burst) => burst.story).length, 18);
});

test('the view folds a tagged pile into one card, in place', () => {
  const tagged = tagStories(DAY);
  const cards = foldStories(tagged);

  assert.equal(cards.length, DAY.length - 12, 'six piles of 18 become six cards');
  const ea = cards.find((card) => card.title.includes('Over BioWare’s Next Mass Effect'));
  assert.deepEqual(
    ea.also.map((row) => row.source).sort(),
    ['Game Developer', 'Game Informer', 'VGC'],
  );
  // The face of each card is the first member of the pile in the list as
  // given, and the cards stay in that order, so folding changes what is on a
  // card and never where the card is.
  const wasAt = cards.map((card) => tagged.findIndex((burst) => burst.link === card.link));
  assert.deepEqual(wasAt, [...wasAt].sort((a, b) => a - b));
  assert.equal(
    ea.link,
    tagged.find((burst) => burst.story === ea.story).link,
    'the earliest-listed member of the pile is the face',
  );
});

test('a pile whose other members were filtered out reads as an ordinary story', () => {
  // Every shelf filter runs before the fold, so this is the normal case for
  // any narrowed view: one survivor of a pile must not claim coverage it
  // cannot show.
  const tagged = tagStories(DAY);
  const alone = tagged.filter(
    (burst) => !burst.story || burst.title.includes('Over BioWare’s Next Mass Effect'),
  );
  const cards = foldStories(alone);
  const ea = cards.find((card) => card.title.includes('Over BioWare’s Next Mass Effect'));
  assert.equal(ea.also, undefined);
});
