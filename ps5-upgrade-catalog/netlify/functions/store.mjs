import { searchStore, storeGenres, storeSize } from '../../api/store.mjs';

/** GET /api/store — search the mirrored PlayStation Store index. */
export default async function handler(request) {
  const url = new URL(request.url);

  if (url.searchParams.get('facets') === '1') {
    const payload = { genres: await storeGenres(), size: await storeSize() };
    return json(payload);
  }

  const payload = await searchStore({
    q: url.searchParams.get('q') ?? '',
    genre: url.searchParams.get('genre') ?? '',
    platform: url.searchParams.get('platform') ?? '',
    sort: url.searchParams.get('sort') ?? 'relevance',
    page: Number(url.searchParams.get('page') ?? 0) || 0,
    exclude: (url.searchParams.get('exclude') ?? '').split('\n').filter(Boolean),
  });
  return json(payload);
}

const json = (payload) =>
  new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400',
    },
  });

export const config = { path: '/api/store' };
