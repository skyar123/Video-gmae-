import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasPs5Edition, playsOnPortal, PORTAL_CAVEAT } from '../src/portal.js';

test('a store row listing PS5 plays', () => {
  assert.equal(hasPs5Edition({ platforms: ['PS5'] }), true);
  assert.equal(hasPs5Edition({ platforms: ['PS4', 'PS5'] }), true);
});

test('a PS4-only store row does not', () => {
  assert.equal(hasPs5Edition({ platforms: ['PS4'] }), false);
});

test('the store answer wins over the written-up fields', () => {
  // The mirror is the live record; the write-up's own guess is the fallback.
  assert.equal(hasPs5Edition({ platform: 'PS4', storePlatforms: ['PS5'] }), true);
  assert.equal(
    hasPs5Edition({ platform: 'PS5', ps5Upgrade: 'PS5 Only', storePlatforms: ['PS4'] }),
    false,
  );
});

test('a written-up PS5 game plays', () => {
  assert.equal(hasPs5Edition({ platform: 'PS5' }), true);
});

test('a PS4 game with a PS5 edition plays, because that edition streams', () => {
  for (const upgrade of [
    'Free PS5 Upgrade',
    'Paid PS5 Upgrade',
    'PS4 & PS5 Cross-Buy',
    'PS5 Only',
  ]) {
    assert.equal(hasPs5Edition({ platform: 'PS4', ps5Upgrade: upgrade }), true, upgrade);
  }
});

test('backwards compatible is not a PS5 edition', () => {
  // It is a PS4 game running on PS5 hardware. The Portal streams neither the
  // hardware nor the PS4 game, so this is the case most likely to be got
  // wrong by treating "works on a PS5" as "is a PS5 game".
  assert.equal(hasPs5Edition({ platform: 'PS4', ps5Upgrade: 'Backwards Compatible' }), false);
});

test('a PS Plus Classic is not streamable to a Portal on its own', () => {
  assert.equal(hasPs5Edition({ platform: 'PS4', ps5Upgrade: 'PS Plus Classic' }), false);
});

test('unknown is not a yes', () => {
  assert.equal(hasPs5Edition({}), false);
  assert.equal(hasPs5Edition({ platform: 'PS4', ps5Upgrade: null }), false);
  assert.equal(hasPs5Edition(null), false);
  assert.equal(hasPs5Edition(undefined), false);
  assert.equal(hasPs5Edition({ platforms: [] }), false);
});

test('playsOnPortal tracks hasPs5Edition', () => {
  assert.equal(playsOnPortal({ platforms: ['PS5'] }), true);
  assert.equal(playsOnPortal({ platforms: ['PS4'] }), false);
});

test('the caveat does not promise a given PS5 game streams', () => {
  // The one thing this feature must never claim.
  assert.match(PORTAL_CAVEAT, /selection/);
  assert.match(PORTAL_CAVEAT, /PS4/);
});

test('it agrees with the real catalogue', async () => {
  const { default: catalog } = await import('../src/games.json', { with: { type: 'json' } });
  const plays = catalog.filter((game) => playsOnPortal(game));
  // Every written-up PS5 game must survive, or the filter is hiding games
  // the reader can play, which is the worse of the two failures.
  const ps5 = catalog.filter((game) => game.platform === 'PS5');
  for (const game of ps5) assert.equal(playsOnPortal(game), true, game.title);
  assert.ok(plays.length > ps5.length, 'PS4 games with a PS5 edition should be included too');
  assert.ok(plays.length < catalog.length, 'and PS4-only games should not be');
});
