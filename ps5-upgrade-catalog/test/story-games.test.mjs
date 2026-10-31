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
