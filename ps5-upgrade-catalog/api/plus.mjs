/**
 * Which store games a PlayStation Plus subscription already covers.
 *
 * A game's own store page says this precisely, tier and all, and that is
 * what `parsePlus` in psn.mjs reads for the hand-written catalog. It cannot
 * answer for the whole mirror, because that would be 8,885 page fetches.
 *
 * PlayStation's own Plus games page lists the catalog as ordinary concept
 * links, which is one request for the lot. 262 ids came back when this was
 * written, 230 of them matching the mirror. That is a subset rather than the
 * entire Extra catalog, so this marks what it can prove and says nothing
 * about the rest: a game being absent here is not evidence it is excluded.
 */

const SOURCE = 'https://www.playstation.com/en-us/ps-plus/games/';
const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
};

/** Fewer than this and the page shape has changed; keep the old list. */
const SANITY_FLOOR = 40;

/**
 * Concept ids currently listed as included, or null if the page could not be
 * read. Null and empty mean different things here: null is "do not touch
 * what is stored", empty would be "nothing is included", which is never
 * true and would wipe every badge in the app.
 */
export async function fetchPlusConceptIds({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(SOURCE, {
    headers: HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) return null;

  const html = await response.text();
  const ids = [...new Set((html.match(/\/concept\/(\d+)/g) ?? []).map((href) => href.slice(9)))];
  return ids.length >= SANITY_FLOOR ? ids : null;
}
