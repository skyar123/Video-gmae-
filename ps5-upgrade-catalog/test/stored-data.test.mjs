/**
 * Not writing over what you could not read.
 *
 * The PS Plus index read as empty for hours because of this: a read that
 * failed answered the same as a read that found nothing. The stored data was
 * fine and came back, but any scan running in that window would have written
 * its couple of hundred findings over all 1,941 games. The subscriber list is
 * the same shape and cannot be rebuilt at all, so both are pinned here.
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm, readFile } from 'node:fs/promises';

import { readBlob } from '../api/history.mjs';
import { scanPlusBatch, loadPlusIndex } from '../api/plus.mjs';
import { plusShardFor, plusShardKey } from '../api/keys.mjs';
import { handleAlertsRequest } from '../api/alerts.mjs';

/** Where the local fallback keeps every key when Netlify Blobs is absent. */
const STORE = new URL('../.price-history.local.json', import.meta.url).pathname;
const write = (value) => writeFile(STORE, typeof value === 'string' ? value : JSON.stringify(value));

afterEach(() => rm(STORE, { force: true }));

test('a read says whether it worked, not just what it found', async () => {
  await write({ 'a/key.json': { hello: true } });
  assert.deepEqual(await readBlob('a/key.json'), { ok: true, value: { hello: true } });

  // Absent is a fine answer and means empty.
  assert.deepEqual(await readBlob('not/stored.json'), { ok: true, value: null });

  // Unreadable is not, and must not be reported as empty.
  await write('{ not json at all');
  const broken = await readBlob('a/key.json');
  assert.equal(broken.ok, false);
  assert.ok(broken.error, 'says why');
});

test('a scan leaves an index it could not read exactly as it was', async () => {
  await write('{ not json at all');
  const before = await readFile(STORE, 'utf8');

  const outcome = await scanPlusBatch(['10005693', '10000661'], { limit: 2, gapMs: 0 });

  assert.equal(outcome.asked, 0, 'asks for nothing');
  assert.match(outcome.skipped ?? '', /could not be read/);
  assert.equal(await readFile(STORE, 'utf8'), before, 'and writes nothing');
});

test('the index is spread over shards, and the old single key is still read', async () => {
  const id = 10005693;
  const entry = { included: true, v: 2, at: new Date().toISOString(), ageRating: null };
  await write({ [plusShardKey(plusShardFor(id))]: { games: { [id]: entry } } });

  const fromShard = await loadPlusIndex();
  assert.ok(fromShard[id], 'a sharded game is found');

  // Anything written before the move is still part of the index.
  await write({ 'store/ps-plus.json': { games: { 999: entry } } });
  assert.ok((await loadPlusIndex())['999'], 'a legacy game is found');
});

