import catalog from '../../src/games.json' with { type: 'json' };
import { CACHE_HEADER, handleGamesRequest } from '../../api/steam.mjs';

/**
 * GET /api/games?chunk=0        -> live data for catalog entries 0-14
 * GET /api/games?title=Stray    -> live data for a single title
 * Optional: &cc=GB for another storefront region.
 */
export default async function handler(request) {
  const { status, body } = await handleGamesRequest(new URL(request.url), catalog);
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? CACHE_HEADER : 'no-store',
    },
  });
}

export const config = { path: '/api/games' };
