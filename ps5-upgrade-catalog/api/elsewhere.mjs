/**
 * What to say when the catalog does not have it.
 *
 * This is a PlayStation catalog, so a search for a PC game ends in nothing,
 * and nothing is a bad answer to a real question. Plenty of games arrive on
 * PC first and come to PlayStation a year later, and in the meantime the
 * person asking still wants to know what it is, what it costs and whether it
 * is even out yet.
 *
 * The source is Valve's public storefront, which needs no key and is already
 * how this app reads PC prices. It is a real record: name, release date,
 * price, genres and the developer's own one-line description, fetched at the
 * moment of asking. Nothing here is generated or inferred, which matters
 * more than it might: a made-up release date for a game somebody is waiting
 * for is worse than no answer at all, and that is exactly what a language
 * model would supply most confidently.
 *
 * What it cannot tell you is whether a PlayStation version exists. Steam has
 * no reason to know. So the wording this feeds is about where the game *was*
 * found, never a promise about where it is going.
 */

const SEARCH_URL = 'https://store.steampowered.com/api/storesearch/';
const DETAILS_URL = 'https://store.steampowered.com/api/appdetails';
const UA = 'Mozilla/5.0 (compatible; ps5-upgrade-catalog/1.0)';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CANDIDATES = 8;

const cache = new Map();

async function readJson(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': UA } });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Letters and digits only, so "Rim World" meets "RimWorld". */
const fold = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');

/**
 * Detail for one app, which is the only place Steam says whether a thing is
 * a game or a piece of DLC. The search endpoint calls both "app", so without
 * this a search for RimWorld answers with four expansions and a soundtrack.
 */
async function detail(id, country) {
  const data = await readJson(
    `${DETAILS_URL}?appids=${id}&cc=${encodeURIComponent(country)}&l=en`,
  );
  const entry = data?.[id];
  if (!entry?.success || !entry.data) return null;
  const app = entry.data;
  if (app.type !== 'game') return null;

  return {
    id,
    name: app.name,
    // "To be announced" is a real and useful answer: it is how Steam says a
    // game has been announced and not dated, which is the case a reader is
    // most likely to be asking about.
    released: app.release_date?.date || null,
    announced: app.release_date?.coming_soon === true,
    price: app.is_free ? 'Free' : (app.price_overview?.final_formatted ?? null),
    wasPrice:
      app.price_overview && app.price_overview.discount_percent > 0
        ? app.price_overview.initial_formatted
        : null,
    discountPercent: app.price_overview?.discount_percent || 0,
    genres: (app.genres ?? []).map((genre) => genre.description).slice(0, 3),
    developer: app.developers?.[0] ?? null,
    summary: app.short_description ?? null,
    art: app.header_image ?? null,
    platforms: Object.entries(app.platforms ?? {})
      .filter(([, on]) => on)
      .map(([name]) => name),
    link: `https://store.steampowered.com/app/${id}/`,
  };
}

/**
 * Games matching this search, on PC, as Valve reports them today.
 *
 * Ordered by how closely the name matches what was typed rather than by
 * Steam's own relevance, because Steam ranks a popular sequel above the
 * exact title and a reader who typed the exact title meant it.
 */
export async function searchElsewhere(term, { limit = 4, country = 'US' } = {}) {
  const query = String(term ?? '').trim();
  if (query.length < 2) return { items: [], query, fetchedAt: null };

  const key = `${country}:${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) return hit.value;

  const found = await readJson(
    `${SEARCH_URL}?term=${encodeURIComponent(query)}&l=en&cc=${encodeURIComponent(country)}`,
  );
  const wanted = fold(query);
  const candidates = (found?.items ?? [])
    .filter((item) => item?.id && item?.name)
    .sort((a, b) => {
      const exact = (name) => (fold(name) === wanted ? 0 : fold(name).startsWith(wanted) ? 1 : 2);
      return exact(a.name) - exact(b.name);
    })
    .slice(0, MAX_CANDIDATES);

  const items = [];
  for (const candidate of candidates) {
    if (items.length >= limit) break;
    // One at a time. Steam serves a single request and throttles a burst,
    // which is the same thing that froze the release calendar for 58 days.
    const row = await detail(candidate.id, country);
    if (row) items.push(row);
  }

  const value = { items, query, fetchedAt: new Date().toISOString() };
  cache.set(key, { value, storedAt: Date.now() });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}
