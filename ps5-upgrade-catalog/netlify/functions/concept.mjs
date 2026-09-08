import { loadConceptDetail } from '../../api/concept.mjs';

/** GET /api/concept?id=<conceptId> — full detail for one store game. */
export default async function handler(request) {
  const params = new URL(request.url).searchParams;
  const id = Number(params.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return new Response(JSON.stringify({ error: 'a numeric id is required' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const detail = await loadConceptDetail(id, (params.get('cc') ?? 'US').toUpperCase());
  return new Response(JSON.stringify(detail ?? { error: 'not found' }), {
    status: detail ? 200 : 404,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=600, s-maxage=1800, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/concept' };
