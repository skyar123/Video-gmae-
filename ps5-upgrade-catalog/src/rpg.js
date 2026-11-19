/**
 * The game you play while choosing a game.
 *
 * Levels, experience, trophies and a class you pick at the start. Asked for
 * plainly, twice, and the first answer was a stats page with an essay
 * attached about why points would be crass. That was the wrong call: points
 * are not dishonest, they are a way of noticing effort, and this app has
 * plenty of real effort in it that nobody was noticing.
 *
 * The one rule kept from that attempt is the one worth keeping. Every point
 * here is earned by something the reader actually did and is recomputed from
 * what they have done, never incremented and stored. That has two good
 * consequences:
 *
 *   - somebody who has used this app for months is already level nine the
 *     first time they open the tab, because the evidence was always there
 *   - nothing can drift. Undo a rating and the points go with it, which a
 *     running total would get wrong forever.
 *
 * There is no XP for opening the app, no daily streak and no login bonus.
 * Not out of principle: they would simply be lying, because the app does not
 * know whether you played anything today, only what you told it.
 */

/**
 * What each thing is worth.
 *
 * Roughly proportional to what it costs a person. Finishing a game is an
 * evening many times over and is worth more than everything else on this
 * list; hearting something takes a second. The numbers are round because
 * they are a game currency rather than a measurement.
 */
export const XP = {
  rated: 25,
  owned: 15,
  wishlisted: 10,
  playing: 40,
  bounced: 30,
  finished: 150,
  answered: 20,
  /** Per distinct genre, art style and lead you have an opinion about. */
  genreKnown: 50,
  artKnown: 40,
  leadKnown: 30,
};

/*
 * The first set of these was a third the size and it felt mean: forty
 * ratings, a full shelf and two finished games came out as level three,
 * which reads as the app shrugging. Numbers in a game like this are meant to
 * be generous in the early hours and to slow down later, and the curve below
 * already does the slowing, so the values here do not need to.
 */

/**
 * The curve, which gets steeper and never stops.
 *
 * Level two costs 100, level three another 160, and so on. The early ones
 * land fast because the first half hour is when a reader decides whether any
 * of this is worth bothering with; later ones are a real climb.
 */
export const costOf = (level) => Math.round(100 * level ** 1.45);

export function levelFromXp(xp = 0) {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  let spent = 0;
  while (spent + costOf(level) <= total && level < 99) {
    spent += costOf(level);
    level += 1;
  }
  const need = costOf(level);
  return {
    level,
    xp: total,
    into: total - spent,
    need,
    through: need > 0 ? (total - spent) / need : 0,
  };
}

/**
 * Everything the reader has earned, counted from scratch every time.
 *
 * `features` is the set of things they have an opinion about, which the
 * recommender already works out; the three bonuses below are what make
 * breadth worth something. Rating a twelfth Metroidvania teaches the model
 * very little, and the points say so.
 */
export function xpFrom({
  ratings = new Map(),
  library = new Set(),
  wishlist = new Set(),
  backlog = new Map(),
  answers = {},
  features = new Set(),
} = {}) {
  let total = 0;
  const counted = new Set();

  // A game counts once, at its highest-earning claim, so owning a game you
  // also finished does not pay twice for one game.
  const claim = (id, points) => {
    const best = counted.has(id) ? 0 : points;
    if (!counted.has(id)) counted.add(id);
    return best;
  };

  for (const [id, state] of backlog) {
    total += claim(id, XP[state] ?? 0);
  }
  for (const id of ratings.keys()) total += claim(id, XP.rated);
  for (const id of library) total += claim(id, XP.owned);
  for (const id of wishlist) total += claim(id, XP.wishlisted);

  total += Object.keys(answers).length * XP.answered;

  for (const feature of features) {
    if (feature.startsWith('genre:') || feature.startsWith('sgenre:')) total += XP.genreKnown;
    else if (feature.startsWith('art:')) total += XP.artKnown;
    else if (feature.startsWith('lead:')) total += XP.leadKnown;
  }
  return total;
}

/* ------------------------------------------------------------------ *
 * Classes
 * ------------------------------------------------------------------ */

/**
 * Who you are, chosen at the start.
 *
 * Not decoration. Picking one is a statement about taste, the same kind the
 * guided questions collect, so it is recorded the same way: as answers about
 * features the recommender already scores on. A Hearthkeeper really does get
 * cozier picks from the first screen, which is the point of choosing.
 *
 * Every class can be changed later and none of them locks anything away.
 * This is a catalogue, not a build you can ruin.
 */
