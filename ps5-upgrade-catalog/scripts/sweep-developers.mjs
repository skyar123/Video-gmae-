/**
 * Fill in the studios Wikidata does not know, from the store's own pages.
 *
 * The baked set from Wikidata covers 2,517 of 9,222 games, and the ones
 * it misses are not evenly spread: Helldivers 2, Astro Bot, Clair Obscur
 * and Ghost of Yotei were all missing, which are games people open. The
 * store's own page names the studio for a good share of them, in its
 * marketing copy or its copyright line, and that is the authoritative
 * answer for that exact PlayStation release.
 *
 * Measured before it was written: of the twenty most-played games with no
 * studio, five pages said "Developed by ...", and all five were right.
 *
 * It walks the gaps in the order people meet them, most played first, so
 * a run that is stopped early has still done the games that matter most.
 * Re-running it resumes: anything already known is skipped, so the file
 * only grows.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * An earlier version also read the copyright line, on the theory that the
 * holder who is not the publisher is the developer. Elden Ring's page
 * says "©BANDAI NAMCO Entertainment Inc. / ©2022 FromSoftware, Inc.",
 * which is exactly that shape and exactly right.
 *
 * Checked against twenty-five games whose studio was already known, it
 * agreed twice, disagreed three times and said nothing twenty times. It
 * offered "Bird Studio" for DRAGON BALL: Sparking! ZERO, which is the
 * manga's rights holder and not Spike Chunsoft who made the game; it
 * offered a fragment of Lucasfilm's trademark notice for STAR WARS Jedi:
 * Survivor, made by Respawn; and for Assassin's Creed Valhalla it offered
 * the words "or other countries".
 *
 * Wrong more often than right whenever it spoke. So it is gone, and the
 * gaps it would have filled stay gaps. A missing studio costs somebody a
 * search. A wrong one is a fact this app made up and then showed as
 * though the store had said it.
 *
 *   npm run sweep:developers -- --limit 400
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import baked from '../api/store-index.json' with { type: 'json' };
import known from '../api/developers.json' with { type: 'json' };
import { developerFrom } from '../api/concept.mjs';
import { fold, studioName } from '../api/search.mjs';

const STORE = 'https://store.playstation.com/en-us/concept';
const UA = 'Mozilla/5.0 (compatible; ps5-upgrade-catalog/1.0)';

/*
 * More than the runtime reads, because this runs once and the runtime
 * runs on every open. The credit sits below the description, which is
 * past the 200 KB the live read stops at on a long page.
 */
const READ_CAP = 400_000;
const GAP_MS = 350;

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] ? Number(process.argv[at + 1]) : fallback;
};
const limit = flag('limit', 400);

/** The head of the page, and no more of it than that. */
async function head(id) {
  const response = await fetch(`${STORE}/${id}`, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (text.length < READ_CAP) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return text;
}

const rows = baked.rows ?? baked;

/*
 * Everything already known, tidied on the way through.
 *
 * The whole file is rewritten at the end anyway, so a run repairs names
 * that were stored before the two sources agreed on a format rather
 * than leaving them for a re-fetch that would learn nothing new.
 */
let repaired = 0;
const found = Object.fromEntries(
  Object.entries(known).map(([key, name]) => {
    const tidy = studioName(name);
    if (tidy !== name) repaired += 1;
    return [key, tidy];
  }),
);
const gaps = rows
  .filter((row) => !found[fold(row.name ?? '')])
  .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
  .slice(0, limit);

console.error(`${Object.keys(found).length} known, ${gaps.length} gaps to try, most played first.\n`);

let learned = 0;
let silent = 0;
let failed = 0;
for (const [index, row] of gaps.entries()) {
  try {
    const html = await head(row.id);
    const developer = html ? developerFrom(html) : null;
    if (developer) {
      found[fold(row.name)] = developer;
      learned += 1;
      console.error(`  ${String(index + 1).padStart(4)} ${developer.padEnd(26)} ${row.name.slice(0, 40)}`);
    } else {
      silent += 1;
    }
  } catch {
    // One page that will not load is not a reason to lose the rest of a
    // run that has already cost several hundred requests.
    failed += 1;
  }
  await new Promise((resolve) => setTimeout(resolve, GAP_MS));
}

/*
 * A run that learns nothing can still have work to show.
 *
 * This guard was "learned === 0, write nothing", which is right for the
 * case it was built for: a run where every request failed should not
 * replace a good file with an empty one. It was wrong for the run that
 * found it, which was sweeping far enough down the tail to learn zero
 * and was also carrying nineteen repaired names. The guard threw them
 * away and reported success, so the repair looked done and was not.
 *
 * What it is actually guarding against is writing nothing of value, so
 * that is what it now asks.
 */
if (learned === 0 && repaired === 0) {
  console.error('\nNothing learned and nothing to repair. Leaving the file alone.');
  process.exit(1);
}

const target = fileURLToPath(new URL('../api/developers.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(found, null, 0)}\n`);
console.error(
  `\n+${learned} studios (${silent} pages did not say, ${failed} would not load)` +
    `${repaired > 0 ? `, ${repaired} names tidied` : ''}.` +
    `\n${Object.keys(found).length} games now have one.`,
);
