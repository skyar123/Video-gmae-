/**
 * Player ratings and the pros and cons behind them.
 *
 * The storefront publishes a review corpus, so rather than inventing verdicts
 * we read what players actually wrote. Pros are counted only inside positive
 * reviews and cons only inside negative ones, which keeps "great story, awful
 * performance" from filing story under complaints. Each bullet reports how
 * many reviews mentioned it, so a weak signal is visible as a weak signal.
 */

const REVIEWS_URL = 'https://store.steampowered.com/appreviews';
const SAMPLE_SIZE = 100;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Below this a theme is noise rather than a pattern. */
const MIN_MENTIONS = 3;
const MAX_BULLETS = 4;

const cache = new Map();
const inFlight = new Map();

/**
 * Themes counted in positive reviews. The words are what players reach for
 * when they liked something, not neutral topic words.
 */
const PRO_THEMES = [
  { label: 'Story and writing', words: ['story', 'writing', 'narrative', 'dialogue', 'characters'] },
  { label: 'Art and visuals', words: ['art style', 'artstyle', 'visuals', 'gorgeous', 'beautiful', 'stunning'] },
  { label: 'Soundtrack', words: ['soundtrack', 'music', 'ost ', 'score is', 'sound design'] },
  { label: 'Atmosphere', words: ['atmosphere', 'vibe', 'immersive', 'ambience', 'mood'] },
  { label: 'Combat and controls', words: ['combat', 'controls are', 'gameplay is', 'mechanics', 'movement'] },
  { label: 'Exploration', words: ['exploration', 'exploring', 'world design', 'secrets', 'level design'] },
  { label: 'Relaxing to play', words: ['relaxing', 'cozy', 'chill', 'calming', 'wholesome'] },
  { label: 'Worth the money', words: ['worth every', 'worth it', 'great value', 'well worth', 'worth the price'] },
  { label: 'Good with friends', words: ['with friends', 'co-op', 'coop', 'multiplayer is', 'with my friend'] },
  { label: 'Replayable', words: ['replay', 'hundreds of hours', 'addictive', 'one more run', 'keeps pulling'] },
];

/**
 * Themes counted in negative reviews. These are complaint phrasings rather
 * than topics, so a mention is already evidence of a problem.
 */
const CON_THEMES = [
  { label: 'Bugs and crashes', words: ['crash', 'bug', 'glitch', 'broken', 'softlock', 'soft lock'] },
  { label: 'Performance problems', words: ['fps', 'frame rate', 'framerate', 'stutter', 'lag', 'optimi', 'performance'] },
  { label: 'Repetitive', words: ['repetitive', 'grind', 'tedious', 'boring', 'monotonous'] },
  { label: 'Too short', words: ['too short', 'very short', 'so short', 'short for the price'] },
  { label: 'Overpriced', words: ['overpriced', 'not worth', 'too expensive', 'wait for a sale', 'full price'] },
  { label: 'Frustrating difficulty', words: ['too hard', 'unfair', 'frustrating', 'punishing', 'rage'] },
  { label: 'Clunky controls', words: ['clunky', 'janky', 'controls are bad', 'unresponsive', 'camera is'] },
  { label: 'Backtracking', words: ['backtrack', 'fetch quest', 'padding', 'filler'] },
  { label: 'Weak story', words: ['story is bad', 'story is weak', 'writing is bad', 'predictable', 'shallow'] },
  { label: 'Poor tutorial', words: ['confusing', 'no tutorial', 'unclear', 'hand hold', 'obtuse'] },
];

async function fetchJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'ps5-upgrade-catalog/1.0' },
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Count reviews (not occurrences) mentioning each theme, strongest first. */
function tally(reviews, themes) {
  const counts = new Map();
  for (const review of reviews) {
    const text = ` ${review.toLowerCase()} `;
    for (const theme of themes) {
      if (theme.words.some((word) => text.includes(word))) {
        counts.set(theme.label, (counts.get(theme.label) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .filter(([, mentions]) => mentions >= MIN_MENTIONS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_BULLETS)
    .map(([label, mentions]) => ({ label, mentions }));
}

const sampleUrl = (appId, type) =>
  `${REVIEWS_URL}/${appId}?json=1&language=english&purchase_type=all` +
  `&num_per_page=${SAMPLE_SIZE}&filter=all&review_type=${type}`;

/** Very short reviews ("good game", "10/10") carry no theme signal. */
const usableText = (payload) =>
  (Array.isArray(payload?.reviews) ? payload.reviews : [])
    .map((review) => review.review ?? '')
    .filter((text) => text.length >= 80);

/** Totals across every review, in every language: the headline rating. */
const summaryUrl = (appId) =>
  `${REVIEWS_URL}/${appId}?json=1&language=all&purchase_type=all` +
  `&num_per_page=0&review_type=all&filter=all`;

async function loadUncached(appId) {
  // Three cheap calls: overall totals for the rating, then separate positive
  // and negative samples. The default feed skews heavily positive, so without
  // its own sample a well-liked game reports no cons at all.
  const [summaryPayload, positivePayload, negativePayload] = await Promise.all([
    fetchJson(summaryUrl(appId)),
    fetchJson(sampleUrl(appId, 'positive')).catch(() => null),
    fetchJson(sampleUrl(appId, 'negative')).catch(() => null),
  ]);
  if (!summaryPayload?.success) return null;

  const summary = summaryPayload.query_summary ?? {};
  const total = summary.total_reviews ?? 0;
  const positive = summary.total_positive ?? 0;

  const positiveText = usableText(positivePayload);
  const negativeText = usableText(negativePayload);

  return {
    userScore: total > 0
      ? {
          percentPositive: Math.round((positive / total) * 100),
          total,
          label: summary.review_score_desc ?? null,
        }
      : null,
    pros: tally(positiveText, PRO_THEMES),
    cons: tally(negativeText, CON_THEMES),
    sampled: { positive: positiveText.length, negative: negativeText.length },
  };
}

/** Cached per app id; failures degrade to null rather than breaking a card. */
export async function loadReviewSignal(appId) {
  if (!appId) return null;
  const key = String(appId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) return hit.value;
  if (inFlight.has(key)) return inFlight.get(key);

  const pending = loadUncached(appId)
    .then((value) => {
      cache.set(key, { value, storedAt: Date.now() });
      return value;
    })
    .catch(() => hit?.value ?? null)
    .finally(() => inFlight.delete(key));

  inFlight.set(key, pending);
  return pending;
}
