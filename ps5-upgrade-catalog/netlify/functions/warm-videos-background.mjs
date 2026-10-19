import { warmYouTubePool } from '../../api/goss.mjs';

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
