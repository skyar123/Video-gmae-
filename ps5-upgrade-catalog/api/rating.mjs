/**
 * The age rating a PlayStation Store concept page publishes.
 *
 * Sony ships the real thing in the page: the issuing board, the rating it
 * gave, and the content descriptors behind it. That is the same material the
 * catalog's own ratings are built from, so the family verdict is computed
 * here with the catalog's function rather than a second rule that could
 * drift away from it. Nothing is inferred from a title or a genre.
 */

import { severityOf, toFamilyVerdict } from './steam.mjs';

/**
 * Board names exactly as the store writes them, checked against real pages
 * rather than guessed. The US store answers in ESRB; the others appear when
 * the same page is read from another region.
 */
const BOARD_TIERS = {
  ESRB_EVERYONE: { tier: 'everyone', rating: 'E', source: 'ESRB' },
  ESRB_EVERYONE_10: { tier: 'everyone10', rating: 'E10', source: 'ESRB' },
  ESRB_TEEN: { tier: 'teen', rating: 'T', source: 'ESRB' },
  ESRB_MATURE: { tier: 'mature', rating: 'M', source: 'ESRB' },
  ESRB_ADULTS_ONLY: { tier: 'mature', rating: 'AO', source: 'ESRB' },
  PEGI_3: { tier: 'everyone', rating: '3', source: 'PEGI' },
  PEGI_7: { tier: 'everyone10', rating: '7', source: 'PEGI' },
  PEGI_12: { tier: 'teen', rating: '12', source: 'PEGI' },
  PEGI_16: { tier: 'mature', rating: '16', source: 'PEGI' },
  PEGI_18: { tier: 'mature', rating: '18', source: 'PEGI' },
};

const unescapeJson = (value) =>
  String(value ?? '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();

/** Everything inside one contentRating object, and nothing from the next. */
const WINDOW = 2600;

export function ratingFromConcept(html) {
  const head = html.match(
    /"contentRating":\{"__typename":"ProductContentRating","authority":"([^"]*)","description":"([^"]*)","name":"([^"]*)"/,
  );
  if (!head) return null;

  const [, authority, description, name] = head;
  const known = BOARD_TIERS[name] ?? null;

  const window = html.slice(head.index, head.index + WINDOW);
  const descriptors = [
    ...new Set(
      [...window.matchAll(/"ProductContentRatingDescriptor","description":"([^"]+)"/g)].map((m) =>
        unescapeJson(m[1]),
      ),
    ),
  ];
  // "In-Game Purchases" and "Users Interact" are shipped separately from the
  // content descriptors and say something a parent would want to know, so
  // they are kept, but apart from the things that set the verdict.
  const interactive = [
    ...new Set(
      [...window.matchAll(/"ProductContentRatingInteractiveElement","description":"([^"]+)"/g)].map(
        (m) => unescapeJson(m[1]),
      ),
    ),
  ];

  // A rating with no descriptors at all is still worth having: the tier alone
  // is what the catalog falls back to in exactly the same case.
  if (!known && descriptors.length === 0) return null;

  const tier = known?.tier ?? 'unknown';

  return {
    family: toFamilyVerdict(descriptors, tier),
    concerns: descriptors.filter((entry) => severityOf(entry) === 'high').slice(0, 6),
    tier,
    source: known?.source ?? (authority || null),
    rating: known?.rating ?? unescapeJson(description) ?? null,
    // Quoted from the store's own page, not generated from anything.
    official: true,
    esrb: known?.source === 'ESRB' ? known.rating : null,
    pegi: known?.source === 'PEGI' ? known.rating : null,
    descriptors: descriptors.slice(0, 6),
    interactive: interactive.slice(0, 4),
    notes: null,
  };
}
