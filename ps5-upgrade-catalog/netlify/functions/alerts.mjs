import { handleAlertsRequest } from '../../api/alerts.mjs';

/** /api/alerts — price-drop email subscriptions, confirm and unsubscribe. */
export default async function handler(request) {
  const url = new URL(request.url);
  let body = null;
  if (request.method === 'POST') {
    body = await request.json().catch(() => null);
  }

  const result = await handleAlertsRequest({ method: request.method, url, body });
  return new Response(result.body, {
    status: result.status,
    headers: { 'content-type': result.type, 'cache-control': 'no-store' },
  });
}

export const config = { path: '/api/alerts' };
