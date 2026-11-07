/**
 * How a run divides its attention.
 *
 * Both of these are arithmetic that looked obviously right and was not: the
 * first version of each shipped a bug that only a table of cases exposed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { planPlusBatch } from '../api/plus.mjs';
import { spreadBySource } from '../api/goss.mjs';

const range = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test('a scan run splits its budget between new games and re-reads', () => {
  // The case that stalled coverage: 7,185 never seen, 504 due a re-read.
  // Taking the due list in browse order spent every run on the re-reads,
  // because browse order is best-rated first and that is where they are.
  const batch = planPlusBatch(range(7185, 'new'), range(504, 'old'), 500);
  assert.equal(batch.length, 500);
  assert.equal(batch.filter((id) => id.startsWith('new')).length, 350);
  assert.equal(new Set(batch).size, batch.length, 'no game asked for twice');
});

test('a queue that runs dry hands its share to the other', () => {
  assert.equal(planPlusBatch([], range(504, 'old'), 500).length, 500);
  assert.equal(planPlusBatch(range(7185, 'new'), [], 500).length, 500);
});

test('a run short of work asks for what there is, not less', () => {
  const batch = planPlusBatch(range(100, 'new'), range(10, 'old'), 500);
  assert.equal(batch.length, 110);
});

test('nothing due asks for nothing', () => {
  assert.deepEqual(planPlusBatch([], [], 500), []);
});

const rows = [
  ...range(10, 'PlayStation:').map((link) => ({ source: 'PlayStation', link })),
  ...range(6, 'penguinz0:').map((link) => ({ source: 'penguinz0', link })),
  ...['Gab Smolders', 'LauraKBuzz', 'The Sphere Hunter', 'Ginny Di', 'Dicebreaker']
    .map((source) => ({ source, link: source })),
];

test('no channel gets a second video while another is still waiting', () => {
  const picked = spreadBySource(rows, 12);
  const counts = new Map();
  for (const row of picked) counts.set(row.source, (counts.get(row.source) ?? 0) + 1);

  // Everyone who posted is represented before anyone is doubled up. Taking
  // the freshest twelve instead gave ten PlayStation uploads and two others.
  assert.equal(counts.size, 7);
  const available = new Map();
  for (const row of rows) available.set(row.source, (available.get(row.source) ?? 0) + 1);
  const waiting = [...available].filter(([source, n]) => (counts.get(source) ?? 0) < n);
  const lowest = Math.min(...waiting.map(([source]) => counts.get(source) ?? 0));
  for (const [source] of waiting) {
    assert.ok(
      (counts.get(source) ?? 0) <= lowest + 1,
      `${source} took more while ${lowest} was still on offer`,
    );
  }
});

test('a thin roster still fills the feed', () => {
  // Only one channel posted. Spreading cannot help, and must not leave the
  // feed short on account of it.
  const only = range(10, 'PlayStation:').map((link) => ({ source: 'PlayStation', link }));
  assert.equal(spreadBySource(only, 6).length, 6);
});

test('asking for more than exists returns what exists, once each', () => {
  const picked = spreadBySource(rows, 999);
  assert.equal(picked.length, rows.length);
  assert.equal(new Set(picked.map((r) => r.link)).size, rows.length);
});
