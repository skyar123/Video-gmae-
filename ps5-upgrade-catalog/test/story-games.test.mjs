/**
 * Every rule in the matcher is here because of a headline it got wrong.
 *
 * These are not invented cases: each one is a real story from the live feed
 * that produced a wrong link while this was being built. A link to the wrong
 * game is worse than no link, because a reader cannot tell it is wrong until
 * they have followed it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTitleIndex, findGameInStory, foldTitle } from '../api/story-games.mjs';

const index = buildTitleIndex([
  { name: 'Among Us' },
  { name: 'Celeste' },
  { name: 'FINAL FANTASY' },
  { name: 'Goblins' },
  { name: 'No Man’s Sky' },
  { name: 'Phantom Blade Zero' },
  { name: 'SuperPower' },
  { name: 'The Backrooms' },
  { name: 'The Rise' },
  { name: 'The Sims 4' },
  { name: 'Silent Hill: Townfall' },
  { name: 'Lake' },
  { name: 'Dispatch' },
  { name: 'Spider-Man 2', curated: true, id: 'spider-man-2' },
  { name: 'Spider-Man 2' },
]);

const found = (text) => findGameInStory(text, index)?.name ?? null;

test('a story about a game finds it', () => {
  assert.equal(found('Wooshy wuxia actioner Phantom Blade Zero is sharp enough'), 'Phantom Blade Zero');
  assert.equal(found('Silent Hill: Townfall adds new Hard difficulty in latest patch'), 'Silent Hill: Townfall');
  assert.equal(found('Indie developer Maddy Makes Games has delisted Celeste'), 'Celeste');
  assert.equal(found('The Sims 4 Flash Sale 2026: Limited Deals'), 'The Sims 4');
});

test('the tail of a longer name is not a game', () => {
  // The headline that produced this: a review of The Wolf Among Us Remastered
  // filed under Among Us.
  assert.equal(found('Austin recommends: The Wolf Among Us Remastered (Review)'), null);
  assert.equal(found("Feature: The Haunting History Of Capcom's Ghosts 'n Goblins"), null);
});

test('a numbered entry is not the game it is numbered after', () => {
  assert.equal(found('Final Fantasy 14 reveals a second new job'), null);
  assert.equal(found("Final Fantasy XIV Online's Sixth Expansion Launches February"), null);
  assert.equal(found('FINAL FANTASY is thirty eight years old today'), 'FINAL FANTASY');
});

test('an ordinary word is not a game', () => {
  // "voting is a true superpower" was being filed under the game SuperPower.
  assert.equal(found('NerdsVote reminds us that voting is a true superpower'), null);
  assert.equal(found('We went down to the lake and the peak beyond it'), null);
  assert.equal(found('The Rise of Eastern Game Studios Is INSANE'), null);
  // Capitalised, it is the game again.
  assert.equal(found('SuperPower is getting a sequel'), 'SuperPower');
});

test('titles too short or too plain are never indexed', () => {
  // Lake and Dispatch are real games and ordinary words; they are left out
  // rather than matched, because prose cannot be told from a name.
  assert.equal(found('Lake is a lovely game'), null);
  assert.equal(found('Dispatch is out now'), null);
  assert.equal(found('The Backrooms is out now'), 'The Backrooms');
});

test('a written-up game wins over a mirror row of the same name', () => {
  assert.equal(findGameInStory('Spider-Man 2 swings onto PS5', index)?.id, 'spider-man-2');
});

test('folding puts punctuation aside', () => {
  assert.equal(foldTitle("Marvel's Spider-Man 2"), 'marvels spider man 2');
  assert.equal(foldTitle('NieR: Automata'), 'nier automata');
});

test('nothing in the story means nothing is claimed', () => {
  assert.equal(found('Sony is ending physical media'), null);
  assert.equal(found(''), null);
  assert.equal(found(null), null);
});

test('the apostrophe cuts both ways', () => {
  /*
   * Two things that look alike and pull in opposite directions: a game whose
   * own name holds a possessive, and a headline that puts a game into the
   * possessive. One folding cannot serve both, so the story is read twice.
   *
   * Measured on a live day before this existed: two of the dozen-odd
   * headlines that name a game at all were lost to it, which is most of a
   * sixth of the join.
   */
  const both = buildTitleIndex([
    { name: 'Dispatch' },
    { name: 'Silent Hill: Townfall' },
    { name: 'CONTROL Resonant' },
    { name: 'Helldivers 2' },
    { name: 'Baldur’s Gate 3' },
    { name: 'No Man’s Sky' },
  ]);
  const seen = (text) => findGameInStory(text, both)?.name ?? null;

  // A headline writing the game possessively.
  assert.equal(
    seen("Silent Hill: Townfall's new patch adds a Hard difficulty"),
    'Silent Hill: Townfall',
  );
  assert.equal(seen("Half of Control Resonant's players were 'new' to the franchise"), 'CONTROL Resonant');
  assert.equal(seen("Helldivers 2's Ever-Changing Universe Evolves Again"), 'Helldivers 2');

  // And a game whose name is a possessive, which the other folding would eat.
  assert.equal(seen('Baldur’s Gate 3 patch 9 arrives next week'), 'Baldur’s Gate 3');
  assert.equal(seen('No Man’s Sky adds another free update'), 'No Man’s Sky');
  assert.equal(seen("Baldur’s Gate 3's next patch arrives"), 'Baldur’s Gate 3');

  /*
   * And reading the story twice does not reach past the other rules. The
   * catalog really does contain a game called Dispatch, and the word is
   * ordinary, so it is never indexed at all: a second folding gives the
   * matcher another way to read a headline, not another title to match.
   */
  assert.equal(seen("Dispatch's Free 'HR Violations Pack' DLC Removes Censorship"), null);
});

