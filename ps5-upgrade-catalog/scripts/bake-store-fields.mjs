/**
 * Teaches the written-up catalog what the store calls its games.
 *
 * The model learns from whatever a liked game is made of, and a liked
 * write-up is made of a genre, an art style, a lead and some tags, none of
 * which any game in the mirror has. The join is what bridges that: 398 of the
 * 506 write-ups name a game the mirror also carries, so liking one can teach
 * store genres and release years that apply to all 9,222.
 *
 * On a phone that join has nothing to join to. The catalog there is matched
 * only against store rows already cached, which for most readers is none, so
 * a profile built from five liked write-ups went out with zero store-side
 * features in it and the picks from the mirror were ranked on reputation
 * alone. The harness, holding the whole index, had been measuring the other
 * case all along: what it reported was not what shipped.
 *
 * So the join is done here, once, and its result is written into the catalog
 * the phone already carries. It also carries the store's key art across,
 * which is what a PlayStation exclusive needs most: see storeArt below. The fields are named apart from the mirror's own
 * so nothing that renders a store row picks them up by accident.
 *
 *   node scripts/bake-store-fields.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeTitle } from '../src/genius.js';

const catalogPath = new URL('../src/games.json', import.meta.url);
const catalog = JSON.parse(readFileSync(catalogPath));
const rows = JSON.parse(readFileSync(new URL('../api/store-index.json', import.meta.url)));

const byTitle = new Map();
for (const row of rows) {
  const key = normalizeTitle(row.name);
  if (key && !byTitle.has(key)) byTitle.set(key, row);
}

let joined = 0;
let changed = 0;
const next = catalog.map((entry) => {
  const row = byTitle.get(normalizeTitle(entry.title));
  if (!row) {
    // Nothing to add, and anything baked before must go if the match is gone.
    const rest = { ...entry };
    for (const key of ['storeId', 'storeGenres', 'storeRelease', 'plusIncluded', 'storeArt']) {
      if (key in rest) {
        delete rest[key];
        changed += 1;
      }
    }
    return rest;
  }
  joined += 1;
  const baked = {
    ...entry,
    storeId: row.id,
    storeGenres: row.genres ?? [],
    storeRelease: row.release ?? null,
    plusIncluded: row.plus?.included === true,
    /*
     * The key art, which until now a PlayStation exclusive simply did not
     * have. A card's art came from Valve, so anything Valve has never heard
     * of fell through to a coloured gradient with the title printed on it:
     * 211 of the 506 write-ups, and not a random 211. They are the ones this
     * app is most about, because a game that is only on PlayStation is
     * exactly the game Steam cannot answer for. Astro Bot, Demon's Souls,
     * Gran Turismo 7, Alan Wake 2, the whole Sly Cooper and Jak and Daxter
     * shelf, all blank.
     *
     * The mirror had the art the whole time. It is baked in so a card can
     * draw it on first paint, with no request at all.
     */
    storeArt: row.art ?? null,
  };
  if (JSON.stringify(baked) !== JSON.stringify(entry)) changed += 1;
  return baked;
});

writeFileSync(catalogPath, `${JSON.stringify(next, null, 2)}\n`);

const size = (value) => `${(JSON.stringify(value).length / 1024).toFixed(0)}KB`;
console.log(`${joined} of ${catalog.length} write-ups matched a store row`);
console.log(`${changed} entries changed`);
console.log(`catalog ${size(catalog)} -> ${size(next)}`);
