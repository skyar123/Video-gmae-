/**
 * Reading a studio out of a store page that has no field for one.
 *
 * PlayStation publishes a publisher and no developer anywhere, checked
 * against The Last of Us Part I, whose concept page reports Sony
 * Interactive Entertainment and nothing about Naughty Dog. The studio is
 * on the page all the same, written into the copyright line or the
 * marketing copy, so it is read from there.
 *
 * The strings below are quoted from real pages fetched while writing
 * this, not invented, because the whole risk here is the shape of real
 * copy rather than the shape of a regex.
 *
 * Every test for a thing it must NOT read is as important as the ones for
 * what it must. A missing developer costs somebody a search. A wrong one
 * is a fact this app made up and then showed as if the store had said it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { developerFrom } from '../api/concept.mjs';

test('the three phrasings real pages actually use', () => {
  // Returnal, concept 10000176.
  assert.equal(developerFrom('Developed by Housemarque Oy'), 'Housemarque');
  // Horizon Forbidden West, concept 10000886.
  assert.equal(developerFrom('Developed by Guerrilla'), 'Guerrilla');
  // The Last of Us Part I, concept 10002694, in its LEGAL block.
  assert.equal(
    developerFrom(
      '©2022 Sony Interactive Entertainment LLC. Created and developed by Naughty Dog LLC. ' +
        'The Last of Us is a registered trademark of Sony Interactive Entertainment LLC.',
    ),
    'Naughty Dog',
  );
});

test('a studio nobody typed is never invented', () => {
  /*
   * God of War Ragnarök, concept 10001850, says "From Santa Monica Studio
   * comes the sequel to the critically acclaimed..." in its description
   * and never uses the word "developed" at all.
   *
   * A pattern loose enough to read that is loose enough to read half a
   * sentence of marketing as a company. So this returns nothing, and the
   * game shows no developer, which is the honest answer.
   */
  assert.equal(
    developerFrom('From Santa Monica Studio comes the sequel to the critically acclaimed'),
    null,
  );
  assert.equal(developerFrom(''), null);
  assert.equal(developerFrom(null), null);
  assert.equal(developerFrom(undefined), null);
});

test('a sentence is not a studio name', () => {
  // Each of these follows "developed by" with prose. Taking the next
  // forty characters would file a clause as a company.
  assert.equal(developerFrom('developed by the team that brought you everything'), null);
  assert.equal(developerFrom('developed by a small studio in their spare time'), null);
  assert.equal(developerFrom('Developed by '), null);
  assert.equal(developerFrom('Developed by X'), null);
});

test('the legal suffix comes off, so the name is the one people type', () => {
  // Nobody searches "Naughty Dog LLC".
  assert.equal(developerFrom('Developed by Naughty Dog LLC.'), 'Naughty Dog');
  assert.equal(developerFrom('Developed by Housemarque Oy.'), 'Housemarque');
  assert.equal(developerFrom('Developed by Bluepoint Games, Inc.'), 'Bluepoint Games');
  assert.equal(developerFrom('Developed by Larian Studios Games Ltd'), 'Larian Studios Games');
  assert.equal(developerFrom('Developed by Team Cherry Pty Ltd.'), 'Team Cherry');
});

test('it stops at the studio, not at the end of the sentence', () => {
  assert.equal(
    developerFrom('Developed by Housemarque in association with Sony Interactive Entertainment'),
    'Housemarque',
  );
  assert.equal(
    developerFrom('Developed by Bluepoint Games and published by Sony'),
    'Bluepoint Games',
  );
});

test('markup and entities in the copy do not reach the name', () => {
  // The LEGAL block is HTML, so this is read out of tags and escapes.
  assert.equal(developerFrom('<br/>Developed by Smith &amp; Jones Ltd.'), 'Smith & Jones');
  assert.equal(developerFrom('Developed by Housemarque<br/>All rights reserved'), 'Housemarque');
});

test('the first credit wins, and reading it twice gives the same answer', () => {
  // Pages repeat the line in the description and again in LEGAL. Two
  // reads of one page must not produce two different studios.
  const page = 'Developed by Guerrilla. Later: Developed by Somebody Else.';
  assert.equal(developerFrom(page), 'Guerrilla');
  assert.equal(developerFrom(page), developerFrom(page));
});

test('a studio is named the way somebody would type it', async () => {
  const { studioName } = await import('../api/search.mjs');

  // Nobody searches the registered form, and a button reading
  // "Bit Planet Games, LLC" looks like a database leaked into the page.
  assert.equal(studioName('Naughty Dog LLC'), 'Naughty Dog');
  assert.equal(studioName('Bit Planet Games, LLC'), 'Bit Planet Games');
  assert.equal(studioName('Housemarque Oy'), 'Housemarque');
  assert.equal(studioName('Atari, Inc.'), 'Atari');
  assert.equal(studioName('Rare Ltd.'), 'Rare');

  // Two halves, which needs more than one pass.
  assert.equal(studioName('Gust Co. Ltd.'), 'Gust');
  assert.equal(studioName('SIMS Co., Ltd.'), 'SIMS');

  // Multi-word forms come off whole. Taking tokens one at a time turned
  // "Byte Barrel Sp. z o.o." into "BYTE BARREL SP", which is not a
  // tidier name, it is a broken one.
  assert.equal(studioName('Byte Barrel Sp. z o.o.'), 'Byte Barrel');
  assert.equal(studioName('SIMTERACT Sp. z o.o.'), 'SIMTERACT');

  // And names that only look like suffixes are left alone. A studio
  // stripped to nothing, or to two letters, is worse than one that kept
  // a word it did not need.
  assert.equal(studioName('The Chinese Room'), 'The Chinese Room');
  assert.equal(studioName('Team Asobi'), 'Team Asobi');
  assert.equal(studioName('SNK'), 'SNK');
  assert.equal(studioName('M2'), 'M2');
  assert.equal(studioName('Oy'), 'Oy');
  assert.equal(studioName(''), '');
  assert.equal(studioName(null), '');
});
