import { loadUpcoming } from '../../api/upcoming.mjs';

/** GET /api/upcoming — release calendar, re-read from the PS Store. */
export default async function handler() {
  const payload = await loadUpcoming();
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=1800, s-maxage=21600, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/upcoming' };
