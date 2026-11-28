/**
 * The reader, as a character sheet.
 *
 * Asked for as gamification and RPG-like fun, which is a request that goes
 * wrong in a very specific way: points for opening the app, a streak that
 * punishes you for having a life, a bar that fills whatever you do. That is
 * a slot machine with a games catalogue attached, and it would make this app
 * worse at the only thing it is for.
 *
 * So the rule these tests enforce is that nothing here invents a score.
 * Every number is already true of the reader and already used by the
 * recommender. The consequence, which is the test nobody would write unless
 * they meant it, is that somebody who uses the app constantly and says
 * nothing stays at the bottom rank forever.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaste, SAYING_IT, WORTH_SAYING } from '../src/genius.js';
import { coverageFor, GROUPS, questsFor, RANKS, rankFor, statsFor, titleFor } from '../src/progress.js';

const game = (id, extra = {}) => ({
  id,
  title: id,
  genre: 'Metroidvania',
  artStyle: 'Pixel Art',
  protagonist: 'Custom',
  tags: [],
  ageRating: { tier: 'teen', family: 'mild' },
  ...extra,
});

test('looking at things is not progress', () => {
  /*
   * The whole design, in one assertion. There is no signal for opening the
   * app, scrolling, or reading, so there is no way to rank up without
   * telling the model something. An app that levelled you for scrolling
   * would be lying about what it knows.
   */
  assert.equal(rankFor(0).name, RANKS[0].name);
  assert.equal(rankFor(0).said, 0);
  assert.equal(rankFor(undefined).said, 0);
  assert.equal(rankFor(-50).said, 0);
});

test('the ranks go up in the order they are written', () => {
  for (let i = 1; i < RANKS.length; i += 1) {
    assert.ok(RANKS[i].at > RANKS[i - 1].at, `${RANKS[i].name} is not above ${RANKS[i - 1].name}`);
  }
  assert.equal(rankFor(3).name, RANKS[1].name);
  assert.equal(rankFor(2).name, RANKS[0].name);
  assert.equal(rankFor(9).name, RANKS[1].name);
  assert.equal(rankFor(10).name, RANKS[2].name);
});

test('the bar never promises a rank that does not exist', () => {
  const top = rankFor(100_000);
  assert.equal(top.next, null, 'invented a rank above the last one');
  assert.equal(top.through, 1, 'a bar at the top rank was left unfilled');
  assert.equal(top.toNext, 0);

  // And partway up it reflects the distance actually travelled.
  const mid = rankFor(RANKS[2].at);
  assert.equal(mid.through, 0);
  assert.ok(mid.toNext > 0);
});

test('a stat has to say something about the person', () => {
  /*
   * Age tier and release decade carry real weight in a ranking and tell a
   * reader nothing: nearly every game has one. Without this floor the sheet
   * opens with "games with a light touch, rated Everyone 10+", which is
   * true and useless, and that is what the first version printed.
   */
  const taste = buildTaste([{ game: game('a', { tags: ['cozy'] }), kind: 'liked' }]);
  const stats = statsFor(taste);
  const phrases = stats.flatMap((group) => group.entries.map((entry) => entry.phrase));
  assert.ok(phrases.includes('cozy games'));
  assert.ok(phrases.includes('Metroidvania games'));
  for (const entry of stats.flatMap((group) => group.entries)) {
    assert.ok(
      !entry.feature.startsWith('tier:') && !entry.feature.startsWith('era:') && !entry.feature.startsWith('family:'),
      `${entry.feature} is on the sheet and should not be`,
    );
  }

  /*
   * And the rule that actually governs it, rather than the symptom.
   *
   * The assertions above cannot fail while GROUPS lists only the kinds
   * worth saying, which is how they were passing with the weight floor
   * removed: the grouping was doing the work and the floor was never
   * reached. What would break this is somebody adding a group for age
   * bands or release decades, so that is what is checked.
   */
  for (const group of GROUPS) {
    for (const kind of group.kinds) {
      assert.ok(
        (SAYING_IT[kind] ?? 1) >= WORTH_SAYING,
        `the ${group.label} group includes ${kind}, which tells a reader nothing about themselves`,
      );
    }
  }
});

test('one thing said twice is one stat', () => {
  // Action exists in both vocabularies, so a liked Action game produces
  // genre:Action and sgenre:Action, which is one fact about the reader.
  const taste = buildTaste([
    { game: game('a', { genre: 'Action', genres: ['Action'] }), kind: 'liked' },
  ]);
  const said = statsFor(taste).flatMap((group) => group.entries.map((entry) => entry.phrase));
  assert.equal(said.filter((phrase) => phrase === 'Action games').length, 1);
});

test('a title is one claim, and nothing at all when there is no evidence', () => {
  const empty = buildTaste([]);
  assert.equal(titleFor(empty, 'Newcomer'), 'Newcomer', 'invented a title from nothing');

  const taste = buildTaste([{ game: game('a', { tags: ['cozy'] }), kind: 'liked' }]);
  const title = titleFor(taste, 'Adept');
  assert.match(title, /^Adept of /);
  // One feature, not a string of them: a sentence nobody would say about
  // themselves is not a title worth having.
  assert.ok(!title.includes(' and '), `"${title}" is a blend rather than a claim`);
});

