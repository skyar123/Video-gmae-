import { gossDiagnostics, loadGoss } from '../../api/goss.mjs';

/** GET /api/goss: industry chatter, trailer drops and review drops, in bursts. */
export default async function handler(request) {
  const params = new URL(request.url).searchParams;
  const base = await loadGoss();
  const payload = params.get('debug') === '1' ? { ...base, sources: gossDiagnostics() } : base;
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/goss' };
