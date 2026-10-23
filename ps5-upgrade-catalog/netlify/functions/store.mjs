import { searchStore, storeGenres, storePlusCount, storeSize } from '../../api/store.mjs';

/** GET /api/store — search the mirrored PlayStation Store index. */
export default async function handler(request) {
  const url = new URL(request.url);

  if (url.searchParams.get('facets') === '1') {
    const payload = {
      genres: await storeGenres(),
      size: await storeSize(),
      // {included, checked, of}: how far the nightly PS Plus scan has got.
      // A missing badge means "not checked yet" until checked reaches of,
      // and saying so beats letting absence look like an answer.
      plus: await storePlusCount(),
    };
    return json(payload);
  }

  const payload = await searchStore({
    q: url.searchParams.get('q') ?? '',
    genre: url.searchParams.get('genre') ?? '',
    platform: url.searchParams.get('platform') ?? '',
    sort: url.searchParams.get('sort') ?? 'relevance',
    page: Number(url.searchParams.get('page') ?? 0) || 0,
    exclude: (url.searchParams.get('exclude') ?? '').split('\n').filter(Boolean),
    plusOnly: url.searchParams.get('plus') === '1',
    familyOnly: url.searchParams.get('family') === '1',
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
