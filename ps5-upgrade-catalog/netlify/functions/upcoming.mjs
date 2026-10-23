import { loadUpcoming, upcomingDiagnostics } from '../../api/upcoming.mjs';

/** GET /api/upcoming — release calendar, re-read from the PS Store. */
export default async function handler(request) {
  const base = await loadUpcoming();
  const debug = new URL(request.url).searchParams.get('debug') === '1';
  const payload = debug ? { ...base, source: upcomingDiagnostics() } : base;
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=1800, s-maxage=21600, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/upcoming' };