test('a title whose own first word holds an apostrophe is findable at all', () => {
  /*
   * The guards read the untouched headline to check capitalisation, and they
   * used to find their place in it by searching for the *folded* first word.
   * Folding removes the punctuation the headline still has, so "baldurs"
   * was looked for in "Baldur's" and never found. Of the catalog's 9,728
   * titles, 200 begin with a word carrying an apostrophe, and 199 of them
   * could not be matched even by a sentence that named them outright.
   */
  const index = buildTitleIndex([
    { name: "Croc's World 5" },
    { name: 'Tyrant’s Realm' },
    { name: "Bluey's Quest for the Gold Pen" },
    { name: "Manny's" },
  ]);
  const seen = (text) => findGameInStory(text, index)?.name ?? null;

  assert.equal(seen("Croc's World 5 is out now on PS5"), "Croc's World 5");
  assert.equal(seen('Tyrant’s Realm gets a new patch'), 'Tyrant’s Realm');
  assert.equal(seen("Bluey's Quest for the Gold Pen tops the chart"), "Bluey's Quest for the Gold Pen");
  // Written without its apostrophe, which the second key now also catches.
  assert.equal(seen('Crocs World 5 is out now on PS5'), "Croc's World 5");

  /*
   * And the apostrophes that are not possessives, which the second key
   * cannot help with at all: nothing to strip, so the only thing standing
   * between "blastn" and "Blast'N" is a lookup that tolerates the
   * punctuation. Twenty-four of the two hundred are this shape, and the
   * first version of this test missed every one of them: reverting the
   * lookup on its own broke nothing here until these were added.
   */
  const odd = buildTitleIndex([
    { name: "Blast'N Bounty" },
    { name: "I'm Having A Bad Day" },
    { name: "Don't Mess With Bober" },
    { name: 'Mate’Morphosis' },
  ]);
  const odds = (text) => findGameInStory(text, odd)?.name ?? null;
  assert.equal(odds("Blast'N Bounty is out now on PS5"), "Blast'N Bounty");
  assert.equal(odds("I'm Having A Bad Day gets a demo"), "I'm Having A Bad Day");
  assert.equal(odds("Don't Mess With Bober hits PS5 next month"), "Don't Mess With Bober");
  assert.equal(odds('Mate’Morphosis is out now on PS5'), 'Mate’Morphosis');

  /*
   * And the 200th, which stays unmatched on purpose: "Manny's" folds to six
   * characters, under the length below which a title is a coincidence
   * waiting to happen. Fixing the lookup was never going to reach it, and it
   * should not.
   */
  assert.equal(seen("Manny's is out now on PS5"), null);
});
