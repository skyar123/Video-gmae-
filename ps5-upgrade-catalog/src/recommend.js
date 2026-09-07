/**
 * Recommendations built from what you own.
 *
 * The catalog carries a lot of hand-made judgement — genre, art style, who you
 * play as, the cozy/graphics/social tags, representation notes — and the review
 * pass adds what players actually praise about each game. Together that is
 * enough to say something specific about taste, so the picks come with a reason
 * naming the games they came from rather than a bare score.
 *
 * Everything here is pure: same library in, same picks out, no network.
 */

/** How much each kind of shared trait counts toward a match. */
const WEIGHTS = {
  genre: 3,
  tag: 2.5,
  rep: 2.5,
  art: 2,
  pro: 1.5,
  prot: 1.5,
  family: 1,
};

// Labels read as sentence fragments so two of them can be joined with "and".
const TAG_LABELS = {
  cozy: 'cozy',
  graphics: 'a looker',
  social: 'good with people',
  classic: 'a classic',
  queer: 'a queer story',
  disability: 'disability representation',
};

const REP_LABELS = {
  queer: 'queer characters',
  disability: 'disabled characters',
};

const FAMILY_LABELS = {
  safe: 'safe for kids',
  mild: 'fine for most kids',
  mature: 'grown-up',
};

/** The traits one game contributes, as `kind:value` keys. */
function traitsOf(game) {
  const traits = [`genre:${game.genre}`, `art:${game.artStyle}`, `prot:${game.protagonist}`];
  for (const tag of game.tags ?? []) traits.push(`tag:${tag}`);
  for (const entry of game.representation ?? []) traits.push(`rep:${entry.kind}`);
  if (game.ageRating?.family) traits.push(`family:${game.ageRating.family}`);
  for (const pro of (game.ratings?.pros ?? []).slice(0, 3)) traits.push(`pro:${pro.label}`);
  return traits;
}

const weightOf = (trait) => WEIGHTS[trait.slice(0, trait.indexOf(':'))] ?? 1;

function labelFor(trait) {
  const [kind, ...rest] = trait.split(':');
  const value = rest.join(':');
  // Acronyms like RPG must survive the lowercasing that makes labels joinable.
  if (kind === 'genre') return value === value.toUpperCase() ? value : value.toLowerCase();
  if (kind === 'art') return value === '3D' || value === '2D' ? value : value.toLowerCase();
  if (kind === 'prot') return `a ${value.toLowerCase()} lead`;
  if (kind === 'tag') return TAG_LABELS[value] ?? value;
  if (kind === 'rep') return REP_LABELS[value] ?? value;
  if (kind === 'family') return FAMILY_LABELS[value] ?? value;
  if (kind === 'pro') return `praised for ${value.toLowerCase()}`;
  return value;
}

/** Ratings nudge the order without deciding it: good taste beats a high score. */
function qualityMultiplier(game) {
  const critic = game.ratings?.critic;
  const user = game.ratings?.user?.percentPositive;
  if (critic == null && user == null) return 0.95;
  const parts = [critic, user].filter((value) => value != null);
  const mean = parts.reduce((sum, value) => sum + value, 0) / parts.length / 100;
  return 0.8 + 0.4 * Math.min(Math.max(mean, 0), 1);
}

/**
 * Builds a taste profile. Owned games count fully; wishlisted ones count a
 * little less, because wanting something is a softer signal than buying it.
 */
export function buildProfile(catalog, ownedIds, wishlistedIds) {
  const seeds = [];
  for (const game of catalog) {
    if (ownedIds.has(game.id)) seeds.push({ game, weight: 1 });
    else if (wishlistedIds.has(game.id)) seeds.push({ game, weight: 0.65 });
  }
  if (seeds.length === 0) return null;

  const totalWeight = seeds.reduce((sum, seed) => sum + seed.weight, 0);
  const shares = new Map();
  const carriers = new Map();

  for (const seed of seeds) {
    for (const trait of traitsOf(seed.game)) {
      shares.set(trait, (shares.get(trait) ?? 0) + seed.weight / totalWeight);
      if (!carriers.has(trait)) carriers.set(trait, []);
      carriers.get(trait).push(seed.game.title);
    }
  }

  return { shares, carriers, seedCount: seeds.length };
}

/**
 * Scores every game you do not already have against the profile and returns the
 * best, each with a sentence saying where it came from.
 */
export function recommend(catalog, profile, { exclude, limit = 40, includePs5 = true } = {}) {
  if (!profile) return [];

  const scored = [];
  for (const game of catalog) {
    if (exclude.has(game.id)) continue;
    if (!includePs5 && game.platform === 'PS5') continue;

    const hits = [];
    let score = 0;
    for (const trait of traitsOf(game)) {
      const share = profile.shares.get(trait);
      if (!share) continue;
      const contribution = weightOf(trait) * share;
      score += contribution;
      hits.push({ trait, contribution });
    }
    if (score <= 0) continue;

    hits.sort((a, b) => b.contribution - a.contribution);
    scored.push({ game, hits, score: score * qualityMultiplier(game), matched: hits.length });
  }

  scored.sort((a, b) => b.score - a.score);

  // Without this the top of the list is one genre over and over, because the
  // profile's strongest signal wins every comparison. Each pick makes the next
  // game of the same genre count for a little less.
  const picked = [];
  const genreUses = new Map();
  const pool = scored.slice(0, limit * 4);
  while (picked.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < pool.length; index += 1) {
      const used = genreUses.get(pool[index].game.genre) ?? 0;
      const adjusted = pool[index].score * 0.82 ** used;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = index;
      }
    }
    const [chosen] = pool.splice(bestIndex, 1);
    genreUses.set(chosen.game.genre, (genreUses.get(chosen.game.genre) ?? 0) + 1);
    picked.push(chosen);
  }

  // Reasons are written last so each one can prefer a trait the list has not
  // already leaned on; otherwise every cozy pick says the same sentence.
  const usedTraits = new Set();
  return picked.map(({ game, score, hits, matched }) => {
    const ranked = [...hits].sort(
      (a, b) =>
        b.contribution * (usedTraits.has(b.trait) ? 0.45 : 1) -
        a.contribution * (usedTraits.has(a.trait) ? 0.45 : 1),
    );
    for (const hit of ranked.slice(0, 2)) usedTraits.add(hit.trait);
    return { game, score, matched, reason: reasonFor(ranked, profile, game.id) };
  });
}

const hashOf = (value) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 100_000;
  }
  return hash;
};

/** "Cozy and hand-drawn, like Lake and A Short Hike." */
function reasonFor(hits, profile, seed) {
  const top = hits.slice(0, 2);
  if (top.length === 0) return null;

  const traits = top.map((hit) => labelFor(hit.trait));
  // Naming the same two games in every reason makes the list feel canned, so
  // each pick starts from a different point in the list of games that match it.
  const offset = hashOf(seed);
  const names = [];
  for (const hit of top) {
    const carriers = profile.carriers.get(hit.trait) ?? [];
    for (let step = 0; step < carriers.length; step += 1) {
      const title = carriers[(offset + step) % carriers.length];
      if (!names.includes(title)) names.push(title);
      if (names.length >= 2) break;
    }
    if (names.length >= 2) break;
  }

  const traitText = traits.length > 1 ? `${traits[0]} and ${traits[1]}` : traits[0];
  const sentence =
    names.length === 0
      ? traitText
      : `${traitText}, like ${names.length > 1 ? `${names[0]} and ${names[1]}` : names[0]}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
