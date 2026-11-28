/**
 * Bakes the release calendar shipped with a deploy.
 *
 * loadUpcoming serves the nightly sweep's blob, or this file until the first
 * sweep replaces it. That fallback is not a formality: the calendar ran on a
 * deploy-time snapshot for 58 days while the sweep reported success every
 * night, so the file a deploy carries is what readers actually see for long
 * stretches, and it is worth rebuilding whenever the mirror is rebuilt.
 *
 *   node scripts/bake-upcoming.mjs
 */
import { writeFileSync } from 'node:fs';
import { build } from '../api/upcoming.mjs';

const path = new URL('../api/upcoming-snapshot.json', import.meta.url);
const built = await build();

if (built.games.length === 0 && built.recent.length === 0) {
  console.error('build() came back empty, refusing to overwrite the snapshot');
  process.exit(1);
}

writeFileSync(path, `${JSON.stringify(built, null, 1)}\n`);
console.log(
  `${built.games.length} upcoming, ${built.recent.length} just released, ` +
    `${(JSON.stringify(built).length / 1024).toFixed(0)}KB`,
);
