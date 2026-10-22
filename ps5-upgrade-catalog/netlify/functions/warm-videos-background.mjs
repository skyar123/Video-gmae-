import { warmYouTubePool } from '../../api/goss.mjs';
import { saveBlob } from '../../api/history.mjs';
import { fetchPlusConceptIds } from '../../api/plus.mjs';
import { PLUS_KEY } from '../../api/keys.mjs';

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
  // The PS Plus list rides along: it is one request, it has nothing to do
  // with the hourly video guard, and waiting until tonight for it would mean
  // the whole library shows no Plus badges until then.
  try {
    const ids = await fetchPlusConceptIds();
    if (ids) {
      await saveBlob(PLUS_KEY, { ids, at: new Date().toISOString() });
      console.log(`PS Plus catalog: ${ids.length} concept ids stored`);
    } else {
      console.log('PS Plus catalog: unreadable, keeping the stored list');
    }
  } catch (error) {
    console.error('PS Plus catalog refresh failed:', error);
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
