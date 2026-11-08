import { searchElsewhere } from '../../api/elsewhere.mjs';
import { fold } from '../../api/search.mjs';
import { searchStore } from '../../api/store.mjs';

/**
 * Ask our own index again, using the name Steam came back with.
 *
 * This runs because the app told somebody a game was not on PlayStation
 * while holding it. They searched "The Outer Worlds II", the mirror has it
 * as "The Outer Worlds 2", and the answer was "nothing in the index
 * matches that" over a PC listing for the game they were looking at on the
 * PlayStation Store at the time.
 *
 * Steam's search forgives far more than this app's matcher does, which is
 * the whole reason the fallback finds anything. So its answer is worth more
 * than a listing: it is a spelling, corrected. Putting that spelling back
 * through our own index turns the detour into a second chance, and it
 * costs nothing, because the index is already in memory.
 *
 * Only an exact name counts. A loose match here would undo the point by
 * announcing some other game as the one you asked for, and "we have this"
 * is a claim worth being sure of.
 */
async function alsoOnPlayStation(name) {
  if (!name) return null;
  const found = await searchStore({ q: name, page: 0 });
  const wanted = fold(name);
  const exact = (found.games ?? []).find((game) => fold(game.name) === wanted);
  if (!exact) return null;
  return {
    id: exact.id,
    name: exact.name,
    price: exact.price ?? null,
    art: exact.art ?? null,
    platforms: exact.platforms ?? [],
  };
}

/** GET /api/elsewhere?q= — the game somewhere else, and here after all. */
export default async function handler(request) {
  const params = new URL(request.url).searchParams;
  const payload = await searchElsewhere(params.get('q') ?? '', {
    country: params.get('cc') ?? 'US',
  });

  const items = await Promise.all(
    (payload.items ?? []).map(async (item) => {
      // One miss must not take the whole answer down: without this, a
      // reader whose index read failed would lose the PC listing too, and
      // the PC listing is the part that already worked.
      const here = await alsoOnPlayStation(item.name).catch(() => null);
      return here ? { ...item, onPlayStation: here } : item;
    }),
  );

  return new Response(JSON.stringify({ ...payload, items }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export const config = { path: '/api/elsewhere' };
