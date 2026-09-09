import { loadBlob } from '../../api/history.mjs';
import { BACKTEST_KEY } from '../../api/keys.mjs';

/** GET /api/backtest — how the price predictor has actually scored so far. */
export default async function handler() {
  const stored = await loadBlob(BACKTEST_KEY);
  const payload =
    stored && typeof stored.samples === 'number'
      ? stored
      : { ready: false, samples: 0, needs: 'The nightly job has not scored the predictor yet.' };

  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/backtest' };
