/**
 * Searching for a kind of game rather than for a name.
 *
 * Reported as: "if I search boardgames it shows me board game games,
 * instead of showing me just game titles that [match]". Typing "board"
 * returned Longboard Skate Downhill Simulator and Cool Boarders, which
 * is a string match doing exactly what it was told and nothing a person
 * meant. Typing "horror" returned whatever happened to have the word in
 * its title, and not the 551 horror games sitting right there.
 *
 * The store already sorts its catalogue into genres and this app's
 * write-ups carry their own, finer ones. None of it was searchable: the
 * matcher only ever read names, then studios. So this maps the words
 * people use to the vocabulary the data actually has.
 *
 * Two vocabularies, because there are two halves. The mirror's 23 genres
 * are broad (Action, Horror, Family). The 506 write-ups have 16 sharper
 * ones (Metroidvania, Deckbuilder, Life Sim) and six mood tags, so a
 * concept can reach both and a search for "metroidvania" finds the
 * thirty-six games somebody actually labelled that way.
 *
 * WHAT A CONCEPT IS NOT
 *
 * It is not a guess at what a game is like. Every concept here points at
 * a label already attached to the game by the store or by a write-up in
 * this repo. Where no such label exists, the concept says so by not
 * existing: there is no "Board" genre on the PlayStation Store, so board
 * games are found by a short list of the games that are actually board
 * games, and that list is hand-written and checked rather than inferred
 * from a word appearing in a title.
 *
 * The alternative was matching "board" against names, and the name match
 * is what was already there and already wrong.
 */

/**
 * The vocabulary, in the order a tie should be broken.
 *
 * `ask` is what somebody types. `genres` are the store's own, `curated`
 * are the write-ups' own, `tags` are the write-ups' moods, and `names`
 * is only for concepts the data has no label for at all.
 */
export const CONCEPTS = [
  {
    id: 'horror',
    label: 'Horror',
    ask: ['horror', 'scary', 'spooky', 'frightening', 'creepy', 'survival horror'],
    genres: ['Horror'],
  },
  {
    id: 'rpg',
    label: 'Role-playing',
    ask: ['rpg', 'rpgs', 'role playing', 'role playing games', 'jrpg'],
    genres: ['Role Playing Games'],
    curated: ['RPG'],
  },
  {
    id: 'racing',
    label: 'Racing',
    ask: ['racing', 'race', 'driving', 'cars', 'car games', 'kart'],
    genres: ['Driving/Racing'],
    curated: ['Racing'],
  },
  {
    id: 'shooter',
    label: 'Shooters',
    ask: ['shooter', 'shooters', 'fps', 'first person shooter', 'shooting'],
    genres: ['Shooter'],
  },
  {
    id: 'puzzle',
    label: 'Puzzle',
    ask: ['puzzle', 'puzzles', 'puzzler', 'brain teaser'],
    genres: ['Puzzle', 'Brain Training'],
    curated: ['Puzzle'],
  },
  {
    id: 'platformer',
    label: 'Platformers',
    ask: ['platformer', 'platformers', 'platforming', 'jump and run'],
    curated: ['Platformer'],
  },
  {
    id: 'metroidvania',
    label: 'Metroidvania',
    ask: ['metroidvania', 'metroidvanias', 'search action'],
    curated: ['Metroidvania'],
  },
  {
    id: 'fighting',
    label: 'Fighting',
    ask: ['fighting', 'fighter', 'fighters', 'beat em up', 'brawler'],
    genres: ['Fighting'],
  },
  {
    id: 'sport',
    label: 'Sports',
    ask: ['sport', 'sports', 'football', 'soccer', 'basketball', 'golf'],
    genres: ['Sport', 'Fitness'],
    curated: ['Sports'],
  },
  {
    id: 'strategy',
    label: 'Strategy',
    ask: ['strategy', 'tactics', 'tactical', 'rts', '4x'],
    genres: ['Strategy'],
  },
  {
    id: 'sim',
    label: 'Simulation',
    ask: ['simulation', 'simulator', 'sim', 'sims', 'management', 'tycoon', 'farming'],
    genres: ['Simulation', 'Simulator'],
    curated: ['Life Sim', 'Management'],
  },
  {
    id: 'party',
    label: 'Party games',
    ask: ['party', 'party games', 'couch', 'couch coop', 'local multiplayer', 'split screen'],
    genres: ['Party'],
    curated: ['Party'],
    tags: ['social'],
  },
  {
    id: 'family',
    label: 'For kids',
    ask: ['kids', 'kid', 'children', 'family', 'family friendly', 'for kids'],
    genres: ['Family', 'Educational'],
  },
  {
    id: 'music',
    label: 'Music and rhythm',
    ask: ['music', 'rhythm', 'rhythm games', 'dancing', 'singing', 'karaoke'],
    genres: ['Music/Rhythm'],
    curated: ['Rhythm'],
  },
  {
    id: 'narrative',
    label: 'Story games',
    ask: ['story', 'story games', 'narrative', 'story driven', 'visual novel', 'walking sim'],
    curated: ['Narrative', 'Mystery'],
  },
  {
    id: 'cozy',
    label: 'Cozy',
    ask: ['cozy', 'cosy', 'relaxing', 'chill', 'wholesome', 'calm', 'comfy'],
    tags: ['cozy'],
  },
  {
    id: 'queer',
    label: 'Queer',
    ask: ['queer', 'lgbt', 'lgbtq', 'gay', 'trans', 'lesbian'],
    tags: ['queer'],
  },
  {
    id: 'classic',
    label: 'Classics',
    ask: ['classic', 'classics', 'retro', 'old games', 'remaster', 'remasters'],
    genres: ['Arcade'],
    tags: ['classic'],
  },
  {
    id: 'deckbuilder',
    label: 'Deckbuilders',
    ask: ['deckbuilder', 'deckbuilding', 'card game', 'card games', 'cards'],
    curated: ['Deckbuilder'],
  },
  {
    id: 'creature',
    label: 'Creature collecting',
    ask: ['creature collector', 'creature collecting', 'monster collecting', 'monster catching'],
    curated: ['Creature Collection'],
  },
  {
    /*
     * The one with no label behind it.
     *
     * PlayStation has no Board genre, and matching the word against
     * names is what was already happening and already wrong: "board"
     * finds Longboard Skate Downhill Simulator and Cool Boarders.
     *
     * So this is a list, written by hand and checked against the index.
     * It is short and it is honest about being short: the alternative
     * was a string match that returns skateboarding.
     */
    id: 'board',
    label: 'Board and tabletop games',
    // "boardgames" and "board games" squash to the same key, so one
    // spelling of each is enough; the folding handles the rest.
    ask: ['board game', 'board games', 'tabletop', 'board'],
    names: [
      /\bmonopoly\b/i,
      /\bcatan\b/i,
      /\bcarcassonne\b/i,
      /\bcluedo?\b/i,
      /\bscrabble\b/i,
      /\byahtzee\b/i,
      /\bbackgammon\b/i,
      /\bmahjong/i,
      /\bsolitaire\b/i,
      /\bchess\b/i,
      /\bcheckers\b/i,
      /\bdominoes\b/i,
      /\buno\b/i,
      /\bticket to ride\b/i,
      /\bpandemic\b/i,
      /\bgloomhaven\b/i,
      /\bwingspan\b/i,
      /\broot\b.*\bboard\b/i,
      /\bboard game\b/i,
      /\btabletop\b/i,
      /\btalisman\b/i,
      /\bdice\s*(?:game|throne|legacy)\b/i,
    ],
  },
];

