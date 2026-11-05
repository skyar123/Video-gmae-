/**
 * What the store page says beyond the headline price.
 *
 * The fixture is a trimmed capture of a real PlayStation Store concept page,
 * because this parser reads an Apollo cache embedded in HTML and the only
 * honest test of that is the real thing. Everything here was checked against
 * what the store showed that day.
 *
 * The case it exists for was reported from a phone: a card reading $59.99
 * while the same page sold the Digital Deluxe for $24.49, 65% off, with the
 * game inside it. The $59.99 was not wrong. It was just not the whole page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { betterOffer, parseEditions } from '../api/psn.mjs';

const html = readFileSync(new URL('./fixtures/psn-editions.html', import.meta.url), 'utf8');

test('every edition on the page, cheapest first', () => {
  const editions = parseEditions(html);
  assert.deepEqual(
    editions.map((edition) => [edition.name, edition.price, edition.wasPrice]),
    [
      ['Persona 3 Reload Digital Deluxe Edition PS4 & PS5', '$24.49', '$69.99'],
      ['Persona 3 Reload Digital Premium Edition PS4 & PS5', '$31.49', '$89.99'],
      ['Persona 3 Reload PS4 & PS5', '$59.99', null],
    ],
  );
});

test('names come back readable, and once each', () => {
  const editions = parseEditions(html);
  // The page stores "&" as & and keeps more than one copy of each
  // product, so without decoding and de-duplicating this returned six
  // editions, three of them ending "PS4 & PS5".
  for (const edition of editions) {
    assert.ok(!edition.name.includes('\\u'), `undecoded name: ${edition.name}`);
    assert.ok(edition.name.includes('&'), `lost the ampersand: ${edition.name}`);
  }
  assert.equal(new Set(editions.map((edition) => edition.name)).size, editions.length);
});

test('a sale carries the moment it stops', () => {
  const [deluxe] = parseEditions(html);
  assert.equal(deluxe.endsAt, '2026-11-05T07:59:00.000Z');
  // The undiscounted edition has nothing to end.
  assert.equal(parseEditions(html).at(-1).wasPrice, null);
});

test('the better offer is named, or there is not one', () => {
  const editions = parseEditions(html);
  // Against the standard edition's own price, the Deluxe is the answer.
  assert.equal(betterOffer(editions, { final: 5999 }).name, editions[0].name);
  assert.equal(betterOffer(editions, { final: 5999 }).price, '$24.49');

  // Nothing is offered when the headline is already the cheapest thing on
  // the page: a card that says "cheaper elsewhere" about its own price is
  // worse than saying nothing.
  assert.equal(betterOffer(editions, { final: 2449 }), null);
  assert.equal(betterOffer(editions, { final: 100 }), null);

  // And nothing from nothing.
  assert.equal(betterOffer([], { final: 5999 }), null);
  assert.equal(betterOffer(editions, null), null);
  assert.equal(betterOffer(null, { final: 5999 }), null);
});

test('a page with no editions in it is not an error', () => {
  assert.deepEqual(parseEditions(''), []);
  assert.deepEqual(parseEditions('<html><body>nothing here</body></html>'), []);
  assert.deepEqual(parseEditions(null), []);
});
