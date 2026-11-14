import { loadConceptDetail } from '../../api/concept.mjs';
import { loadBlob, saveBlob } from '../../api/history.mjs';
import { DEVELOPERS_KEY } from '../../api/keys.mjs';

/**
 * Keep a studio the page just told us, so the search can use it later.
 *
 * PlayStation has no developer field, so the only place the studio is
 * written down is the page's own copy, and this read has already happened
 * by the time we get here. Throwing that away and asking again later
 * would be the expensive way to know the same thing.
 *
 * Written only when it changes, because a blob write on every game anyone
 * opens is a lot of writes to say what was already there.
 */
async function remember(id, developer) {
  if (!id || !developer) return;
  const held = (await loadBlob(DEVELOPERS_KEY)) ?? {};
  const byId = held.byId ?? {};
  if (byId[id] === developer) return;
  byId[id] = developer;
  await saveBlob(DEVELOPERS_KEY, { byId, storedAt: new Date().toISOString() });
}

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

  const genres = (params.get('genres') ?? '').split(',').map((g) => g.trim()).filter(Boolean);
  const steamAppId = Number(params.get('steam'));
  const detail = await loadConceptDetail(
    id,
    (params.get('cc') ?? 'US').toUpperCase(),
    genres,
    Number.isFinite(steamAppId) && steamAppId > 0 ? steamAppId : null,
  );
  // Never at the cost of the answer: a blob that will not write is a
  // search that stays as good as it was, not a game page that fails.
  if (detail?.developer) await remember(id, detail.developer).catch(() => {});

  return new Response(JSON.stringify(detail ?? { error: 'not found' }), {
    status: detail ? 200 : 404,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=600, s-maxage=1800, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/concept' };