/** Letters, digits and single spaces, so "Board Games!" meets "boardgames". */
const flatten = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The same with the spaces closed up, so "boardgames" meets "board games". */
const squash = (value) => flatten(value).replace(/ /g, '');

const INDEX = CONCEPTS.flatMap((concept) =>
  concept.ask.map((phrase) => ({ key: squash(phrase), concept })),
);

/**
 * The kind of game somebody asked for, if they asked for a kind at all.
 *
 * Whole-query only. A concept is a different sort of answer from a name
 * match and it should not creep into one: somebody searching "Horizon
 * Forbidden West" has named a game, and pulling in every Action game
 * because the phrase contains a word would bury the thing they typed.
 */
export function conceptFor(query) {
  const asked = squash(query);
  if (asked.length < 3) return null;
  return INDEX.find((entry) => entry.key === asked)?.concept ?? null;
}

/**
 * Is this game one of the kind asked for?
 *
 * Reads only labels already on the row: the store's genres, a write-up's
 * genre and tags, or, for a concept the data has no label for, the
 * hand-written list of games that are one.
 */
export function matchesConcept(game, concept) {
  if (!concept || !game) return false;

  const genres = Array.isArray(game.genres) ? game.genres : [];
  if (concept.genres?.some((wanted) => genres.includes(wanted))) return true;

  // A write-up's own genre is a single string, not a list.
  if (concept.curated?.length) {
    const own = game.genre ?? null;
    if (own && concept.curated.includes(own)) return true;
  }

  if (concept.tags?.length) {
    const tags = Array.isArray(game.tags) ? game.tags : [];
    if (concept.tags.some((wanted) => tags.includes(wanted))) return true;
  }

  if (concept.names?.length) {
    const name = game.name ?? game.title ?? '';
    if (concept.names.some((pattern) => pattern.test(name))) return true;
  }

  return false;
}
