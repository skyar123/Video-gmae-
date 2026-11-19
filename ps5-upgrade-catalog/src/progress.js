/**
 * The reader, as a character sheet.
 *
 * Asked for as gamification and RPG-like fun, which is a request worth
 * being careful with. The easy version of this is points for opening the
 * app, a streak that punishes you for having a life, and a progress bar
 * that fills whatever you do. None of that is fun, it is just a slot
 * machine with a games catalogue attached, and it would make this app worse
 * at the one thing it is for.
 *
 * So nothing here invents a score. Every number below is already true of the
 * reader and already used by the recommender; this only says it out loud.
 * The level is how much the model actually knows about you, the stats are
 * the feature weights it ranks on, and the quests are the gaps in it. Doing
 * a quest makes the picks better, which is the only reward this app has to
 * offer and happens to be a real one.
 *
 * The honest consequence: somebody who uses the app a lot and says nothing
 * stays at level one. That is correct. Watching is not evidence, and an app
 * that levelled you up for scrolling would be lying about what it knows.
 */

import { describeFeature, SAYING_IT, WORTH_SAYING } from './genius.js';

/**
 * What counts as having said something.
 *
 * Deliberately not "games seen" or "sessions". A rating, a shelf, a play
 * state: things the reader chose to record. Each one is worth the same
 * here even though the model weighs them differently, because this is a
 * count of opinions expressed, not of how much each one is trusted.
 */
/*
 * Nouns, every one of which reads as "<rank> of <something>".
 *
 * The first set mixed nouns and adjectives and produced "Opinionated of
 * queer stories", which is not a thing anybody would say. A title is only
 * worth having if the reader would repeat it.
 */
export const RANKS = [
  { at: 0, name: 'Newcomer' },
  { at: 3, name: 'Enthusiast' },
  { at: 10, name: 'Devotee' },
  { at: 25, name: 'Adept' },
  { at: 50, name: 'Curator' },
  { at: 100, name: 'Archivist' },
  { at: 200, name: 'Completionist' },
];

/**
 * Where the reader stands, and what it would take to move.
 *
 * `next` is null at the top rather than inventing an eighth rank nobody
 * reaches: a bar that can never fill is worse than no bar.
 */
export function rankFor(count) {
  const said = Math.max(0, Math.floor(count ?? 0));
  let current = RANKS[0];
  let next = null;
  for (const rank of RANKS) {
    if (said >= rank.at) current = rank;
    else {
      next = rank;
      break;
    }
  }
  return {
    said,
    name: current.name,
    at: current.at,
    next,
    toNext: next ? next.at - said : 0,
    // Progress through the current rank, for a bar that means something.
    through: next ? (said - current.at) / (next.at - current.at) : 1,
  };
}

/**
 * The stats, grouped the way a sheet would group them.
 *
 * Only features worth saying out loud, which is the same floor the reason
 * under a pick uses: an age tier is shared by thousands of games, so it can
 * carry real weight in a ranking while telling a person nothing about
 * themselves. Without that floor the top of this sheet reads "games with a
 * light touch, rated Everyone 10+", which is true and useless.
 */
export const GROUPS = [
  { id: 'genre', label: 'Genres', kinds: ['genre', 'sgenre'] },
  { id: 'mood', label: 'Moods', kinds: ['tag', 'rep'] },
  { id: 'art', label: 'Looks', kinds: ['art'] },
  { id: 'lead', label: 'Who you play', kinds: ['lead'] },
];

export function statsFor(taste, { per = 4 } = {}) {
  const weights = taste?.weights ?? new Map();
  const groups = GROUPS.map((group) => ({ ...group, entries: [] }));

  for (const [feature, weight] of weights) {
    if (!(weight > 0)) continue;
    const kind = feature.slice(0, feature.indexOf(':'));
    if ((SAYING_IT[kind] ?? 1) < WORTH_SAYING) continue;
    const phrase = describeFeature(feature);
    if (!phrase) continue;
    const group = groups.find((entry) => entry.kinds.includes(kind));
    if (!group) continue;
    // The same thing said by both vocabularies is one stat, not two.
    if (group.entries.some((entry) => entry.phrase === phrase)) continue;
    group.entries.push({ feature, phrase, weight });
  }

  for (const group of groups) {
    group.entries.sort((a, b) => b.weight - a.weight);
    group.entries = group.entries.slice(0, per);
  }
  return groups.filter((group) => group.entries.length > 0);
}

/**
 * A name for the reader, from the single thing the model is most sure of.
 *
 * One feature, not a blend. "Adept of cozy games" is a claim somebody can
 * recognise or dispute; stringing four together produces a sentence nobody
 * would say about themselves and that no evidence supports.
 */
export function titleFor(taste, rankName) {
  const stats = statsFor(taste, { per: 1 });
  const best = stats
    .flatMap((group) => group.entries)
    .sort((a, b) => b.weight - a.weight)[0];
  if (!best) return rankName;
  return `${rankName} of ${best.phrase}`;
}

