/**
 * Who is playing.
 *
 * The risk in this file is not a missed game, it is a game waved through. A
 * search that misses something costs somebody a minute; a filter that tells
 * a parent a game is fine for a five-year-old when nobody has rated it has
 * made a claim it cannot support. So most of what follows is about the
 * refusing, not the allowing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIENCES,
  audienceFor,
  parentFlags,
  plainDescriptors,
  suitsAudience,
  whyNot,
} from '../api/family.mjs';

const rated = (tier, extra = {}) => ({
  name: 'A Game',
  ageRating: { tier, source: 'ESRB', rating: 'E', descriptors: [], interactive: [], ...extra },
});

test('a rating is a ceiling, so every wider audience allows what a narrower one does', () => {
  const widening = ['everyone', 'everyone10', 'teen', 'all'];
  for (const tier of ['everyone', 'everyone10', 'teen', 'mature']) {
    const game = rated(tier);
    let seenYes = false;
    for (const id of widening) {
      const allowed = suitsAudience(game, audienceFor(id));
      if (allowed) seenYes = true;
      // Once allowed, never disallowed again as the audience widens.
      else assert.ok(!seenYes, `${tier} was allowed and then refused by ${id}`);
    }
    assert.ok(seenYes, `${tier} was allowed by nobody, not even No limit`);
  }
});

test('an unrated game is refused by every audience but No limit', () => {
  /*
   * The whole point. A game nobody has rated is the one most likely to be a
   * surprise, and the kind filter in this app has always treated unrated as
   * unknown rather than innocent.
   */
  for (const game of [rated(null), rated('unknown'), { name: 'Bare' }, {}]) {
    assert.equal(suitsAudience(game, audienceFor('everyone')), false);
    assert.equal(suitsAudience(game, audienceFor('everyone10')), false);
    assert.equal(suitsAudience(game, audienceFor('teen')), false);
    // No limit means no limit, including no rating.
    assert.equal(suitsAudience(game, audienceFor('all')), true);
  }
});

test('little kids means Everyone, and nothing above it', () => {
  assert.equal(suitsAudience(rated('everyone'), audienceFor('everyone')), true);
  assert.equal(suitsAudience(rated('everyone10'), audienceFor('everyone')), false);
  assert.equal(suitsAudience(rated('teen'), audienceFor('everyone')), false);
  assert.equal(suitsAudience(rated('mature'), audienceFor('everyone')), false);

  // And 13-and-over stops short of Mature.
  assert.equal(suitsAudience(rated('teen'), audienceFor('teen')), true);
  assert.equal(suitsAudience(rated('mature'), audienceFor('teen')), false);
});

test('a descriptor nobody translated is still shown, not swallowed', () => {
  /*
   * The one unsafe way this could fail. Dropping anything the table does not
   * know would mean a warning the board wrote disappearing because this file
   * had no phrase for it.
   */
  const game = rated('teen', { descriptors: ['Blood and Gore', 'Some Brand New Warning'] });
  const said = plainDescriptors(game);
  assert.ok(said.includes('graphic blood and injury'));
  assert.ok(said.includes('some brand new warning'), `lost a descriptor: ${said.join(', ')}`);
});

test('board boilerplate is not a warning about anything', () => {
  const game = rated('everyone', {
    descriptors: ['No Descriptors', 'Visit www.esrb.org for rating information.'],
  });
  assert.deepEqual(plainDescriptors(game), []);
});

test('the two a parent would miss', () => {
  /*
   * Both live in the board's interactive elements rather than its content
   * descriptors, so they sit in a different field from the violence and the
   * swearing and neither changes the age on the box.
   */
  const chatty = rated('everyone', { interactive: ['Users Interact'] });
  assert.equal(parentFlags(chatty).strangers, true);
  assert.equal(parentFlags(chatty).purchases, false);

  const shop = rated('everyone', { interactive: ['In-Game Purchases (Includes Random Items)'] });
  assert.equal(parentFlags(shop).purchases, true);

  const both = rated('everyone', { interactive: ['Users Interact', 'In-Game Purchases'] });
  assert.deepEqual(
    { ...parentFlags(both) },
    { purchases: true, strangers: true, unrated: false },
  );

  assert.equal(parentFlags({}).unrated, true);
});

test('it says why, and says nothing when there is nothing to say', () => {
  const fine = rated('everyone');
  assert.equal(whyNot(fine, audienceFor('everyone')), null);
  // No limit never explains itself, because it refuses nothing.
  assert.equal(whyNot(rated('mature'), audienceFor('all')), null);

  const refused = whyNot(
    rated('mature', { rating: 'M', descriptors: ['Blood and Gore', 'Strong Language'] }),
    audienceFor('everyone'),
  );
  assert.match(refused, /ESRB M/);
  assert.match(refused, /graphic blood and injury/);
  assert.match(refused, /strong swearing/);

  // An unrated game explains itself differently, because the reason is that
  // nobody has looked rather than that somebody did.
  assert.match(whyNot({}, audienceFor('everyone')), /not been checked/i);
});

test('every audience is reachable and distinct', () => {
  assert.ok(AUDIENCES.length >= 3);
  const ids = new Set(AUDIENCES.map((a) => a.id));
  assert.equal(ids.size, AUDIENCES.length, 'two audiences share an id');
  for (const audience of AUDIENCES) {
    assert.ok(audience.label, `${audience.id} has no label`);
    assert.ok(audienceFor(audience.id), `${audience.id} cannot be looked up`);
  }
  // Exactly one unlimited audience, or "no limit" stops meaning anything.
  assert.equal(AUDIENCES.filter((a) => !a.tiers).length, 1);
});
