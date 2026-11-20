/**
 * Being asked, rather than only being watched.
 *
 * Asked for directly: the For you section should "give you an option to
 * improve the algorithm with guided questions". Everything the model knew
 * before this came from games the reader had rated, owned or wanted, which
 * is the right default and a slow start: with nothing rated the picks are
 * simply the best reviewed, and the only way out was a dozen thumbs.
 *
 * Two risks, and the tests here are mostly about them. An answer that
 * counted for too much would let one tap rewrite a profile built from
 * fifty games. And a question nobody can read, or one about something
 * almost every game has, wastes the only attention the reader will give
 * this, so what can be asked is pinned to the same two rules the reasons
 * under a pick already follow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_WEIGHT,
  buildTaste,
  explain,
  geniusPicks,
  questionsFor,
  SHARED_NAMESPACES,
} from '../src/genius.js';

const game = (id, extra = {}) => ({
  id,
  title: id,
  genre: 'Metroidvania',
  tags: [],
  criticScore: 85,
  playerScore: 90,
  ...extra,
});

test('an answer teaches the feature it was about and nothing else', () => {
  const taste = buildTaste([], null, {
    answers: [{ feature: 'genre:Metroidvania', verdict: 'yes' }],
  });
  assert.ok(taste.weights.get('genre:Metroidvania') > 0);
  // Not the neighbours. An answer about one genre is not an answer about
  // every genre, and a profile that spread it would be inventing evidence.
  assert.equal(taste.weights.get('genre:Platformer'), undefined);
  assert.equal(taste.weights.get('tag:cozy'), undefined);
});

test('no means less of it, and one each way is a wash', () => {
  const no = buildTaste([], null, {
    answers: [{ feature: 'tag:cozy', verdict: 'no' }],
  });
  assert.ok(no.weights.get('tag:cozy') < 0);

  const both = buildTaste([], null, {
    answers: [
      { feature: 'tag:cozy', verdict: 'yes' },
      { feature: 'tag:cozy', verdict: 'no' },
    ],
  });
  assert.equal(both.weights.get('tag:cozy'), 0);
});

test('one answer is evidence, not a law', () => {
  /*
   * The number that matters. A tap has to be worth enough to change the
   * list and not enough to overrule a profile built by hand, so it is
   * smoothed exactly as a rated game is: one answer lands near a quarter
   * rather than at one.
   */
  const one = buildTaste([], null, {
    answers: [{ feature: 'tag:cozy', verdict: 'yes' }],
  });
  const weight = one.weights.get('tag:cozy');
  assert.ok(weight > 0.2 && weight < 0.4, `one answer weighed ${weight}`);

  // And against real evidence it is one voice among several, not the
  // deciding one.
  const against = buildTaste(
    [
      { game: game('a', { tags: ['cozy'] }), kind: 'liked' },
      { game: game('b', { tags: ['cozy'] }), kind: 'liked' },
      { game: game('c', { tags: ['cozy'] }), kind: 'liked' },
    ],
    null,
    { answers: [{ feature: 'tag:cozy', verdict: 'no' }] },
  );
  assert.ok(
    against.weights.get('tag:cozy') > 0,
    'three liked cozy games should still read as liking cozy games',
  );
});

test('answers on their own are enough to get picks', () => {
  /*
   * The gate used to ask for a rated game and nothing else, so a reader
   * who answered the questions and had thumbed nothing got an empty list
   * and no sign their answers had been taken at all.
   */
  const pool = [
    game('metroid-1'),
    game('metroid-2'),
    game('cozy-1', { genre: 'Life Sim', tags: ['cozy'] }),
  ];
  const { picks, taste } = geniusPicks(pool, [], {
    answers: [{ feature: 'genre:Metroidvania', verdict: 'yes' }],
  });
  assert.ok(picks.length > 0, 'answers alone produced no picks');
  assert.equal(taste.positives, 0, 'an answer is not a rated game');
  assert.equal(taste.said.yes, 1);
  // And the thing answered yes to is what comes back first.
  assert.equal(picks[0].game.genre, 'Metroidvania');
});

test('nothing positive at all still means no picks', () => {
  const pool = [game('a'), game('b')];
  assert.equal(geniusPicks(pool, []).picks.length, 0);
  assert.equal(
    geniusPicks(pool, [], { answers: [{ feature: 'tag:cozy', verdict: 'no' }] }).picks.length,
    0,
    'a list of complaints is not a profile',
  );
});

test('rubbish in an answer is ignored rather than stored', () => {
  const taste = buildTaste([], null, {
    answers: [
      { feature: 'tag:cozy', verdict: 'maybe' },
      { feature: 'no-colon-here', verdict: 'yes' },
      { feature: null, verdict: 'yes' },
      { verdict: 'yes' },
    ],
  });
  assert.equal(taste.weights.size, 0);
  assert.equal(taste.said.yes, 0);
});