/**
 * How much of the catalogue the reader has an opinion about.
 *
 * Shown because it is the honest denominator. A hundred opinions feels like
 * a lot until you see it against 506 write-ups, and the point of the number
 * is not to shame anybody into filling it but to make clear that the model
 * is working from a sample.
 */
export function coverageFor(said, total) {
  if (!total) return { said: 0, total: 0, share: 0 };
  return { said, total, share: Math.min(1, said / total) };
}

/* ------------------------------------------------------------------ *
 * Quests
 * ------------------------------------------------------------------ */

/**
 * Things worth doing, drawn from what is actually missing.
 *
 * Every one of these either tells the model something it does not know or
 * resolves something the reader left hanging. None of them is "open the app
 * tomorrow", because that is a reward for the app rather than for the
 * person using it.
 *
 * Ordered by how much the answer would change, so the first quest is the
 * most useful rather than the easiest.
 */
export function questsFor({
  signals = [],
  backlog = new Map(),
  library = new Set(),
  wishlist = new Set(),
  ratings = new Map(),
  catalog = [],
  blankKinds = [],
} = {}) {
  const quests = [];
  const said = signals.length;

  const playing = [...backlog.values()].filter((state) => state === 'playing').length;
  /*
   * Counted from both, because they are two views of one fact and a quest
   * that asked for a first finish from somebody who had finished something
   * would be the app not listening.
   */
  const finished =
    [...backlog.values()].filter((state) => state === 'finished').length +
    signals.filter((row) => row.kind === 'finished').length;

  /*
   * Owned and never judged. The largest easy win in most profiles: the app
   * already knows these games are yours and knows nothing about whether you
   * liked them.
   */
  const ownedUnsaid = [...library].filter(
    (id) => !ratings.has(id) && !backlog.has(id),
  ).length;
  if (ownedUnsaid > 0) {
    quests.push({
      id: 'judge-owned',
      title: 'Say what you made of something you own',
      detail: `${ownedUnsaid} ${ownedUnsaid === 1 ? 'game is' : 'games are'} on your shelf with nothing said about ${ownedUnsaid === 1 ? 'it' : 'them'}. Owning a game is the weakest thing you can tell the model; a thumb is the strongest.`,
      worth: 5,
    });
  }

  if (playing > 0) {
    quests.push({
      id: 'finish-playing',
      title: playing === 1 ? 'Finish what you started' : `Finish one of your ${playing}`,
      detail:
        'Finishing counts nearly as much as a thumbs up, because it is twenty hours of agreeing with a choice.',
      worth: 4,
    });
  }

  /*
   * A kind of game the profile has no opinion about at all. Supplied by the
   * caller, because working out which features are blank is the guided
   * questions' job and duplicating it here would mean two answers to one
   * question.
   */
  for (const blank of blankKinds.slice(0, 2)) {
    quests.push({
      id: `explore-${blank.features?.[0] ?? blank.phrase}`,
      title: `Decide how you feel about ${blank.phrase}`,
      detail: `${blank.games} ${blank.games === 1 ? 'game' : 'games'} here and the model has nothing on it either way, so it is guessing for all of them.`,
      worth: 3,
    });
  }

  if (wishlist.size > 0 && finished === 0) {
    quests.push({
      id: 'first-finish',
      title: 'Record your first finish',
      detail:
        'The app knows what you want and what you own, and nothing about what you have actually played.',
      worth: 3,
    });
  }

  if (said < 3) {
    quests.unshift({
      id: 'first-words',
      title: 'Tell it about three games',
      detail:
        'Until then the picks are simply the best reviewed, which is a list of good games rather than a list for you.',
      worth: 6,
    });
  }

  // A catalogue-sized goal, last, because it is the long one.
  const total = catalog.length;
  if (total > 0 && said >= 10) {
    quests.push({
      id: 'coverage',
      title: 'Form an opinion on a tenth of the catalogue',
      detail: `${said} of ${total} so far. Every one of them sharpens what the other ${total - said} are ranked against.`,
      worth: 1,
    });
  }

  return quests.sort((a, b) => b.worth - a.worth);
}

/**
 * Which quests have just been finished.
 *
 * A quest here clears by disappearing: "say what you made of something you
 * own" exists while an unjudged game is on the shelf and is gone once there
 * is not one. That is self-maintaining and completely silent, which makes
 * it a to-do list rather than anything worth doing.
 *
 * So the ids that were open last time are remembered, and anything missing
 * from the current set has been done. The reader gets told once.
 *
 * Deliberately not a score, a streak or a running total. It is an
 * acknowledgement that a specific thing happened, and the thing that
 * happened is that the picks got better.
 */
export function justFinished(openNow, openBefore = []) {
  const now = new Set(openNow.map((quest) => quest.id));
  return openBefore.filter((id) => !now.has(id));
}

/**
 * What to remember for next time.
 *
 * Only the ids currently open. Storing the finished ones too would mean a
 * quest that comes back, which they do, could never be celebrated twice:
 * somebody who judges every owned game and then buys three more has done
 * the thing again and it counted again.
 */
export const questsToRemember = (open) => open.map((quest) => quest.id);
