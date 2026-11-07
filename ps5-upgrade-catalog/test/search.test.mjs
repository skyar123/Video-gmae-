/**
 * Title matching: does typing a name find the game, and only the game?
 *
 * This is the heart of the app's search and it had no test at all, which is
 * how a query for "hela" came to return forty games led by The Last of Us.
 *
 * Both halves matter and they pull against each other. Too strict and
 * "spiderman" misses Spider-Man, which is the failure the fuzzy rules were
 * written for in the first place. Too loose and a real search drowns, and
 * worse than drowning: the app only looks for a game on PC when nothing
 * matched, so a pile of wrong answers convinces it that it has answered.
 *
 * So every loosening rule here is tested twice, once for what it must find
 * and once for what it must not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, indexText, parseQuery, scoreMatch } from '../api/search.mjs';

const score = (title, query) => scoreMatch(indexText(title), parseQuery(query));
const matches = (title, query) => score(title, query) > 0;

/** A handful of real catalog titles, including the ones that went wrong. */
const CATALOG = [
  'The Last of Us™ Part I',
  'The Last of Us™ Complete',
  'Lorelei and the Laser Eyes',
  'The Last Campfire',
  'Cult of the Lamb',
  'The Last Faith',
  'The Last Clockwinder',
  'God of War Ragnarök',
  "Marvel's Spider-Man",
  'Final Fantasy VII Remake',
  'Hollow Knight: Silksong',
  'Hela: of Mice & Magic',
];

const hits = (query) =>
  CATALOG.filter((title) => matches(title, query)).sort(
    (a, b) => score(b, query) - score(a, query),
  );

test('"hela" finds Hela, and nothing it merely glues together', () => {
  // The reported bug. "The Last of Us Part I" squashes to
  // "thelastofuspart1", which contains "hela" across the join of "the" and
  // "last". So did Lorelei, Cult of the Lamb and The Last Campfire.
  assert.deepEqual(hits('hela'), ['Hela: of Mice & Magic']);
});

test('the squashed rule still does the job it was written for', () => {
  // Every one of these is somebody closing up a name they know, and each
  // one is why the rule exists. Breaking these to fix the above would be a
  // bad trade.
  assert.ok(matches("Marvel's Spider-Man", 'spiderman'));
  assert.ok(matches('God of War Ragnarök', 'godofwar'));
  assert.ok(matches('Hollow Knight: Silksong', 'hollowknight'));
  assert.ok(matches('Final Fantasy VII Remake', 'finalfantasy'));
});

test('a squashed match has to start where a word starts', () => {
  // Starting at any word is fine, not just the first: somebody typing
  // "ofwar" has typed two real words of the title run together.
  assert.ok(matches('God of War Ragnarök', 'ofwar'));
  assert.ok(matches('God of War Ragnarök', 'warrag'));

  // Starting mid-word is not. "dofwar" takes the tail of "god" and runs on,
  // which is the same mistake that made "hela" match The Last of Us, just
  // one letter further in.
  assert.ok(!matches('God of War Ragnarök', 'dofwar'));
  assert.ok(!matches('God of War Ragnarök', 'odofwar'));
  assert.ok(!matches('Hollow Knight: Silksong', 'owknight'));
});

test('accents, hyphens and apostrophes do not hide a game', () => {
  // The failures the folding was written for. Each one is a real title that
  // plain lowercase-and-includes could not find.
  assert.ok(matches('God of War Ragnarök', 'ragnarok'));
  assert.ok(matches("Marvel's Spider-Man", 'spider man'));
  assert.ok(matches("Marvel's Spider-Man", 'marvels spider man'));
  assert.ok(matches('Hela: of Mice & Magic', 'hela of mice'));
});

test('an exact title beats a prefix beats a mid-title match', () => {
  // The bands have to stay far apart or ranking is decided by title length.
  const exact = score('The Last Faith', 'the last faith');
  const prefix = score('The Last Faith', 'the last');
  const middle = score('The Last Faith', 'faith');
  assert.ok(exact > prefix, `exact ${exact} should beat prefix ${prefix}`);
  assert.ok(prefix > middle, `prefix ${prefix} should beat middle ${middle}`);
});

test('typing a full title puts that title first', () => {
  const ranked = hits('the last of us part i');
  assert.equal(ranked[0], 'The Last of Us™ Part I');
});

test('a mid-title match has to begin at a word', () => {
  // "war" finds God of War. It must not find a game because some word of
  // its title happens to contain those letters.
  assert.ok(matches('God of War Ragnarök', 'war'));
  assert.ok(!matches('The Last Clockwinder', 'winder'));
});

test('roman numerals answer to digits', () => {
  assert.ok(matches('Final Fantasy VII Remake', 'final fantasy 7'));
  assert.ok(matches('Final Fantasy VII Remake', 'ff7'));
});

test('initials are the weakest signal and stay that way', () => {
  const byInitials = score('The Last of Us™ Part I', 'tlou');
  const byName = score('The Last of Us™ Part I', 'the last of us');
  assert.ok(byInitials > 0, 'tlou should find it at all');
  assert.ok(byName > byInitials, `a real name ${byName} must beat initials ${byInitials}`);
});

test('an empty query matches nothing rather than everything', () => {
  // A blank search that scored every row would hand the grid the whole
  // catalog in a random order and call it a result.
  assert.equal(score('The Last Faith', ''), 0);
  assert.equal(score('The Last Faith', '   '), 0);
});

test('a query nothing answers scores nothing, so the PC fallback can run', () => {
  // This is the condition the fallback is gated on. If any rule quietly
  // matches here, a reader searching for a PC game is told the catalog has
  // it and shown something else.
  for (const title of CATALOG) {
    assert.ok(!matches(title, 'zzzznotagame'), `${title} answered a nonsense query`);
  }
  assert.deepEqual(hits('hozy'), []);
});

test('folding is letters and digits, and keeps words apart', () => {
  assert.equal(fold('God of War Ragnarök'), 'god of war ragnarok');
  assert.equal(fold("Marvel's Spider-Man"), 'marvels spider man');
  assert.equal(fold('The Last of Us™ Part I'), 'the last of us part i');
});
