/**
 * What the feed remembers about what you have opened.
 *
 * Small enough to read, and worth pinning anyway: this is the one piece of
 * the news panel that decides whether a story is *shown* to you, so a bug in
 * it hides things, and the only symptom is a reader quietly seeing less.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READ_MAX, markRead, parseRead } from '../src/read-state.js';

const MAX_BURSTS = 280; // what api/goss.mjs serves at most

test('opening a story marks it, and opening it again does not add it twice', () => {
  const once = markRead([], 'https://example.test/a');
  assert.deepEqual(once, ['https://example.test/a']);

  const twice = markRead(markRead(once, 'https://example.test/b'), 'https://example.test/a');
  assert.deepEqual(twice, ['https://example.test/b', 'https://example.test/a']);
  assert.equal(twice.filter((link) => link === 'https://example.test/a').length, 1);
});

test('re-reading the one you keep going back to makes it the last forgotten', () => {
  let links = [];
  for (const link of ['a', 'b', 'c']) links = markRead(links, link);
  links = markRead(links, 'a');
  assert.deepEqual(links, ['b', 'c', 'a']);
});

test('a no-op returns the same array, so nothing re-renders or re-writes storage', () => {
  const links = markRead([], 'a');
  assert.equal(markRead(links, 'a'), links);
  assert.equal(markRead(links, ''), links);
  assert.equal(markRead(links, null), links);
  assert.equal(markRead(links, 42), links);
});

test('nothing still in the feed can fall off the end and come back unread', () => {
  /*
   * The cap has to clear the feed, or a story you read this morning drops
   * out of the list while it is still on screen and reads as new again. The
   * same mistake once cost the catalog a rated game's own evidence, when a
   * cache trimmed rows that were still spoken for.
   */
  assert.ok(
    READ_MAX > MAX_BURSTS * 2,
    `a cap of ${READ_MAX} is too close to a feed of ${MAX_BURSTS}`,
  );

  let links = [];
  for (let at = 0; at < READ_MAX + 50; at += 1) links = markRead(links, `link-${at}`);
  assert.equal(links.length, READ_MAX);
  assert.equal(links.at(-1), `link-${READ_MAX + 49}`, 'the newest is kept');
  assert.equal(links[0], 'link-50', 'and the oldest went first');
});

test('whatever comes back from storage is treated as hostile', () => {
  assert.deepEqual(parseRead(null), []);
  assert.deepEqual(parseRead('not json at all'), []);
  assert.deepEqual(parseRead('{"not":"an array"}'), []);
  assert.deepEqual(parseRead('[1, null, {"link":"x"}, "https://ok.test/a", ""]'), [
    'https://ok.test/a',
  ]);
  assert.equal(parseRead(JSON.stringify(Array.from({ length: 5000 }, (_, i) => `l${i}`))).length, READ_MAX);
});