export const CLASSES = [
  {
    id: 'wanderer',
    name: 'Wanderer',
    blurb: 'Big worlds, no map markers, no hurry.',
    sigil: '🧭',
    grants: ['tag:exploration', 'genre:Metroidvania', 'sgenre:Adventure'],
  },
  {
    id: 'hearthkeeper',
    name: 'Hearthkeeper',
    blurb: 'Soft light, slow days, nothing that can kill you.',
    sigil: '🏡',
    grants: ['tag:cozy', 'genre:Life Sim', 'sgenre:Simulation'],
  },
  {
    id: 'berserker',
    name: 'Berserker',
    blurb: 'Weapons, reflexes, and a boss with three phases.',
    sigil: '⚔️',
    grants: ['genre:Action', 'sgenre:Action', 'genre:Soulslike'],
  },
  {
    id: 'bard',
    name: 'Bard',
    blurb: 'Tell me a story worth sitting through the credits for.',
    sigil: '📖',
    grants: ['genre:Narrative', 'tag:queer', 'sgenre:Adventure'],
  },
  {
    id: 'tactician',
    name: 'Tactician',
    blurb: 'A turn to think is all you ask.',
    sigil: '♟️',
    grants: ['genre:Deckbuilder', 'sgenre:Strategy', 'genre:RPG'],
  },
  {
    id: 'archivist',
    name: 'Archivist',
    blurb: 'Everything that came before, still worth playing.',
    sigil: '🗝️',
    grants: ['tag:classic', 'sgenre:Arcade', 'tag:graphics'],
  },
];

export const classFor = (id) => CLASSES.find((entry) => entry.id === id) ?? null;

/** A class choice, in the shape the taste model already takes. */
export function answersForClass(id) {
  const chosen = classFor(id);
  if (!chosen) return [];
  return chosen.grants.map((feature) => ({ feature, verdict: 'yes' }));
}

/* ------------------------------------------------------------------ *
 * Trophies
 * ------------------------------------------------------------------ */

/**
 * Things worth having done.
 *
 * Each one is a condition over what the reader has actually done, tested
 * fresh, so they unlock retroactively: somebody who has already finished ten
 * games has the trophy the first time they look.
 *
 * Tiers exist so the case is not a flat wall of the same thing, and the
 * rarest ones are genuinely hard rather than merely slow.
 */
export const TROPHIES = [
  {
    id: 'first-word',
    name: 'First Word',
    tier: 'bronze',
    detail: 'Said something about one game.',
    won: (s) => s.said >= 1,
  },
  {
    id: 'opinionated',
    name: 'Opinionated',
    tier: 'bronze',
    detail: 'Rated twenty-five games.',
    won: (s) => s.rated >= 25,
  },
  {
    id: 'shelf-keeper',
    name: 'Shelf Keeper',
    tier: 'bronze',
    detail: 'Ten games in your library.',
    won: (s) => s.owned >= 10,
  },
  {
    id: 'first-blood',
    name: 'Rolled Credits',
    tier: 'silver',
    detail: 'Finished one game.',
    won: (s) => s.finished >= 1,
  },
  {
    id: 'closer',
    name: 'Closer',
    tier: 'gold',
    detail: 'Finished ten.',
    won: (s) => s.finished >= 10,
  },
  {
    id: 'honest',
    name: 'Knows When To Stop',
    tier: 'silver',
    detail: 'Admitted giving up on three games. Harder than it sounds.',
    won: (s) => s.bounced >= 3,
  },
  {
    id: 'wide',
    name: 'Catholic Taste',
    tier: 'silver',
    detail: 'An opinion in ten different genres.',
    won: (s) => s.genres >= 10,
  },
  {
    id: 'connoisseur',
    name: 'Connoisseur',
    tier: 'gold',
    detail: 'An opinion in every art style the catalogue knows.',
    won: (s) => s.arts >= 8,
  },
  {
    id: 'examined',
    name: 'Examined Life',
    tier: 'silver',
    detail: 'Answered ten questions about yourself.',
    won: (s) => s.answered >= 10,
  },
  {
    id: 'contrarian',
    name: 'Contrarian',
    tier: 'bronze',
    detail: 'Thumbed down ten games. Taste is what you refuse.',
    won: (s) => s.disliked >= 10,
  },
  {
    id: 'centurion',
    name: 'Centurion',
    tier: 'gold',
    detail: 'A hundred games on the record.',
    won: (s) => s.said >= 100,
  },
  {
    id: 'archivist',
    name: 'The Long Haul',
    tier: 'platinum',
    detail: 'Level twenty.',
    won: (s) => s.level >= 20,
  },
];

export const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum'];

/** Which trophies the current state wins, in case order. */
export function trophiesFrom(stats) {
  return TROPHIES.map((trophy) => ({ ...trophy, won: Boolean(trophy.won(stats)) }));
}

/**
 * The counts every trophy is judged on, from the same state the XP uses.
 *
 * One place, so a trophy and the bar underneath it can never disagree about
 * how many games somebody has finished.
 */
export function statsFrom({
  ratings = new Map(),
  library = new Set(),
  wishlist = new Set(),
  backlog = new Map(),
  answers = {},
  features = new Set(),
  level = 1,
} = {}) {
  const states = [...backlog.values()];
  const ids = new Set([...ratings.keys(), ...library, ...wishlist, ...backlog.keys()]);
  const kinds = (prefix) =>
    new Set([...features].filter((f) => f.startsWith(prefix))).size;
  return {
    said: ids.size,
    rated: ratings.size,
    disliked: [...ratings.values()].filter((v) => v === 'dislike').length,
    owned: library.size,
    wanted: wishlist.size,
    finished: states.filter((s) => s === 'finished').length,
    playing: states.filter((s) => s === 'playing').length,
    bounced: states.filter((s) => s === 'bounced').length,
    answered: Object.keys(answers).length,
    genres: kinds('genre:') + kinds('sgenre:'),
    arts: kinds('art:'),
    level,
  };
}
