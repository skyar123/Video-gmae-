/**
 * GET /api/trending — what is worth talking about right now.
 *
 * Blended on the server because the two halves live here. The release
 * calendar is already loaded for the Soon shelf, and the press feed is
 * already fetched and cached for the news drawer, so reading both costs a
 * cache hit; doing the same work on the device would mean sending three
 * hundred stories to a phone in order to count thirteen of them.
 *
 * The news half is best-effort on purpose. If the feed is slow or down, the
 * shelf still fills from the calendar and simply says less about why each
 * game is there, which is a worse shelf and not a broken one. A shelf that
 * failed because a magazine's RSS was down would be the wrong trade.
 */

import { loadUpcoming } from '../../api/upcoming.mjs';
import { loadGoss } from '../../api/goss.mjs';
import { foldKey, rankTrending } from '../../api/trending.mjs';

export default async function handler(request) {
  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit') ?? 48) || 48, 96);

  const [calendar, press] = await Promise.all([
    loadUpcoming(),
    loadGoss().catch(() => null),
  ]);

  /*
   * How many stories name each game this week.
   *
   * api/goss.mjs has already done the hard half: matching a headline to a
   * game is all guard, and that guard lives there. This only counts what it
   * decided.
   */
  const news = new Map();
  for (const burst of press?.bursts ?? []) {
    const name = burst?.game?.name ?? burst?.game?.title;
    if (!name) continue;
    const key = foldKey(name);
    news.set(key, (news.get(key) ?? 0) + 1);
  }

  const shelf = rankTrending({
    recent: calendar?.recent ?? [],
    upcoming: calendar?.games ?? [],
    news,
    limit,
  });

  return Response.json(
    {
      games: shelf.map((entry) => ({ ...entry.game, trendingWhy: entry.why, stories: entry.stories })),
      // Said plainly so the shelf can admit when it is only a calendar.
      pressRead: Boolean(press),
      inTheNews: shelf.filter((entry) => entry.stories > 0).length,
      fetchedAt: new Date().toISOString(),
    },
    {
      headers: {
        'cache-control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=86400',
      },
    },
  );
}

export const config = { path: '/api/trending' };
