/**
 * PlayStation Store pricing.
 *
 * Sony publishes no open price API, but a concept page server-renders its own
 * GraphQL payload, which carries the real store price, the discounted price,
 * the currency and — most usefully for predicting drops — the timestamp the
 * current sale ends.
 *
 * Those pages are ~1.2MB and the price sits about 6% in, so the fetch is
 * streamed and aborted as soon as the price block has been read. Concept ids
 * are resolved offline and baked into the catalog; nothing is discovered at
 * request time.
 */

const STORE_ORIGIN = 'https://store.playstation.com';
/** The price block sits far earlier than this; the cap is just a backstop. */
const MAX_BYTES = 400_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new Map();
const inFlight = new Map();

/** Storefront locales, keyed by the same country codes the UI already uses. */
const LOCALES = {
  US: 'en-us', CA: 'en-ca', GB: 'en-gb', DE: 'de-de', FR: 'fr-fr',
  AU: 'en-au', JP: 'ja-jp', BR: 'pt-br', MX: 'es-mx',
};

export const localeFor = (countryCode) => LOCALES[countryCode] ?? LOCALES.US;

/**
 * Read only as much of the page as it takes to reach the price data, then
 * drop the connection.
 */
async function fetchPricePayload(storePath, countryCode, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Newer games have a concept page, older ones only a product page. Both
  // server-render the same price payload.
  const url = `${STORE_ORIGIN}/${localeFor(countryCode)}/${storePath}`;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html',
        'user-agent': 'Mozilla/5.0 (compatible; ps5-upgrade-catalog/1.0)',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    if (!response.ok) throw new Error(`store ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (text.length < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      // Stop once a price you can actually buy has been read in full. Waiting
      // for any price block is not enough: on a game in the PS Plus catalog
      // the first block is a subscription upsell, and breaking there left the
      // real price unread and the game looking priceless.
      if (
        text.includes('"applicability":"APPLICABLE"') &&
        text.lastIndexOf('"__typename":"Price"') < text.length - 900
      ) {
        break;
      }
    }
    reader.cancel().catch(() => {});
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const field = (segment, key) => {
  const match = segment.match(new RegExp(`"${key}":("[^"]*"|null|-?\\d+|true|false)`));
  if (!match) return null;
  const raw = match[1];
  if (raw === 'null') return null;
  if (raw.startsWith('"')) return raw.slice(1, -1);
  if (raw === 'true' || raw === 'false') return raw === 'true';
  return Number(raw);
};

/**
 * Every edition on the page carries its own price. The standard edition is the
 * cheapest of the ones you can actually buy, so PS Plus upsells and bundles
 * are filtered out first.
 */
function parsePrices(html) {
  const candidates = [];
  const marker = '"__typename":"Price"';
  for (let index = html.indexOf(marker); index !== -1; index = html.indexOf(marker, index + 1)) {
    const segment = html.slice(index, index + 900);
    const applicability = field(segment, 'applicability');
    const base = field(segment, 'basePriceValue');
    // base === 0 is a genuinely free-to-play game, which is a real answer;
    // rejecting it left titles like Rocket League looking priceless.
    if (applicability !== 'APPLICABLE' || typeof base !== 'number' || base < 0) continue;

    const discounted = field(segment, 'discountedValue');
    candidates.push({
      basePriceValue: base,
      discountedValue: typeof discounted === 'number' ? discounted : base,
      basePrice: field(segment, 'basePrice'),
      discountedPrice: field(segment, 'discountedPrice'),
      currencyCode: field(segment, 'currencyCode') ?? 'USD',
      endTime: field(segment, 'endTime'),
      discountText: field(segment, 'displayDiscountText'),
    });
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((cheapest, entry) =>
    entry.basePriceValue < cheapest.basePriceValue ? entry : cheapest,
  );
}

/**
 * Whether the game is in the PS Plus Extra/Premium catalog.
 *
 * This matters more than any discount: for a subscriber the marginal price is
 * already zero, so a sale on it is close to irrelevant. The store marks it by
 * pricing a subscription CTA at "Included" and naming the tier in its upsell
 * copy. A PS Plus *discount* is a different thing and does not match this.
 */
function parsePlus(html) {
  if (!/"discountedPrice":"Included"/.test(html)) return null;
  const upsell = (html.match(/"displayUpsellText":"([^"]{5,200})"/) || [])[1] ?? '';
  const tier = (upsell.match(/PlayStation Plus (Extra|Premium|Deluxe)/) || [])[1] ?? null;
  // Essential is online play, not a game catalog, so it is not inclusion.
  if (!tier) return null;
  return { included: true, tier: `PlayStation Plus ${tier}` };
}

function toPrice(entry) {
  const final = entry.discountedValue;
  const initial = entry.basePriceValue;
  const discountPercent = initial > 0 ? Math.round(((initial - final) / initial) * 100) : 0;
  return {
    isFree: initial === 0,
    currency: entry.currencyCode,
    initial,
    final,
    discountPercent: Math.max(0, discountPercent),
    initialFormatted: entry.basePrice,
    finalFormatted: entry.discountedPrice ?? entry.basePrice,
    // When the store says the sale ends, the predictor no longer has to guess.
    saleEndsAt: entry.endTime ? new Date(Number(entry.endTime) || entry.endTime).toISOString() : null,
    source: 'PlayStation Store',
  };
}

/** Current PlayStation Store price for one store path, cached per region. */
export async function loadPsnPrice(storePath, countryCode = 'US') {
  if (!storePath) return null;
  const key = `${countryCode}:${storePath}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) return hit.value;
  if (inFlight.has(key)) return inFlight.get(key);

  const pending = fetchPricePayload(storePath, countryCode)
    .then((html) => {
      const entry = parsePrices(html);
      const value = entry ? { ...toPrice(entry), plus: parsePlus(html) } : null;
      cache.set(key, { value, storedAt: Date.now() });
      return value;
    })
    .catch(() => hit?.value ?? null)
    .finally(() => inFlight.delete(key));

  inFlight.set(key, pending);
  return pending;
}
