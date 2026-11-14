/**
 * Searching for a kind of game rather than for a name.
 *
 * Asked for directly: "if I search boardgames it shows me board game
 * games, instead of showing me just game titles that [match]". Typing
 * "board" returned Longboard Skate Downhill Simulator and Cool Boarders,
 * which is a string match doing exactly what it was told and nothing a
 * person meant.
 *
 * The risk in fixing that is the opposite failure. A concept that fires
 * on part of a phrase would bury a game somebody named, and a concept
 * that guesses at what a game is like would make things up. So the tests
 * that matter most here are the ones about restraint: whole-query only,
 * and labels only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONCEPTS, conceptFor, matchesConcept } from '../api/concepts.mjs';

test('the words people use reach the vocabulary the data has', () => {
  assert.equal(conceptFor('horror')?.id, 'horror');
  assert.equal(conceptFor('scary')?.id, 'horror');
  assert.equal(conceptFor('rpg')?.id, 'rpg');
  assert.equal(conceptFor('role playing')?.id, 'rpg');
  assert.equal(conceptFor('racing')?.id, 'racing');
  assert.equal(conceptFor('metroidvania')?.id, 'metroidvania');
  assert.equal(conceptFor('cozy')?.id, 'cozy');
  assert.equal(conceptFor('cosy')?.id, 'cozy');
});

test('spelling it as one word or two is the same question', () => {
  // "boardgames" is how it was typed in the report.
  assert.equal(conceptFor('board games')?.id, 'board');
  assert.equal(conceptFor('boardgames')?.id, 'board');
  assert.equal(conceptFor('board game')?.id, 'board');
  assert.equal(conceptFor('Board Games')?.id, 'board');
  assert.equal(conceptFor('tabletop')?.id, 'board');
});

test('a concept answers the whole query or not at all', () => {
  /*
   * The dangerous direction. Somebody typing "Horizon Forbidden West"
   * has named a game; firing the Action concept because the phrase
   * contains a word would bury the thing they typed under two thousand
   * games. So a concept is matched against the whole query.
   */
  assert.equal(conceptFor('horizon forbidden west'), null);
  assert.equal(conceptFor('resident evil horror'), null);
  assert.equal(conceptFor('my cozy little game'), null);
  assert.equal(conceptFor('racing game i cannot remember'), null);

  // And a fragment is not a question.
  assert.equal(conceptFor('ho'), null);
  assert.equal(conceptFor(''), null);
  assert.equal(conceptFor(null), null);
});

test('a kind is read off a label, never guessed from a title', () => {
  const horror = conceptFor('horror');
  // The store's own genre.
  assert.ok(matchesConcept({ name: 'Some Game', genres: ['Horror'] }, horror));
  // Not the word appearing in a name.
  assert.ok(!matchesConcept({ name: 'Horror Themed Puzzle', genres: ['Puzzle'] }, horror));
});

test('both halves of the catalogue are reachable', () => {
  // The store's broad genres.
  assert.ok(matchesConcept({ name: 'A', genres: ['Driving/Racing'] }, conceptFor('cars')));
  // A write-up's sharper genre, which is a single string, not a list.
  assert.ok(matchesConcept({ title: 'B', genre: 'Metroidvania' }, conceptFor('metroidvania')));
  assert.ok(matchesConcept({ title: 'C', genre: 'Deckbuilder' }, conceptFor('card games')));
  // And a write-up's mood tags.
  assert.ok(matchesConcept({ title: 'D', tags: ['cozy'] }, conceptFor('relaxing')));
  assert.ok(matchesConcept({ title: 'E', tags: ['queer'] }, conceptFor('lgbtq')));
});

test('board games are a list, because the store has no genre for them', () => {
  /*
   * PlayStation publishes 23 genres and none of them is Board, so this
   * is the one concept backed by names. Hand-written and checked
   * against the index rather than inferred, because inferring it from
   * the word is what was already wrong.
   */
  const board = conceptFor('board games');
  assert.ok(matchesConcept({ name: 'MONOPOLY Madness' }, board));
  assert.ok(matchesConcept({ name: 'CATAN® - Console Edition' }, board));
  assert.ok(matchesConcept({ name: 'Chess Mate' }, board));
  assert.ok(matchesConcept({ name: 'Mouse Trap - The Board Game' }, board));

  // The exact games the old string match returned, which are not board
  // games and are the reason this concept is a list.
  assert.ok(!matchesConcept({ name: 'Longboard Skate Downhill Simulator' }, board));
  assert.ok(!matchesConcept({ name: 'Console Archives Cool Boarders' }, board));
  assert.ok(!matchesConcept({ name: 'Snowboarding: The Next Phase' }, board));
});

test('nothing in the vocabulary is empty or duplicated', () => {
  // A concept with no labels behind it can never match anything, and a
  // phrase claimed twice would resolve to whichever was declared first,
  // silently.
  const seen = new Map();
  for (const concept of CONCEPTS) {
    // Every field a concept can reach a game through. Adding a new one
    // and forgetting it here is how this test starts reporting that a
    // working concept points at nothing, which it did for pixel art.
    const reach =
      (concept.genres?.length ?? 0) +
      (concept.curated?.length ?? 0) +
      (concept.tags?.length ?? 0) +
      (concept.names?.length ?? 0) +
      (concept.art?.length ?? 0);
    assert.ok(reach > 0, `${concept.id} points at nothing`);
    assert.ok(concept.ask.length > 0, `${concept.id} cannot be asked for`);
    for (const phrase of concept.ask) {
      const key = phrase.toLowerCase().replace(/[^a-z0-9]+/g, '');
      /*
       * Across concepts, not within one. Two concepts claiming a phrase
       * resolve to whichever was declared first and the other silently
       * never fires; the same phrase twice inside one concept is only
       * dead weight, and the first version of this test confused the
       * two and flagged "role playing" against "roleplaying".
       */
      const owner = seen.get(key);
      assert.ok(
        owner === undefined || owner === concept.id,
        `"${phrase}" is claimed by both ${owner} and ${concept.id}`,
      );
      seen.set(key, concept.id);
    }
  }
});

test('an unknown word is not forced into a concept', () => {
  // Better to fall through to the name search than to answer a question
  // nobody asked.
  assert.equal(conceptFor('zelda'), null);
  assert.equal(conceptFor('bloodborne'), null);
  assert.equal(conceptFor('naughty dog'), null);
  assert.equal(conceptFor('zzzznotagame'), null);
});
