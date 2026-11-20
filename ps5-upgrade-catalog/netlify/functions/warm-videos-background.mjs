import { warmYouTubePool } from '../../api/goss.mjs';
import { scanPlusBatch } from '../../api/plus.mjs';
import { sweepForReleases } from '../../api/upcoming.mjs';
import { ratingScore } from '../../api/store.mjs';
import storeIndex from '../../api/store-index.json' with { type: 'json' };

/** The mirror in the order the reader browses it, best rated first. */
const browseOrderIds = () =>
  [...storeIndex].sort((a, b) => ratingScore(b) - ratingScore(a)).map((row) => String(row.id));

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
    // Sized to the window rather than to optimism. A background function
    // gets fifteen minutes; at about a second a game, 1,200 was twenty
    // minutes and got killed. 500 leaves room for the video warm that
    // follows, and progress is checkpointed either way.
    const plus = await scanPlusBatch(browseOrderIds(), { limit: 500 });
    console.log(
      `PS Plus scan: ${plus.answered}/${plus.asked} answered, ` +
        `${plus.included} included and ${plus.rated} rated of ${plus.checked} checked, ${plus.remaining} still to do`,
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
  /*
   * A short slice of the calendar sweep, last and on a short leash.
   *
   * sweep-calendar.mjs runs this nightly with the full budget, and a
   * scheduled function cannot be invoked over HTTP, so this is the only way
   * to move a stale calendar on without waiting for tonight. Ninety seconds
   * and last in the queue, because the first time it was added to this
   * function it went first with no budget and stopped the PS Plus scan
   * advancing at all.
   */
  try {
    const sweep = await sweepForReleases({ budgetMs: 90_000 });
    console.log(
      `Swept ${sweep.scanned} concepts ${sweep.from}-${sweep.to}` +
        `${sweep.stoppedEarly ? ' (cut short, resumes from the cursor)' : ''}: ` +
        `${sweep.calendar} on the calendar, ${sweep.recent} just out`,
    );
  } catch (error) {
    console.error('Calendar sweep failed:', error);
  }
};
