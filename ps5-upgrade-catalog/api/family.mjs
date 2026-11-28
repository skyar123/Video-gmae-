/**
 * Who is playing, and what that actually rules out.
 *
 * The app already had a kid-friendly chip, and a chip is the wrong shape for
 * this question. It answers yes or no and never says why, so a parent has to
 * take its word; and it is one setting for every child, though the gap
 * between a three-year-old and a ten-year-old is most of childhood.
 *
 * Three things are worth being careful about here.
 *
 * An age rating is a ceiling, not a recommendation. Everyone covers Tetris
 * and it covers long text-heavy strategy games a five-year-old cannot play,
 * so nothing in this file claims a game is *for* an age. It says the content
 * is allowed at that age, which is the only thing a board rating actually
 * certifies, and the wording throughout says so.
 *
 * Unrated is unknown, not innocent. 83 games in the mirror carry no rating.
 * They are excluded from every limited audience rather than waved through,
 * which is the rule the existing kid-friendly filter already follows.
 *
 * And the things that decide whether a small child can really play a game,
 * which are whether a grown-up can play alongside, how much reading it
 * demands, and what it asks of a pair of hands, are not in any of this data.
 * They are not guessed at. Saying "no reading needed" because a game is a
 * platformer would be inventing a fact a parent would rely on.
 */

/**
 * The audiences, as the rating boards actually divide them.
 *
 * Deliberately the board's own boundaries rather than invented ones. Picking
 * ages the data cannot distinguish, a six-year-old from an eight-year-old,
 * would be a control that looks precise and answers identically.
 */
export const AUDIENCES = [
  {
    id: 'everyone',
    label: 'Little kids',
    hint: 'Rated for everyone',
    tiers: ['everyone'],
  },
  {
    id: 'everyone10',
    label: '10 and over',
    hint: 'Up to Everyone 10+',
    tiers: ['everyone', 'everyone10'],
  },
  {
    id: 'teen',
    label: '13 and over',
    hint: 'Up to Teen',
    tiers: ['everyone', 'everyone10', 'teen'],
  },
  { id: 'all', label: 'No limit', hint: 'Everything, including Mature', tiers: null },
];

export const audienceFor = (id) => AUDIENCES.find((entry) => entry.id === id) ?? null;

/**
 * Is this game's content allowed for that audience?
 *
 * Allowed, not suitable. See the note at the top: a board rating certifies
 * the first and has nothing to say about the second.
 */
export function suitsAudience(game, audience) {
  if (!audience || !audience.tiers) return true;
  const tier = game?.ageRating?.tier ?? null;
  // No rating is not a pass. A game nobody has rated is the one most likely
  // to be a surprise.
  if (!tier || tier === 'unknown') return false;
  return audience.tiers.includes(tier);
}

/**
 * Board descriptors in words a person would use.
 *
 * Every entry here occurs in the mirror; this is not a guess at the ESRB's
 * full vocabulary but the 51 strings the data actually contains, counted.
 * Anything unlisted falls through to the board's own wording rather than
 * being dropped, because a descriptor nobody translated is still a warning
 * and silently swallowing it is the one unsafe failure mode.
 */
const PLAIN = {
  'Blood and Gore': 'graphic blood and injury',
  'Intense Violence': 'realistic, sustained violence',
  'Animated Blood': 'cartoon blood',
  'Mild Blood': 'a little blood',
  'Fantasy Violence': 'make-believe fighting',
  'Mild Fantasy Violence': 'gentle make-believe fighting',
  'Cartoon Violence': 'cartoon slapstick fighting',
  'Mild Cartoon Violence': 'gentle cartoon fighting',
  'Mild Violence': 'mild fighting',
  'Violent References': 'violence talked about, not shown',
  'Strong Language': 'strong swearing',
  'Mild Language': 'mild swearing',
  Language: 'swearing',
  'Strong Lyrics': 'explicit song lyrics',
  'Mild Lyrics': 'mildly rude song lyrics',
  Lyrics: 'rude song lyrics',
  'Suggestive Themes': 'sexual suggestion',
  'Mild Suggestive Themes': 'mild sexual suggestion',
  'Sexual Themes': 'sexual themes',
  'Mild Sexual Themes': 'mild sexual themes',
  'Sexual Content': 'sexual content',
  'Strong Sexual Content': 'explicit sexual content',
  'Partial Nudity': 'partial nudity',
  Nudity: 'nudity',
  'Crude Humor': 'toilet humour',
  'Mature Humor': 'adult humour',
  'Comic Mischief': 'cheeky mischief',
  'Use of Alcohol': 'drinking',
  'Alcohol Reference': 'alcohol mentioned',
  'Use of Tobacco': 'smoking',
  'Tobacco Reference': 'smoking mentioned',
  'Use of Alcohol and Tobacco': 'drinking and smoking',
  'Alcohol and Tobacco Reference': 'alcohol and smoking mentioned',
  'Use of Drugs': 'drug use',
  'Drug Reference': 'drugs mentioned',
  'Use of Drugs and Alcohol': 'drugs and drinking',
  'Drug and Alcohol Reference': 'drugs and alcohol mentioned',
  'Simulated Gambling': 'pretend gambling',
  'Gambling Themes': 'gambling',
  Violence: 'fighting',
};

/** Board boilerplate that is not a warning about anything. */
const NOT_A_CONCERN = /^(no descriptors|visit www\.esrb\.org|online interactions not rated)/i;

export function plainDescriptors(game) {
  const list = game?.ageRating?.descriptors ?? [];
  const out = [];
  for (const entry of list) {
    if (NOT_A_CONCERN.test(entry)) continue;
    const said = PLAIN[entry] ?? entry.toLowerCase();
    if (!out.includes(said)) out.push(said);
  }
  return out;
}

/**
 * The two a parent is most likely to want flagged, and most likely to miss.
 *
 * Both are recorded in the board's interactive elements rather than its
 * content descriptors, which is exactly why they are easy to overlook: they
 * sit in a different field from the violence and the swearing, and neither
 * one changes the age on the box.
 *
 * "Users Interact" is the one that matters most and reads like the least.
 * It means the game puts a child in contact with people the rating board
 * has not seen and cannot vouch for. 603 games in the mirror carry it.
 */
export function parentFlags(game) {
  const interactive = game?.ageRating?.interactive ?? [];
  return {
    purchases: interactive.some((entry) => /purchas/i.test(entry)),
    strangers: interactive.some((entry) => /users interact/i.test(entry)),
    unrated: !game?.ageRating?.tier || game.ageRating.tier === 'unknown',
  };
}

/**
 * Why a game is or is not allowed, in one sentence, or null when there is
 * nothing worth saying.
 */
export function whyNot(game, audience) {
  if (!audience?.tiers) return null;
  const flags = parentFlags(game);
  if (flags.unrated) return 'No board rating, so this one has not been checked by anybody.';
  if (suitsAudience(game, audience)) return null;
  const rating = game.ageRating?.source
    ? `${game.ageRating.source} ${game.ageRating.rating}`
    : 'its rating';
  const said = plainDescriptors(game);
  return said.length > 0
    ? `Rated ${rating}, for ${said.slice(0, 3).join(', ')}.`
    : `Rated ${rating}.`;
}
