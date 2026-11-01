/**
 * Every headline here is a real one from the live feed.
 *
 * The mistakes are asymmetric, as everywhere in this feed. A missed guide
 * costs a reader one filler headline they scroll past. A wrongly flagged
 * story is pushed a day down the Top column, and the writing most at risk is
 * the essayistic kind the small press is carried for: the first version of
 * this was a list of words, and the words caught exactly that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGuide } from '../api/guides.mjs';
import day from './fixtures/press-day.json' with { type: 'json' };

test('a walkthrough is a guide however the headline opens', () => {
  for (const title of [
    'Complete Probably Stolen walkthrough: Week 1',
    'Guide: These 28+ PS5 and PS Plus Games Are Coming Out Next Week (2nd-8th November)',
    'Sweet Surprises Halloween Pokopia Event Guide',
    'A 100 Percent Complete Guide To Finishing Stardew Valley',
    'All weapons in Queen’s Domain and how to find them',
    'All Status Effects in Queen’s Domain explained',
    'All Pirate Chest loot and rewards in Fortnite Treasure Hunters',
    'All Choices To Get Every Ending For Keira Metz In The Witcher 3',
    'Should You Kill John Verdun Or Take His Coin In The Witcher 3',
    'BLEACH Mirrors High character tier list',
    'Inazuma Eleven: Victory Road Gift Codes and How To Redeem Them',
    'Expanding Building With The Sims 3 Build Cheats, Markers, And More!',
    'Best players for FC 27’s Two Faces of Fear Evolution',
  ]) {
    assert.ok(isGuide(title), `missed: ${title}`);
  }
});

test('the three it used to get wrong', () => {
  /*
   * Each of these was flagged by a word list and is the reason the matching
   * rule is narrower than the word that caught it.
   */
  assert.equal(
    isGuide('Valve Knows How To Run A Shopfront But Does Not Know How, Or Does Not Want To Be, The Custodian Of PC Gaming'),
    false,
    'an essay, caught by a bare "how to"',
  );
  assert.equal(
    isGuide('GDC Side Quest - An anti-cheat primer with Lucia Suarez'),
    false,
    'a conference talk, caught by "cheat" inside "anti-cheat"',
  );
  assert.equal(
    isGuide('Every animal has its place in ‘Tidy Up the Ark’'),
    false,
    'an indie feature, caught by "Every ... in"',
  );
});

test('news that happens to sound like a guide is not one', () => {
  for (const title of [
    'John Romero’s canceled game finds a new publisher amidst an overall scope change',
    'The Video Games And More You Should Play This Weekend – October 30, 2026',
    'I Love Amy Manhwa Works Through All the Trauma Before the Climax',
    'How Nintendo Rebuilt Ocarina Of Time From The Ground Up',
    'Rockstar had to up its game for GTA 6',
    'EA Reportedly Chose An Unannounced Star Wars Game Over BioWare’s Next Mass Effect',
  ]) {
    assert.equal(isGuide(title), false, `wrongly flagged: ${title}`);
  }
});

test('on a real day it flags about a tenth of the press, and nothing else', () => {
  /*
   * The count is here to catch the rule set drifting in either direction: a
   * change that suddenly flags a third of the feed is over-reaching, and one
   * that flags nothing has stopped working. The window is wide because which
   * stories a given day carries is not this file's business.
   */
  const flagged = day.filter((row) => isGuide(row.title));
  assert.ok(
    flagged.length >= 8 && flagged.length <= 20,
    `${flagged.length} of ${day.length} flagged, which is outside what this day should give`,
  );

  /*
   * And the twelve it flags on that day, by headline, because every one was
   * read and judged by hand. Naming them rather than counting them is what
   * makes this a check: a count says a dozen things changed places, a list
   * says which.
   */
  assert.deepEqual(flagged.map((row) => row.title).sort(), [
    'A 100 Percent Complete Guide To Finishing Stardew Valley',
    'All Status Effects in Queen’s Domain explained',
    'All weapons in Queen’s Domain and how to find them',
    'Best players for FC 27’s Two Faces of Fear Evolution',
    'COD MW4 Multiplayer: Halloween event, Possession playlist, milsim explained',
    'Complete Probably Stolen walkthrough: Week 1',
    'Expanding Building With The Sims 3 Build Cheats, Markers, And More!',
    'Guide: These 28+ PS5 and PS Plus Games Are Coming Out Next Week (2nd-8th November)',
    'Inazuma Eleven: Victory Road Gift Codes and How To Redeem Them',
    "Meet Marvel Tokon's Newest Fighting Soul in Full Phoenix Cyclops Character Guide",
    'Sweet Surprises Halloween Pokopia Event Guide',
    'The Best Commander Precons For MTG',
  ].sort());
});

test('nothing is hidden by it: the flag is a flag', () => {
  // isGuide answers a question and removes nothing. Where a guide sits is
  // src/feed-rank.js's business, and it only moves it within Top.
  assert.equal(typeof isGuide('anything'), 'boolean');
  assert.equal(isGuide(null), false);
  assert.equal(isGuide(undefined), false);
  assert.equal(isGuide(''), false);
});
