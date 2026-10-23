import { warmYouTubePool } from '../../api/goss.mjs';
import { scanPlusBatch } from '../../api/plus.mjs';
import storeIndex from '../../api/store-index.json' with { type: 'json' };

/**
 * Fills the gossip feed's video pool on demand.
 *
 * The nightly job does this too, but a pool that is empty now is empty until
 * tonight, and the live rotation only manages a handful of feeds per rebuild.
 * Netlify runs a -background function for minutes rather than the ten seconds
 * a normal request gets, which is what asking 70 feeds politely needs.
 *
 * It refuses if the pool was warmed within the hour, so repeatedly calling it
 * cannot become seventy YouTube requests a go from one address. That makes it
 * safe to leave reachable without a secret to keep somewhere.
 */
export default async () => {
  // A PS Plus batch rides along, so coverage can be pushed forward without
  // waiting for tonight. It picks up where the last run stopped.
  try {
    // A much bigger bite than the nightly job takes. This function has
    // minutes, and at 8,885 games a 250-a-night scan is five weeks to first
    // full coverage; at 1,200 a run it is a handful of presses.
    const plus = await scanPlusBatch(storeIndex.map((row) => String(row.id)), { limit: 1200 });
    console.log(
      `PS Plus scan: ${plus.answered}/${plus.asked} answered, ` +
        `${plus.included} included of ${plus.checked} checked, ${plus.remaining} still to do`,
    );
  } catch (error) {
    console.error('PS Plus scan failed:', error);
  }

  const result = await warmYouTubePool({ minIntervalMs: 60 * 60 * 1000 });
  if (result.skipped) {
    console.log(`Video pool warm skipped: last warmed ${result.lastWarmAt}`);
    return;
  }
  console.log(
    `Video pool warmed: ${result.answered.length}/${result.asked} channels answered, ` +
      `${result.written} videos stored` +
      (result.silent.length ? `; silent: ${result.silent.join(', ')}` : ''),
  );
};
