/**
 * How many of the 9,222 store rows can IGDB actually be joined to?
 *
 * Read-only and deliberately so. Enriching the mirror is worth doing only
 * if the join works, and the join is by name, which is the part that has
 * gone wrong in this codebase before. So this measures and writes nothing:
 * it takes a sample, asks IGDB about each one, runs the same matcher the
 * real bake would run, and reports what happened.
 *
 * The numbers worth reading are not just the match rate. `settled` counts
 * joins that needed a tie broken on platform or year, and that is where a
 * wrong join would hide: a high match rate made mostly of tie-breaks is a
 * worse result than a lower one made of unambiguous titles.
 *
 * A sample rather than the whole mirror because IGDB allows four requests a
 * second, so 9,222 rows is about forty minutes of walking. Deciding whether
 * that walk is worth taking is exactly what this is for.
 */

import { storeRows } from '../../api/store.mjs';
import { igdbKeys, searchIgdb } from '../../api/igdb.mjs';
import { enrichmentOf, pickMatch } from '../../api/igdb-match.mjs';

/** Bounded hard: this is a probe, not the job itself. */
const MAX_SAMPLE = 120;

export default async function handler(request) {
  const url = new URL(request.url);

  if (!igdbKeys()) {
    return Response.json(
      {
        ok: false,
        // Says what is missing and never what it would contain.
        reason:
          'No Twitch credentials on this deploy. Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in the site environment and redeploy.',
      },
      { status: 503 },
    );
  }

  const wanted = Math.min(Number(url.searchParams.get('n') ?? 40) || 40, MAX_SAMPLE);
  const rows = await storeRows();

  /*
   * An even spread rather than the first N.
   *
   * The index is ordered, so the first rows share a vintage and a corner of
   * the catalogue. A match rate measured on those says nothing about the
   * long tail, which is most of the mirror and the part with the least
   * written about it anywhere.
   */
  const step = Math.max(1, Math.floor(rows.length / wanted));
  const sample = [];
  for (let at = 0; at < rows.length && sample.length < wanted; at += step) sample.push(rows[at]);

  const report = { matched: [], missed: [], settled: 0, described: 0, errors: 0 };

  for (const row of sample) {
    try {
      const candidates = await searchIgdb(row.name, { limit: 8 });
      const hit = pickMatch(row, candidates ?? []);
      if (!hit) {
        report.missed.push({ name: row.name, sawCandidates: (candidates ?? []).length });
        continue;
      }
      if (hit.why !== 'one exact title') report.settled += 1;
      const fields = enrichmentOf(hit.game);
      if (fields) report.described += 1;
      report.matched.push({
        name: row.name,
        igdb: hit.game.name,
        why: hit.why,
        // The point of the whole exercise, so it is shown rather than counted.
        genres: fields?.genres ?? [],
        themes: fields?.themes ?? [],
        keywords: (fields?.keywords ?? []).slice(0, 6),
      });
    } catch (error) {
      report.errors += 1;
      if (report.errors > 5) {
        return Response.json(
          { ok: false, reason: `IGDB kept failing: ${String(error.message).slice(0, 160)}` },
          { status: 502 },
        );
      }
    }
  }

  const tried = report.matched.length + report.missed.length;
  const pct = (n) => (tried === 0 ? 0 : Math.round((n / tried) * 100));

  return Response.json({
    ok: true,
    sampled: tried,
    outOf: rows.length,
    matched: report.matched.length,
    matchRate: `${pct(report.matched.length)}%`,
    // Of the matches, how many carried the labels this is all for. A join
    // to a game IGDB has not described buys nothing.
    described: report.described,
    describedRate: `${pct(report.described)}%`,
    // Where a wrong join would hide.
    settledByTieBreak: report.settled,
    errors: report.errors,
    examples: report.matched.slice(0, 12),
    missedExamples: report.missed.slice(0, 12),
  });
}

export const config = { path: '/api/igdb-spike' };
