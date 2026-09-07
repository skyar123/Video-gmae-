import { loadNews } from '../../api/news.mjs';

/** GET /api/news — merged publisher feeds, newest first. */
export default async function handler() {
  const payload = await loadNews();
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/news' };