test('every rank reads as a title', () => {
  // "Opinionated of queer stories" is not a thing anybody would say. Each
  // rank has to be a noun that survives the template.
  for (const rank of RANKS) {
    assert.match(rank.name, /^[A-Z][a-z]+$/, `${rank.name} will not read as "<rank> of <thing>"`);
  }
});

test('quests are things the model is missing, not things the app wants', () => {
  const quests = questsFor({
    signals: [],
    library: new Set(['owned-1', 'owned-2']),
    ratings: new Map(),
    backlog: new Map(),
    catalog: [game('x')],
  });
  const ids = quests.map((quest) => quest.id);
  assert.ok(ids.includes('first-words'));
  assert.ok(ids.includes('judge-owned'));
  // Nothing about coming back tomorrow, opening the app, or a streak.
  for (const quest of quests) {
    assert.ok(
      !/streak|daily|log in|come back|tomorrow/i.test(`${quest.title} ${quest.detail}`),
      `"${quest.title}" rewards the app rather than the reader`,
    );
  }
});

test('it does not ask for a first finish from somebody who has finished something', () => {
  /*
   * The play states reach this as a map and as signals, which are two views
   * of one fact. Reading only one of them produced a quest that told a
   * reader to do the thing they had just done.
   */
  const viaSignals = questsFor({
    signals: [{ game: game('a'), kind: 'finished' }],
    wishlist: new Set(['w']),
    backlog: new Map(),
    catalog: [game('x')],
  });
  assert.ok(!viaSignals.some((quest) => quest.id === 'first-finish'));

  const viaBacklog = questsFor({
    signals: [],
    wishlist: new Set(['w']),
    backlog: new Map([['a', 'finished']]),
    catalog: [game('x')],
  });
  assert.ok(!viaBacklog.some((quest) => quest.id === 'first-finish'));

  // But somebody with a wishlist and no finishes is asked.
  const asked = questsFor({
    signals: [],
    wishlist: new Set(['w']),
    backlog: new Map([['a', 'playing']]),
    catalog: [game('x')],
  });
  assert.ok(asked.some((quest) => quest.id === 'first-finish'));
});

test('the most useful quest comes first, not the easiest', () => {
  const quests = questsFor({
    signals: [],
    library: new Set(['a']),
    ratings: new Map(),
    backlog: new Map(),
    catalog: [game('x')],
  });
  for (let i = 1; i < quests.length; i += 1) {
    assert.ok(quests[i - 1].worth >= quests[i].worth, 'quests are out of order');
  }
});

test('a game already judged is not counted as waiting to be', () => {
  const quests = questsFor({
    signals: [],
    library: new Set(['rated', 'played', 'untouched']),
    ratings: new Map([['rated', 'like']]),
    backlog: new Map([['played', 'finished']]),
    catalog: [game('x')],
  });
  const owned = quests.find((quest) => quest.id === 'judge-owned');
  assert.match(owned.detail, /^1 game is/, `counted wrongly: ${owned.detail}`);
});

test('coverage is honest about the denominator', () => {
  assert.deepEqual(coverageFor(50, 500), { said: 50, total: 500, share: 0.1 });
  // Never over one, however many opinions arrive.
  assert.equal(coverageFor(900, 500).share, 1);
  assert.equal(coverageFor(5, 0).share, 0);
});

test('finishing a quest is noticed, once', async () => {
  const { justFinished, questsToRemember } = await import('../src/progress.js');

  const before = ['judge-owned', 'first-finish'];
  const open = [{ id: 'first-finish' }, { id: 'coverage' }];
  assert.deepEqual(justFinished(open, before), ['judge-owned']);

  // And not again on the next look, because what is remembered is what is
  // open rather than what was done.
  const remembered = questsToRemember(open);
  assert.deepEqual(justFinished(open, remembered), []);
});

test('a quest that comes back can be finished again', async () => {
  /*
   * Judging every game you own clears that quest; buying three more brings
   * it back, and doing it again is doing it again. Remembering the finished
   * ids rather than the open ones would have silently swallowed that.
   */
  const { justFinished, questsToRemember } = await import('../src/progress.js');
  let remembered = questsToRemember([{ id: 'judge-owned' }]);
  assert.deepEqual(justFinished([], remembered), ['judge-owned']);

  remembered = questsToRemember([{ id: 'judge-owned' }]);
  assert.deepEqual(justFinished([], remembered), ['judge-owned'], 'the second time went unnoticed');
});

test('nothing is claimed finished on a first visit', async () => {
  const { justFinished } = await import('../src/progress.js');
  // No memory yet is not the same as having done everything.
  assert.deepEqual(justFinished([{ id: 'judge-owned' }], []), []);
  assert.deepEqual(justFinished([], []), []);
});
