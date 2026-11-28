/**
 * Telling a guide from a story.
 *
 * About a tenth of the press feed is not news: walkthroughs, item lists,
 * tier lists, redemption codes, "should you kill this character". They are
 * useful when you are playing that game this evening and noise when you are
 * reading the day, and they are published constantly, so they are always the
 * freshest thing in the feed. On the day this was written the top of the Top
 * column was two Fortnite item lists and a Witcher 3 choice walkthrough.
 *
 * This only decides where they sit. Nothing is hidden: they keep their place
 * in Latest, in Everything and in every shelf, and they get a chip of their
 * own for the evening you want them.
 *
 * The rules are deliberately shy. A missed guide costs a reader one filler
 * headline they can skip; a wrongly flagged story pushes real writing down
 * the page, and the writing most at risk is the essayistic kind this feed
 * carries the small press for. The first version of this was a word list,
 * and on a real day it flagged an Aftermath essay ("Valve Knows *How To*
 * Run A Shopfront"), a Game Developer talk ("an anti-*cheat* primer") and an
 * indie feature ("*Every* animal has its place *in* Tidy Up the Ark"). Every
 * rule below is narrower than the word that caught those, and all three are
 * in the tests.
 */

const RULES = [
  // Labelled as one, at the front or the back: "Guide: ...", "... Event Guide".
  /^\s*(guide|walkthrough|tips?|how to)\b/i,
  /\bguides?\s*$/i,
  /\bwalkthroughs?\b/i,
  /\btier list\b/i,
  // Plural only. "anti-cheat" is a subject, not a cheat sheet.
  /\bcheats\b/i,
  /\b(gift|promo|redeem\w*|redemption)\b[^.]*\bcodes?\b/i,
  // "X explained" as the whole point of the piece, not in passing.
  /\bexplained\s*$/i,
  /^\s*should you\b/i,
  /\b(100|one hundred)\s*(%|per ?cent)\b[^.]*\b(complete|completion|guide)/i,
  // "All the X in Y". Loose enough to catch prose, so it is the one rule
  // that also has to name something a guide would enumerate: see below.
  /^\s*(all|every)\b[^.]*\b(in|for)\b/i,
  // "... and how to get them", a guide however the headline opens. The verb
  // list is what keeps "Knows How To Run A Shopfront" out of it.
  /\bhow to (get|find|unlock|beat|defeat|win|craft|complete|redeem|farm|level|install|fix|solve|catch|evolve)\b/i,
  /\b(best|top \d+)\b[^.]*\b(loadouts?|builds?|decks?|precons?|teams?|players|settings|perks?|classes?|strategies)\b/i,
];

/** The one loose rule is the first in RULES that starts by anchoring all/every. */
const COUNTING_RULE = RULES.findIndex((rule) => rule.source.startsWith('^\\s*(all|every)'));

/** The nouns a guide counts. Without this, "All X in Y" is just a sentence. */
const COUNTABLE =
  /\b(locations?|weapons?|items?|codes?|endings?|bosses|characters?|outfits?|skins?|achievements?|trophies|collectibles?|status effects?|npcs?|quests?|recipes?|skills?|abilities|cards?|maps?|levels?|fruits?|upgrades?|perks?|relics?|chests?|choices?|loot)\b/i;

export function isGuide(title) {
  const text = String(title ?? '');
  for (const [at, rule] of RULES.entries()) {
    if (!rule.test(text)) continue;
    if (at === COUNTING_RULE && !COUNTABLE.test(text)) continue;
    return true;
  }
  return false;
}
