import { gossDiagnostics, loadGoss } from '../../api/goss.mjs';
import { igdbStatus } from '../../api/igdb.mjs';

/** GET /api/goss: industry chatter, trailer drops and review drops, in bursts. */
export default async function handler(request) {
  const params = new URL(request.url).searchParams;
  const base = await loadGoss();
  // The IGDB probe is a live request, so it runs only when somebody asks for
  // the diagnostics. It sits here next to youtube:key because this is where
  // anyone checking whether a key took effect already looks.
  const payload =
    params.get('debug') === '1'
      ? { ...base, sources: { ...gossDiagnostics(), 'igdb:key': await igdbStatus() } }
      : base;
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/goss' };