test('a profile for the store half cannot be taught a curated-only feature', () => {
  /*
   * The two vocabularies are kept apart deliberately, and the profile sent
   * out to rank the mirror carries only the shared namespaces. An answer
   * about a hand-written genre has nothing to score against there, so it
   * is dropped rather than shipped as a weight nothing can match.
   */
  const taste = buildTaste([], SHARED_NAMESPACES, {
    answers: [
      { feature: 'genre:Metroidvania', verdict: 'yes' },
      { feature: 'sgenre:Action', verdict: 'yes' },
    ],
  });
  assert.equal(taste.weights.get('genre:Metroidvania'), undefined);
  assert.ok(taste.weights.get('sgenre:Action') > 0);
});

test('the questions go where the profile is blank', () => {
  /*
   * Five things to ask about and room for two, so the ordering has to
   * choose. An earlier version of this test gave it three candidates and
   * room for four, where every ordering passes and the test proved nothing.
   */
  const catalog = [];
  for (let i = 0; i < 20; i += 1) catalog.push(game(`cozy-${i}`, { tags: ['cozy'] }));
  for (let i = 0; i < 18; i += 1) catalog.push(game(`social-${i}`, { tags: ['social'] }));
  for (let i = 0; i < 16; i += 1) catalog.push(game(`queer-${i}`, { tags: ['queer'] }));
  for (let i = 0; i < 14; i += 1) catalog.push(game(`classic-${i}`, { tags: ['classic'] }));

  const blank = questionsFor(catalog, null, { limit: 2 }).map((q) => q.phrase);
  // Nothing known, so the tie breaks on how many games the answer moves.
  assert.deepEqual(blank, ['Metroidvania games', 'cozy games']);

  /*
   * Once something is known it goes to the back of the queue. Not dropped:
   * with little else to ask, a question the model has weak evidence on is
   * still a better use of the reader's attention than no question, and the
   * guarantee that matters is that the blank parts come first.
   */
  const taste = buildTaste([{ game: catalog[0], kind: 'liked' }]);
  const after = questionsFor(catalog, taste, { limit: 2 }).map((q) => q.phrase);
  assert.ok(!after.includes('cozy games'), 'a known feature outranked the blank ones');
  assert.ok(!after.includes('Metroidvania games'), 'a known feature outranked the blank ones');
  assert.deepEqual(after, ['playing with people', 'queer stories']);
});

test('with nothing known yet, it opens on something worth being asked', () => {
  /*
   * At a cold start every feature ties on evidence, so whatever breaks that
   * tie decides the first question the reader ever sees. Coverage alone
   * opened on "The 3D look", because 210 games are 3D: true, and a poor
   * thing to be asked first, since 3D is what a game is unless it is
   * something else.
   */
  const catalog = [];
  // An art style on nearly half the catalog, and a genre on a quarter of it.
  for (let i = 0; i < 40; i += 1) {
    catalog.push(game(`three-d-${i}`, { genre: null, artStyle: '3D' }));
  }
  for (let i = 0; i < 20; i += 1) catalog.push(game(`rpg-${i}`, { genre: 'RPG' }));

  const [first] = questionsFor(catalog, null, { limit: 5 });
  assert.equal(first.phrase, 'RPG games', 'opened on the biggest pile rather than the best question');

  // The art style is still asked, just not first: it is a real preference,
  // only a less telling one.
  const all = questionsFor(catalog, null, { limit: 5 }).map((q) => q.phrase);
  assert.ok(all.includes('the 3D look'));
});

test('a question that has been answered does not come back', () => {
  /*
   * Ordering alone cannot promise this. In a catalog with only three things
   * worth asking about, the one just answered sorts last of three and is
   * still inside a run of four, so it came straight back up.
   */
  const catalog = [];
  for (let i = 0; i < 20; i += 1) catalog.push(game(`cozy-${i}`, { tags: ['cozy'] }));
  for (let i = 0; i < 20; i += 1) catalog.push(game(`social-${i}`, { tags: ['social'] }));

  const asked = new Set(['tag:cozy']);
  const taste = buildTaste([], null, {
    answers: [{ feature: 'tag:cozy', verdict: 'yes' }],
  });
  const next = questionsFor(catalog, taste, { limit: 8, asked }).map((q) => q.phrase);
  assert.ok(!next.includes('cozy games'), 'put an answered question back');
  assert.ok(next.includes('playing with people'));
});

