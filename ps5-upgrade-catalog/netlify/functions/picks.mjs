import { pickFromMirror } from '../../api/picks.mjs';

/**
 * POST /api/picks: games from the mirror ranked against a profile sent up
 * from the device. Nothing is read from or written to storage.
 */
export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST a profile to this' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'body is not JSON' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const result = await pickFromMirror(body);
  return new Response(JSON.stringify(result), {
    status: result.error ? 400 : 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The answer depends entirely on the body, so there is nothing a shared
      // cache could usefully hold.
      'cache-control': 'no-store',
    },
  });
}

export const config = { path: '/api/picks' };
