/**
 * Levels, experience and trophies.
 *
 * Asked for twice, and the first answer was a stats page with an essay about
 * why points would be crass. Points are not dishonest. What would be
 * dishonest is awarding them for things the app cannot see, so there is no
 * XP here for opening the app, for a streak, or for time spent: the app does
 * not know whether anybody played anything today, only what they told it.
 *
 * The other rule is that nothing is ever incremented and stored. Every
 * number is recomputed from what the reader has done, which is what makes
 * levels retroactive for somebody who has used this for months, and what
 * makes undoing a rating take its points back instead of leaving them
 * stranded forever.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answersForClass,
  CLASSES,
  classFor,
  costOf,
  levelFromXp,
  statsFrom,
  TIER_ORDER,
  TROPHIES,
  trophiesFrom,
  XP,
  xpFrom,
} from '../src/rpg.js';

test('somebody who has used this for months is not level one', () => {
  /*
   * The whole reason XP is computed rather than accumulated. A reader who
   * rated forty games before any of this existed has already done the work,
   * and starting them at zero would be the app pretending it had not been
   * watching.
   */
  const longtime = {
    ratings: new Map(Array.from({ length: 40 }, (_, i) => [`g${i}`, 'like'])),
    library: new Set(Array.from({ length: 20 }, (_, i) => `o${i}`)),
    backlog: new Map([['g1', 'finished'], ['g2', 'finished']]),
    features: new Set(['genre:A', 'genre:B', 'art:Pixel Art']),
  };
  assert.ok(levelFromXp(xpFrom(longtime)).level >= 4, 'a long-time reader started near the bottom');
});

test('nothing is earned by turning up', () => {
  // No key for sessions, days, streaks or minutes, because the app cannot
  // see any of them and awarding points for them would be inventing.
  for (const key of Object.keys(XP)) {
    assert.ok(
      !/visit|day|daily|streak|login|session|time|minute/i.test(key),
      `XP.${key} pays for something the app cannot actually observe`,
    );
  }
  assert.equal(xpFrom({}), 0);
  assert.equal(levelFromXp(0).level, 1);
});

test('taking something back takes the points back', () => {
  const before = xpFrom({ ratings: new Map([['a', 'like'], ['b', 'like']]) });
  const after = xpFrom({ ratings: new Map([['a', 'like']]) });
  assert.equal(before - after, XP.rated, 'undoing a rating left its points behind');
});

test('one game pays once, however many ways you have said it', () => {
  /*
   * A finished game that is also owned and also thumbed up is one game. The
   * first version of this counted each claim separately and a careful reader
   * would have out-levelled a prolific one by filing the same games three
   * ways.
   */
  const once = xpFrom({ backlog: new Map([['a', 'finished']]) });
  const thrice = xpFrom({
    backlog: new Map([['a', 'finished']]),
    library: new Set(['a']),
    ratings: new Map([['a', 'like']]),
  });
  assert.equal(thrice, once, 'the same game paid more than once');
  assert.equal(once, XP.finished, 'the highest claim is not the one that counted');
});

test('breadth is worth more than another one of the same', () => {
  const narrow = xpFrom({
    ratings: new Map([['a', 'like'], ['b', 'like']]),
    features: new Set(['genre:Metroidvania']),
  });
  const wide = xpFrom({
    ratings: new Map([['a', 'like'], ['b', 'like']]),
    features: new Set(['genre:Metroidvania', 'genre:Life Sim', 'art:Pixel Art']),
  });
  assert.ok(wide > narrow, 'knowing about more kinds of game was worth nothing');

  /*
   * Each kind of breadth on its own, because the first version of this mixed
   * genres and art styles into one comparison and so still passed with the
   * genre bonus switched off entirely: the art bonus was carrying it.
   */
  const base = { ratings: new Map([['a', 'like']]) };
  const byGenre =
    xpFrom({ ...base, features: new Set(['genre:A', 'genre:B']) }) -
    xpFrom({ ...base, features: new Set(['genre:A']) });
  assert.equal(byGenre, XP.genreKnown, 'a second genre paid nothing');

  const byArt =
    xpFrom({ ...base, features: new Set(['art:A', 'art:B']) }) -
    xpFrom({ ...base, features: new Set(['art:A']) });
  assert.equal(byArt, XP.artKnown, 'a second art style paid nothing');

  const byLead =
    xpFrom({ ...base, features: new Set(['lead:A', 'lead:B']) }) -
    xpFrom({ ...base, features: new Set(['lead:A']) });
  assert.equal(byLead, XP.leadKnown, 'a second kind of lead paid nothing');
});

