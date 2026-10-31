#!/usr/bin/env node
/**
 * Checks catalog entries written elsewhere, and merges the ones that hold up.
 *
 * The catalog is hand-made and its value is that every line in it is true.
 * Entries drafted by another model are worth having and are not worth
 * trusting, so nothing here is taken on faith: every field is checked against
 * the vocabularies the catalog already uses, every title has to match a game
 * the store mirror actually lists, and anything that fails is reported and
 * dropped rather than repaired. A silent fix is how a wrong fact gets in.
 *
 *   node scripts/merge-entries.mjs draft.json            # check, change nothing
 *   node scripts/merge-entries.mjs draft.json --write    # merge what passed
 */

import { readFileSync, writeFileSync } from 'node:fs';

const GAMES = new URL('../src/games.json', import.meta.url);
const INDEX = new URL('../api/store-index.json', import.meta.url);

const file = process.argv[2];
const write = process.argv.includes('--write');
if (!file) {
  console.error('usage: node scripts/merge-entries.mjs <draft.json> [--write]');
  process.exit(2);
}

const catalog = JSON.parse(readFileSync(GAMES, 'utf8'));
const mirror = JSON.parse(readFileSync(INDEX, 'utf8'));

const allowed = {
  genre: new Set(catalog.map((g) => g.genre)),
  artStyle: new Set(catalog.map((g) => g.artStyle)),
  protagonist: new Set(catalog.map((g) => g.protagonist)),
  tags: new Set(catalog.flatMap((g) => g.tags ?? [])),
};
const KEYS = ['title', 'genre', 'artStyle', 'protagonist', 'tags', 'description'];

const fold = (text) => String(text ?? '').trim().toLowerCase();
const byName = new Map(mirror.map((row) => [fold(row.name), row]));
const already = new Set(catalog.map((g) => fold(g.title)));

/** A model asked for JSON often returns it wrapped in prose or a fence. */
function parseDraft(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('no JSON array found in the file');
  return JSON.parse(trimmed.slice(start, end + 1));
}

const taken = new Set(catalog.map((game) => game.id));

/** The catalog's own id style, with the concept id only to break a tie. */
function slugFor(row) {
  const base =
    String(row.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || `game-${row.id}`;
  let id = base;
  if (taken.has(id)) id = `${base}-${row.id}`;
  taken.add(id);
  return id;
}

function upgradeFor(platforms) {
  const ps4 = platforms.includes('PS4');
  const ps5 = platforms.includes('PS5');
  if (ps5 && !ps4) return 'PS5 Only';
  if (ps4 && !ps5) return 'Backwards Compatible';
  return null;
}

const draft = parseDraft(readFileSync(file, 'utf8'));
if (!Array.isArray(draft)) throw new Error('the draft is not an array');

const kept = [];
const problems = [];
const note = (entry, why) => problems.push({ title: entry?.title ?? '(no title)', why });

for (const entry of draft) {
  if (!entry || typeof entry !== 'object') {
    note(entry, 'not an object');
    continue;
  }
  const extra = Object.keys(entry).filter((key) => !KEYS.includes(key));
  if (extra.length) {
    note(entry, `unexpected keys: ${extra.join(', ')}`);
    continue;
  }
  const missing = KEYS.filter((key) => entry[key] === undefined);
  if (missing.length) {
    note(entry, `missing: ${missing.join(', ')}`);
    continue;
  }

  // The title has to be a game the mirror lists, or it is not a real game.
  const row = byName.get(fold(entry.title));
  if (!row) {
    note(entry, 'no game by that name in the store mirror');
    continue;
  }
  if (already.has(fold(entry.title))) {
    note(entry, 'already written up');
    continue;
  }

  let bad = false;
  for (const field of ['genre', 'artStyle', 'protagonist']) {
    if (!allowed[field].has(entry[field])) {
      note(entry, `${field} "${entry[field]}" is not one the catalog uses`);
      bad = true;
    }
  }
  if (!Array.isArray(entry.tags) || entry.tags.some((tag) => !allowed.tags.has(tag))) {
    note(entry, `tags ${JSON.stringify(entry.tags)} are not all ones the catalog uses`);
    bad = true;
  }
  const words = String(entry.description ?? '');
  if (words.length < 40 || words.length > 200) {
    note(entry, `description is ${words.length} characters, wanted 40-200`);
    bad = true;
  }
  if (/critically acclaimed|must[- ]play|beloved|!/i.test(words)) {
    note(entry, 'description reads as marketing copy');
    bad = true;
  }
  if (bad) continue;

  kept.push({
    // Slugs, because that is what the catalog uses: outer-wilds, not an id.
    id: slugFor(row),
    title: row.name,
    genre: entry.genre,
    artStyle: entry.artStyle,
    protagonist: entry.protagonist,
    tags: entry.tags,
    representation: [],
    description: words.trim(),
    // Everything factual comes from the store, never from the draft.
    platform: (row.platforms ?? []).length === 1 && row.platforms[0] === 'PS5' ? 'PS5' : 'PS4',
    /*
     * Null where the store does not say, rather than a guess.
     *
     * A game listed on both PS4 and PS5 might be cross-buy, a free upgrade or
     * a paid one, and the mirror records none of that. The first version of
     * this wrote "PS4 & PS5 Cross-Buy" for every one of them, which is a
     * claim about what someone gets for their money, invented here. The whole
     * point of this script is that facts come from the store.
     */
    ps5Upgrade: upgradeFor(row.platforms ?? []),
    ageRating: row.ageRating ?? null,
    ratings: null,
    steamAppId: null,
    psnStorePath: `concept/${row.id}`,
    coverage: [],
  });
}

// Counted by entry, not by complaint: one entry can fail on several fields
// at once, and "6 entries, 1 passed, 6 dropped" is not a sum anyone can read.
const dropped = new Set(problems.map((problem) => problem.title)).size;
console.log(`draft: ${draft.length} entries`);
console.log(`  pass: ${kept.length}`);
console.log(`  drop: ${dropped} (${problems.length} problems)`);
for (const problem of problems) console.log(`    ${String(problem.title).slice(0, 40).padEnd(40)} ${problem.why}`);

if (!write) {
  console.log('\nnothing written. pass --write to merge the ones that passed.');
  process.exit(0);
}
if (kept.length === 0) {
  console.log('\nnothing passed, so nothing to merge.');
  process.exit(1);
}
writeFileSync(GAMES, `${JSON.stringify([...catalog, ...kept], null, 2)}\n`);
console.log(`\nmerged. the catalog is now ${catalog.length + kept.length} entries.`);