test('one phrase is one question, however many features say it', () => {
  /*
   * Action and Adventure exist in both vocabularies, so asked feature by
   * feature the reader got "Action games" twice in one run.
   */
  const catalog = [];
  for (let i = 0; i < 20; i += 1) {
    catalog.push(game(`a-${i}`, { genre: 'Action', genres: ['Action'] }));
  }
  const asked = questionsFor(catalog, null, { limit: 8 });
  const action = asked.filter((q) => q.phrase === 'Action games');
  assert.equal(action.length, 1, 'the same words were put twice');
  // And the one question answers for both halves, because the reader said
  // nothing about which half wrote the label down.
  assert.deepEqual(action[0].features, ['genre:Action', 'sgenre:Action']);
});

test('a question has to be readable and has to separate something', () => {
  const catalog = [];
  // Twenty games sharing an age tier and a decade, which is true of most of
  // the catalog and so tells nobody anything about themselves.
  for (let i = 0; i < 20; i += 1) {
    catalog.push(
      game(`t-${i}`, {
        genre: null,
        ageRating: { tier: 'teen', family: 'mild' },
        releaseDate: '2021-05-01',
      }),
    );
  }
  // And one rare thing, which would be a fine question if anything had it.
  catalog.push(game('rare', { genre: 'Deckbuilder' }));

  /*
   * Age band and release decade are the two this is really about, and an
   * earlier version of this test named the wrong one. It asserted that no
   * question was about an age tier, which passes whether the floor exists or
   * not: a tier has no phrasing at all, so it is already excluded for being
   * unreadable. Removing the floor changed nothing the test could see.
   *
   * What the floor alone keeps out is "games with a light touch" and "games
   * from this decade": both readable, both true of most of the catalog, and
   * so both worthless as questions.
   */
  const everyGameHas = /^(?:family|era|tier):/;
  for (const question of questionsFor(catalog, null, { limit: 20 })) {
    assert.ok(question.phrase, 'a question with no words in it');
    assert.ok(
      !question.features.some((feature) => everyGameHas.test(feature)),
      `asked about ${question.features.join()}, which nearly every game has`,
    );
    assert.ok(question.games >= 8, `asked about ${question.phrase}, which only ${question.games} games have`);
  }
  assert.ok(
    !questionsFor(catalog, null, { limit: 20 }).some((q) => q.phrase === 'Deckbuilder games'),
    'asked about a genre one game has',
  );
});

test('the words of the question are the words of the reason', () => {
  /*
   * Worth pinning down, because it is the whole reason the questions reuse
   * describeFeature rather than keeping a list of their own: you are asked
   * whether you go for cozy games, and the picks then say they were chosen
   * because you go for cozy games. Two vocabularies would drift.
   */
  const catalog = [];
  for (let i = 0; i < 20; i += 1) catalog.push(game(`c-${i}`, { tags: ['cozy'] }));
  const [question] = questionsFor(catalog, null, { limit: 1 });
  const { picks } = geniusPicks(catalog, [], {
    answers: question.features.map((feature) => ({ feature, verdict: 'yes' })),
  });
  // geniusPicks hands back what each game scored on; the sentence is built
  // from that, by the same function the sheet uses.
  const reason = explain(picks[0].hits);
  assert.ok(reason.includes(question.phrase), `"${reason}" vs "${question.phrase}"`);
});

test('the weight an answer carries is stated once, not spelled out twice', () => {
  // Guards the constant against being changed in one place only.
  assert.equal(ANSWER_WEIGHT, 1);
});

test('a phrase a person would actually read', async () => {
  const { describeFeature } = await import('../src/genius.js');

  /*
   * Both of these were live in the sentence under a pick before the
   * questions reused it, and a question is where they became impossible to
   * ignore: "Do you go for Role Playing Games games?"
   */
  assert.equal(describeFeature('sgenre:Role Playing Games'), 'Role Playing Games');
  assert.equal(describeFeature('sgenre:Family'), 'Family games');
  assert.equal(describeFeature('genre:Life Sim'), 'Life Sim games');

  // A label is not an adjective. "3D" lowercased reads as a typo.
  assert.equal(describeFeature('art:3D'), 'the 3D look');
  assert.equal(describeFeature('art:3D/2D Mix'), 'the 3D/2D Mix look');
  assert.equal(describeFeature('art:Hand-drawn'), 'the hand-drawn look');
  assert.equal(describeFeature('art:Pixel Art'), 'the pixel art look');

  /*
   * A phrase has to work as a question too, not only as the tail of
   * "because you go for ___". This one read as "How it looks" on a card
   * with More of this and Less of this under it, which asks nothing.
   */
  assert.equal(describeFeature('tag:graphics'), 'showpiece visuals');

  // And nothing is invented for a feature with no good wording.
  assert.equal(describeFeature('tier:everyone10'), null);
  assert.equal(describeFeature('sells:yes'), null);
});
