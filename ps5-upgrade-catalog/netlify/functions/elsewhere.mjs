import { searchElsewhere } from '../../api/elsewhere.mjs';

/** GET /api/elsewhere?q= — PC games matching a search the catalog could not answer. */
export default async function handler(request) {
  const params = new URL(request.url).searchParams;
  const payload = await searchElsewhere(params.get('q') ?? '', {
    country: params.get('cc') ?? 'US',
  });
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/elsewhere' };
