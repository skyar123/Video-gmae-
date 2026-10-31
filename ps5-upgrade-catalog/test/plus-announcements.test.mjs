/**
 * Reading a PS Plus line-up out of a blog post title.
 *
 * Every title here is one the blog actually published. The formats drift in
 * ways that are invisible until you collect a year of them: three different
 * separators, an optional year, a trailing "and more", game names carrying
 * colons of their own, and regional editions announcing a different line-up
 * to a different part of the world.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAnnouncement, newestOfEachKind } from '../api/plus-monthly.mjs';

test('the ordinary case: a colon, three games', () => {
  const got = parseAnnouncement(
    'PlayStation Plus Monthly Games for October: F1 25, Hunt: Showdown 1896, Earth Defense Force: World Brothers 2',
  );
  assert.equal(got.kind, 'monthly');
  assert.equal(got.month, 'October');
  // Two of these carry colons of their own, which must not split them.
  assert.deepEqual(got.games, ['F1 25', 'Hunt: Showdown 1896', 'Earth Defense Force: World Brothers 2']);
});

test('an en-dash instead of a colon', () => {
  const got = parseAnnouncement(
    'PlayStation Plus Monthly Games for September – Sniper Elite: Resistance, MLB The Show 26, Wobbly Life, Chained Echoes',
  );
  assert.equal(got.month, 'September');
  assert.equal(got.games.length, 4);
  assert.equal(got.games[0], 'Sniper Elite: Resistance');
});

test('a plain hyphen, and a game with a sub-title', () => {
  const got = parseAnnouncement(
    'PlayStation Plus Monthly Games for August - Dying Light 2 Stay Human: Reloaded Edition, Big Walk, Signalis',
  );
  assert.deepEqual(got.games, ['Dying Light 2 Stay Human: Reloaded Edition', 'Big Walk', 'Signalis']);
});

test('the catalog posts are a different kind, and "and more" is not a game', () => {
  const got = parseAnnouncement(
    'PlayStation Plus Game Catalog for October: Mafia: The Old Country, Horizon Forbidden West, Mycopunk and more',
  );
  assert.equal(got.kind, 'catalog');
  assert.deepEqual(got.games, ['Mafia: The Old Country', 'Horizon Forbidden West', 'Mycopunk']);
});

test('an Oxford comma before "and more" goes too', () => {
  const got = parseAnnouncement(
    'PlayStation Plus Game Catalog for June: Final Fantasy XVI, Sonic X Shadow Generations, Kingdom Come: Deliverance, and more',
  );
  assert.deepEqual(got.games, ['Final Fantasy XVI', 'Sonic X Shadow Generations', 'Kingdom Come: Deliverance']);
});

test('a regional edition is refused, not adapted', () => {
  // Southeast Asia gets a different line-up. It is not wrong; it is not ours.
  assert.equal(
    parseAnnouncement(
      '(For Southeast Asia) PlayStation Plus Monthly Games for January 2025: Suicide Squad: Kill the Justice League, Need for Speed Hot Pursuit, DEEEER Simulator: Your Average Everyday Deer Game',
    ),
    null,
  );
});

test('anything that is not one of these posts is left alone', () => {
  for (const title of [
    'Share of the Week: 007 First Light',
    '15 must-play indies to mark 15 years of PlayStation Plus',
    'PlayStation Plus Game Catalog for June + New PlayStation Plus Extra and Deluxe 1st Anniversary Celebration',
    '',
    null,
  ]) {
    assert.equal(parseAnnouncement(title), null, `should not parse: ${title}`);
  }
});

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toUTCString();

test('the newest of each kind wins, and the two do not crowd each other out', () => {
  const best = newestOfEachKind([
    { title: 'PlayStation Plus Monthly Games for September - Wobbly Life, Chained Echoes', publishedAt: iso(40) },
    { title: 'PlayStation Plus Monthly Games for October: F1 25, Big Walk', publishedAt: iso(10) },
    { title: 'PlayStation Plus Game Catalog for October: Mycopunk, Signalis and more', publishedAt: iso(5) },
    { title: 'Share of the Week: nothing to do with this', publishedAt: iso(1) },
  ]);
  assert.deepEqual(best.monthly.games, ['F1 25', 'Big Walk']);
  assert.deepEqual(best.catalog.games, ['Mycopunk', 'Signalis']);
});

test('an announcement too old to be current is dropped rather than shown', () => {
  // The feeds keep carrying last season's posts. Presenting one as "free
  // right now" is worse than showing nothing.
  const best = newestOfEachKind([
    { title: 'PlayStation Plus Monthly Games for March: Slime Rancher 2, CrossCode', publishedAt: iso(200) },
  ]);
  assert.deepEqual(best, {});
});