test('the climb gets steeper and never stalls', () => {
  for (let level = 1; level < 30; level += 1) {
    assert.ok(costOf(level + 1) > costOf(level), `level ${level + 1} is not dearer than ${level}`);
  }
  // And every level is reachable: enough XP always moves you up.
  assert.ok(levelFromXp(1_000_000).level > levelFromXp(10_000).level);
  // The bar inside a level is always a real fraction.
  for (const xp of [0, 50, 500, 5000, 50_000]) {
    const at = levelFromXp(xp);
    assert.ok(at.through >= 0 && at.through <= 1, `bar at ${xp} XP reads ${at.through}`);
    assert.ok(at.into <= at.need);
  }
});

test('trophies unlock for things already done', () => {
  const stats = statsFrom({
    ratings: new Map(Array.from({ length: 30 }, (_, i) => [`g${i}`, 'like'])),
    backlog: new Map([['a', 'finished']]),
    level: 3,
  });
  const won = trophiesFrom(stats).filter((trophy) => trophy.won).map((t) => t.id);
  assert.ok(won.includes('first-word'));
  assert.ok(won.includes('opinionated'));
  assert.ok(won.includes('first-blood'), 'a finished game won no trophy');
  assert.ok(!won.includes('closer'), 'the ten-finish trophy came too cheap');
});

test('every trophy is winnable and says what it is for', () => {
  const ids = new Set();
  for (const trophy of TROPHIES) {
    assert.ok(!ids.has(trophy.id), `two trophies share the id ${trophy.id}`);
    ids.add(trophy.id);
    assert.ok(trophy.name && trophy.detail, `${trophy.id} has nothing to say`);
    assert.ok(TIER_ORDER.includes(trophy.tier), `${trophy.id} has tier "${trophy.tier}"`);
  }
  // A maxed-out reader wins all of them, or one is unreachable.
  const maxed = statsFrom({
    ratings: new Map(Array.from({ length: 200 }, (_, i) => [`g${i}`, i % 2 ? 'like' : 'dislike'])),
    library: new Set(Array.from({ length: 50 }, (_, i) => `o${i}`)),
    backlog: new Map(Array.from({ length: 20 }, (_, i) => [`b${i}`, i % 2 ? 'finished' : 'bounced'])),
    answers: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`a${i}`, 'yes'])),
    features: new Set([
      ...Array.from({ length: 12 }, (_, i) => `genre:G${i}`),
      ...Array.from({ length: 9 }, (_, i) => `art:A${i}`),
    ]),
    level: 25,
  });
  const unwinnable = trophiesFrom(maxed).filter((trophy) => !trophy.won);
  assert.deepEqual(unwinnable.map((t) => t.id), [], 'some trophies cannot be won at all');
});

test('a class is a statement of taste, in the shape the model takes', () => {
  /*
   * Picking one is not decoration: it is answered into the same feature
   * weights the guided questions write, so a Hearthkeeper really does get
   * cosier picks from the first screen. If these were invented feature names
   * the choice would change nothing and the app would be lying about it.
   */
  for (const entry of CLASSES) {
    assert.ok(entry.grants.length > 0, `${entry.id} grants nothing`);
    for (const feature of entry.grants) {
      assert.match(feature, /^(genre|sgenre|tag|art|lead):.+/, `${entry.id} grants "${feature}"`);
    }
  }
  const answers = answersForClass('hearthkeeper');
  assert.ok(answers.length > 0);
  assert.ok(answers.every((answer) => answer.verdict === 'yes'));
  assert.deepEqual(answersForClass('nonsense'), []);
  assert.equal(classFor('nonsense'), null);
});

