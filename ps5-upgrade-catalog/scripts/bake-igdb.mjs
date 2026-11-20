/**
 * Give the other 9,222 games some words.
 *
 * The store publishes a name, a coarse genre and nothing else, so eleven of
 * the kinds of game this app can be asked for reach the mirror not at all:
 * cozy searches 113 games out of 9,728, pixel art searches 57. This walks
 * the mirror, asks IGDB about each row, and writes the genres, themes and
 * keywords of the ones it can join confidently.
 *
 * Three things shape how it runs.
 *
 * It is slow on purpose. IGDB allows four requests a second and the client
 * serialises them, so a full walk is about forty minutes. There is no way
 * to make that faster that does not involve being rude to a free service.
 *
 * It is resumable, because forty minutes is long enough for something to go
 * wrong. Every row already in the output file is skipped, so a second run
 * picks up where the first stopped, and --force starts again.
 *
 * And it writes what it learned even when it stops early. A run that found
 * two thousand joins and then hit a network error should not throw them
 * away: the guard that once discarded 68 repaired developer names because
 * nothing new was learned is a mistake worth not repeating.
 *
 * Run it with credentials in the environment:
 *   TWITCH_CLIENT_ID=... TWITCH_CLIENT_SECRET=... npm run bake:igdb -- --limit 200
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { igdbKeys, searchIgdb } from '../api/igdb.mjs';
import { enrichmentOf, pickMatch } from '../api/igdb-match.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'api', 'igdb-labels.json');
const INDEX = path.join(here, '..', 'api', 'store-index.json');

const arg = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? (process.argv[at + 1] ?? true) : fallback;
};

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

async function main() {
  if (!igdbKeys()) {
    console.error(
      'No credentials. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET and run this again.',
    );
    process.exitCode = 1;
    return;
  }

  const rows = read(INDEX, []);
  const existing = arg('force') ? {} : read(OUT, {});
  const limit = Number(arg('limit', Infinity)) || Infinity;

  /*
   * Rows nobody has asked about yet, most reviewed first.
   *
   * Order matters because a partial run is the normal case. Walking the
   * index in its own order starts with one-vote shovelware; walking it by
   * how many people have voted means a run that covers a tenth of the
   * mirror still covers the tenth anybody is likely to search for.
   */
  const todo = rows
    .filter((row) => existing[String(row.id)] === undefined)
    .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
    .slice(0, limit);

  console.log(`${rows.length} rows, ${Object.keys(existing).length} already asked, ${todo.length} to do`);

  const learned = { ...existing };
  const tally = { matched: 0, described: 0, settled: 0, missed: 0, errors: 0 };
  let since = Date.now();

  const save = () => {
    // Sorted so the file is a readable diff rather than a reshuffle.
    const sorted = Object.fromEntries(
      Object.entries(learned).sort(([a], [b]) => Number(a) - Number(b)),
    );
    fs.writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`);
  };

  for (const [at, row] of todo.entries()) {
    try {
      const candidates = await searchIgdb(row.name, { limit: 8 });
      const hit = pickMatch(row, candidates ?? []);
      if (!hit) {
        // Recorded as asked-and-missed, so a resumed run does not ask again.
        learned[String(row.id)] = null;
        tally.missed += 1;
      } else {
        if (hit.why !== 'one exact title') tally.settled += 1;
        const fields = enrichmentOf(hit.game);
        learned[String(row.id)] = fields;
        tally.matched += 1;
        if (fields) tally.described += 1;
      }
    } catch (error) {
      tally.errors += 1;
      console.error(`  ${row.name}: ${String(error.message).slice(0, 90)}`);
      if (tally.errors > 25) {
        console.error('Too many failures in a row, stopping and keeping what was learned.');
        break;
      }
    }

    // Written as it goes, because a long run that loses everything on the
    // last request has wasted an hour of somebody else's rate limit too.
    if (Date.now() - since > 30_000) {
      save();
      since = Date.now();
      console.log(`  ${at + 1}/${todo.length} asked, ${tally.described} described`);
    }
  }

  save();
  const asked = tally.matched + tally.missed;
  const pct = (n) => (asked === 0 ? '0%' : `${Math.round((n / asked) * 100)}%`);
  console.log(
    `\nasked ${asked}: matched ${tally.matched} (${pct(tally.matched)}), ` +
      `described ${tally.described} (${pct(tally.described)}), ` +
      `settled by tie-break ${tally.settled}, missed ${tally.missed}, errors ${tally.errors}`,
  );
  console.log(`written to ${path.relative(process.cwd(), OUT)}`);
}

await main();
