/**
 * Matching a PlayStation Store game to its Steam listing, by name.
 *
 * This is the only way to give a mirror game the review scores and the pros
 * and cons the curated catalog has, because those come from Steam's review
 * corpus and the mirror carries no Steam id.
 *
 * Matching by name is exactly where this kind of thing goes wrong: a loose
 * match returns the sequel. Earlier in this catalog's life a prefix search
 * confidently offered Silksong for Hollow Knight, Blasphemous 2 for
 * Blasphemous and Coffee Talk Tokyo for Coffee Talk. So nothing here is
 * fuzzy: a result counts only if its name, normalised, is the same string as
 * the one we asked about. A game with no match keeps none, which is the
 * correct answer far more often than a near miss.
 */

import { fold } from './search.mjs';

const SEARCH_URL = 'https://store.steampowered.com/api/storesearch/';

const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'application/json',
};

/**
 * Noise one storefront prints and the other does not. Deliberately short.
 *
 * It is tempting to strip edition words too, so that "Game: Deluxe Edition"
 * can meet plain "Game". That is a trap: "Mass Effect Legendary Edition"
 * reduces to "mass effect" and then matches the 2007 original, hanging that
 * game's reviews on the remaster. Both stores print edition names anyway, so
 * only the platform furniture comes off.
 */
const NOISE = /\b(ps4|ps5|playstation [45]|for playstation[45]?)\b/g;

export const normaliseTitle = (value) =>
  fold(
    String(value ?? '')
      .replace(/[™®©]/g, ' ')
      .toLowerCase()
      .replace(NOISE, ' '),
  );

/**
 * The Steam id for a title, or null.
 *
 * Only an exact normalised match counts, and an ambiguous answer (two
 * different ids claiming the same normalised name) counts as no answer.
 */
export async function resolveSteamAppId(title, { fetchImpl = fetch } = {}) {
  const wanted = normaliseTitle(title);
  if (wanted.length < 3) return null;

  const url = `${SEARCH_URL}?term=${encodeURIComponent(title)}&cc=US&l=en`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) return null;
    const payload = await res.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];

    const exact = items.filter((item) => normaliseTitle(item?.name) === wanted);
    if (exact.length !== 1) return null;
    const id = Number(exact[0].id);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