test('the counts a trophy is judged on come from one place', () => {
  // A trophy and the bar under it cannot disagree about how many games
  // somebody finished, because both read this.
  const stats = statsFrom({
    backlog: new Map([['a', 'finished'], ['b', 'finished'], ['c', 'bounced'], ['d', 'playing']]),
    ratings: new Map([['e', 'dislike']]),
  });
  assert.equal(stats.finished, 2);
  assert.equal(stats.bounced, 1);
  assert.equal(stats.playing, 1);
  assert.equal(stats.disliked, 1);
  assert.equal(stats.said, 5);
});

test('the codex is a record of where you have been', async () => {
  const { codexFrom, codexProgress } = await import('../src/rpg.js');
  const catalog = [
    { id: 'a', genre: 'Metroidvania', artStyle: 'Pixel Art', protagonist: 'Custom' },
    { id: 'b', genre: 'Life Sim', artStyle: 'Watercolor', protagonist: 'Female' },
    { id: 'c', genre: 'Horror', artStyle: 'Photorealistic', protagonist: 'Male' },
  ];

  const nothing = codexFrom({ catalog });
  assert.equal(codexProgress(nothing).found, 0, 'something was discovered from nothing');
  assert.equal(codexProgress(nothing).total, 9, 'the codex is not built from the catalogue');

  const some = codexFrom({ catalog, signals: [{ game: catalog[0], kind: 'liked' }] });
  const genres = some.find((kind) => kind.id === 'genre').entries;
  assert.equal(genres.find((e) => e.value === 'Metroidvania').found, true);
  assert.equal(genres.find((e) => e.value === 'Horror').found, false, 'an unmet genre was found');
  assert.equal(codexProgress(some).found, 3, 'one game should discover its genre, art and lead');
});

test('trying something and disliking it still counts as having met it', async () => {
  /*
   * A codex records where somebody went, not what they enjoyed. Putting a
   * game down after an hour is more contact with a genre than never opening
   * one, so it is found; whether it was liked is a separate column.
   */
  const { codexFrom } = await import('../src/rpg.js');
  const catalog = [{ id: 'a', genre: 'Horror', artStyle: '3D', protagonist: 'Male' }];
  const codex = codexFrom({ catalog, signals: [{ game: catalog[0], kind: 'bounced' }] });
  const horror = codex.find((k) => k.id === 'genre').entries[0];
  assert.equal(horror.found, true, 'giving up on a genre left it undiscovered');
  assert.equal(horror.count, 1);
  assert.equal(horror.liked, 0, 'a game put down was counted as one sought out');
});

test('a codex entry cannot be filled by looking at it', async () => {
  /*
   * The thing that would make the whole collection worthless. Only signals
   * the reader chose to record reach this; there is no input for a game
   * scrolled past, because the app cannot tell scrolling from staring out
   * of the window.
   */
  const { codexFrom, codexProgress } = await import('../src/rpg.js');
  const catalog = Array.from({ length: 40 }, (_, i) => ({
    id: `g${i}`,
    genre: `Genre ${i}`,
    artStyle: `Art ${i}`,
    protagonist: 'Custom',
  }));
  // A reader who has opened the app a thousand times and said nothing.
  assert.equal(codexProgress(codexFrom({ catalog, signals: [] })).found, 0);
});

test('codex progress never claims more than exists', async () => {
  const { codexFrom, codexProgress } = await import('../src/rpg.js');
  const catalog = [{ id: 'a', genre: 'RPG', artStyle: '3D', protagonist: 'Custom' }];
  // The same game said five ways is still one genre discovered.
  const codex = codexFrom({
    catalog,
    signals: [
      { game: catalog[0], kind: 'liked' },
      { game: catalog[0], kind: 'owned' },
      { game: catalog[0], kind: 'finished' },
    ],
  });
  const progress = codexProgress(codex);
  assert.equal(progress.found, 3);
  assert.equal(progress.total, 3);
  assert.ok(progress.share <= 1);
});