test('subscribing over an unreadable list changes nothing and says so', async () => {
  const subscribers = {
    'alerts/subscribers.json': {
      tokenA: { token: 'tokenA', email: 'a@example.com', emailConfirmed: true, games: {} },
      tokenB: { token: 'tokenB', email: 'b@example.com', emailConfirmed: true, games: {} },
    },
  };
  await write(subscribers);

  const healthy = await handleAlertsRequest({
    method: 'POST',
    url: new URL('https://example.invalid/api/alerts'),
    body: { action: 'sync', token: 'tokenA', games: [], minDiscount: 10, region: 'US' },
  });
  assert.equal(healthy.status, 200);
  const after = JSON.parse(await readFile(STORE, 'utf8'));
  assert.equal(Object.keys(after['alerts/subscribers.json']).length, 2, 'both survive');

  await write('{ not json at all');
  const before = await readFile(STORE, 'utf8');
  // Subscribing refuses outright unless mail is configured, and that check
  // comes first, so the guard below is unreachable without this. Nothing is
  // sent: the read fails before any mail is attempted.
  const hadKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'not-a-real-key';
  const refused = await handleAlertsRequest({
    method: 'POST',
    url: new URL('https://example.invalid/api/alerts'),
    body: { action: 'subscribe', token: 'new', email: 'new@example.com', games: [] },
  });

  // 503 and untouched, rather than a signup that quietly becomes the whole
  // list and takes everyone else's alerts with it.
  if (hadKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = hadKey;

  assert.equal(refused.status, 503);
  assert.match(JSON.parse(refused.body).error, /Nothing was changed/);
  assert.equal(await readFile(STORE, 'utf8'), before);
});

/**
 * How the index is assembled from what could and could not be read.
 *
 * This is the path a live outage recovers through, so the cases are the ones
 * that actually happened rather than the ones that are easy to write.
 */
import { mergeIndexReads } from '../api/plus.mjs';

const absent = { ok: true, value: null };
const broken = { ok: false, value: null, error: 'could not read' };
const holding = (games) => ({ ok: true, value: { games } });
const shards = (...reads) => reads;

test('the live case: the old object stopped reading and no shard exists yet', () => {
  // Absent shards are not broken ones, so the run goes ahead and builds them
  // rather than standing off and leaving the collection short indefinitely.
  const index = mergeIndexReads([broken, ...shards(absent, absent, absent, absent)]);
  assert.equal(index.ok, true, 'the run proceeds');
  assert.equal(index.legacyOk, false, 'and knows the old object did not read');
  assert.deepEqual(index.games, {});
  assert.equal(index.failed.size, 0);
});

test('whatever the old object still holds is merged in, not stranded', () => {
  const index = mergeIndexReads([
    holding({ 1: { included: true } }),
    ...shards(holding({ 2: { included: false } }), absent),
  ]);
  assert.deepEqual(Object.keys(index.games).sort(), ['1', '2']);
});

test('one unreadable shard costs only its own games', () => {
  const index = mergeIndexReads([absent, ...shards(holding({ 5: {} }), broken, holding({ 7: {} }))]);
  assert.equal(index.ok, true);
  assert.deepEqual([...index.failed], [1], 'the run knows which shard to leave alone');
  assert.deepEqual(Object.keys(index.games).sort(), ['5', '7']);
});

test('every shard unreadable means the store is, and nothing should be written', () => {
  const index = mergeIndexReads([broken, ...shards(broken, broken, broken)]);
  assert.equal(index.ok, false);
});

/**
 * Filtering on what the rating board says about money.
 *
 * ESRB publishes "In-Game Purchases", and separately "In-Game Purchases
 * (Includes Random Items)" for the loot-box case, as interactive elements
 * beside the content descriptors. So this is a fact about the game rather
 * than a guess from its genre or its price.
 */
import { searchStore, hasInGamePurchases } from '../api/store.mjs';

const rating = (interactive) => ({
  family: 'mild', tier: 'everyone', source: 'ESRB', rating: 'E',
  official: true, descriptors: [], interactive, concerns: [],
});

test('both wordings the board uses count as selling inside', () => {
  assert.equal(hasInGamePurchases(rating(['In-Game Purchases'])), true);
  assert.equal(hasInGamePurchases(rating(['In-Game Purchases (Includes Random Items)'])), true);
  assert.equal(hasInGamePurchases(rating(['Digital Purchases'])), true);
  // Online chat is a different concern and must not be swept up with it.
  assert.equal(hasInGamePurchases(rating(['Users Interact'])), false);
  assert.equal(hasInGamePurchases(rating([])), false);
  assert.equal(hasInGamePurchases(null), false);
});

test('a game that sells inside is dropped, and silence is not a promise', async () => {
  const { plusShardFor, plusShardKey } = await import('../api/keys.mjs');
  // DREDGE, told by the board that it sells things inside.
  const id = 10005693;
  await write({
    [plusShardKey(plusShardFor(id))]: {
      games: { [id]: { v: 2, at: new Date().toISOString(), ageRating: rating(['In-Game Purchases']) } },
    },
  });

  const all = await searchStore({ q: 'dredge' });
  assert.ok((all.games ?? []).some((row) => row.id === id), 'it is there to begin with');

  const filtered = await searchStore({ q: 'dredge', noPurchases: true });
  assert.ok(!(filtered.games ?? []).some((row) => row.id === id), 'and gone once the filter is on');

  // Everything the scan has not reached is excluded too: not knowing whether
  // a game sells inside is not the same as knowing it does not.
  const unknown = (filtered.games ?? []).filter((row) => !row.ageRating);
  assert.deepEqual(unknown, [], 'nothing unrated slips through');
});
