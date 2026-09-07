import { feedDiagnostics, loadGameNews, loadNews } from '../../api/news.mjs';

/** GET /api/news — merged publisher feeds, or `?game=` for one title. */
export default async function handler(request) {
  const params = new URL(request.url).searchParams;
  const game = params.get('game');
  const base = game ? await loadGameNews(game) : await loadNews();
  const payload = params.get('debug') === '1' ? { ...base, feeds: feedDiagnostics() } : base;
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/news' };
