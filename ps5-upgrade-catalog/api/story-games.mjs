/**
 * Which game a story is about.
 *
 * The app is a catalog of 9,222 games and a feed of three hundred stories a
 * day, and the two never touched: a headline about Silent Hill told you
 * nothing about whether you owned it, what it cost, or whether PS Plus
 * already covered it, and the game's own page never mentioned that anybody
 * had written about it this week. This is the join between them.
 *
 * It is all guard. Matching a title inside a sentence is easy and wrong: the
 * catalog contains games called Lake, Peak, Dispatch, Control, Preserve and
 * SuperPower, and a feed of English prose contains all of those words. A link
 * to the wrong game is worse than no link, because the reader cannot tell
 * which one it is until they follow it. So the rules below each exist because
 * of a specific thing this got wrong against real headlines, and each is
 * named in the tests.
 */

/** Punctuation and case removed, so "Marvel's Spider-Man" meets "marvels spider man". */
export const foldTitle = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Words ordinary enough that a title built only from them cannot be told
 * apart from prose. A game named Lake is real, and so is the word.
 */
const PLAIN = new Set(
  `the a an and or of to in on for with from at by is are be was were
   new my your our their this that these those it its all more most best worst
   good bad big little small great long short rise fall day days night nights
   time times year years world worlds game games play player players story
   stories life lives death end ends start war wars battle fight hero heroes
   dark light fire water earth sky star stars moon sun home house road lake
   peak hill river sea ocean island isle forest city town village lost found
   gone back out up down over under inside outside control prey journey
   dispatch copycat preserve haunted dead alive one two three`
    .split(/\s+/)
    .filter(Boolean),
);

/** Shorter than this and a "title" is a coincidence waiting to happen. */
const MIN_TITLE = 7;

const tooOrdinary = (words) => {
  if (words.length > 2) return false;
  if (words.every((word) => PLAIN.has(word))) return true;
  // "The Rise" is an article and a common noun, which is a phrase, not a name.
  return words.length === 2 && /^(the|a|an)$/.test(words[0]) && PLAIN.has(words[1]);
};

/**
 * Builds the lookup once. Written-up games win over mirror rows of the same
 * name, because a write-up is the better page to send a reader to.
 */
export function buildTitleIndex(games) {
  const byTitle = new Map();
  for (const game of games) {
    const name = game.name ?? game.title;
    const key = foldTitle(name);
    if (!key || key.length < MIN_TITLE) continue;
    if (tooOrdinary(key.split(' '))) continue;
    const held = byTitle.get(key);
    if (!held || (!held.curated && game.curated)) byTitle.set(key, { ...game, name });
  }
  /*
   * Grouped by first word, which is what makes this affordable. Walking all
   * 9,222 titles for each of three hundred stories is two and a half million
   * substring tests every time the feed is rebuilt; a story only has to be
   * checked against titles that start with a word it actually contains.
   */
  const byFirstWord = new Map();
  for (const key of byTitle.keys()) {
    const head = key.split(' ')[0];
    if (!byFirstWord.has(head)) byFirstWord.set(head, []);
    byFirstWord.get(head).push(key);
  }
  // Longest first, so "Phantom Blade Zero" is found before "Phantom".
  for (const list of byFirstWord.values()) list.sort((a, b) => b.length - a.length);
  return { byTitle, byFirstWord };
}

export function findGameInStory(text, index) {
  const raw = String(text ?? '');
  if (!raw) return null;
  const folded = ` ${foldTitle(raw)} `;

  // Only titles beginning with a word the story contains, longest first, so
  // the best candidate is tried before any shorter one it contains.
  const candidates = new Set();
  for (const word of folded.trim().split(' ')) {
    for (const key of index.byFirstWord.get(word) ?? []) candidates.add(key);
  }

  for (const key of [...candidates].sort((a, b) => b.length - a.length)) {
    const at = folded.indexOf(` ${key} `);
    if (at < 0) continue;

    const head = key.split(' ')[0];
    const rawAt = raw.toLowerCase().indexOf(head);

    // A name is capitalised. Without this, every game named after an ordinary
    // word is matched by that word: "voting is a true superpower" was being
    // filed under the game SuperPower.
    if (rawAt < 0 || !/^[A-Z0-9]/.test(raw.slice(rawAt, rawAt + 1))) continue;

    // A capitalised word immediately before means this is the tail of a
    // longer name: The Wolf Among Us is not Among Us, and Ghosts 'n Goblins
    // is not Goblins.
    const lead = raw.slice(Math.max(0, rawAt - 40), rawAt).replace(/[:|–—-]\s*$/, '');
    if (/([A-Z][\w'’-]+)[\s'’n]*$/.test(lead)) continue;

    // A number straight after is a different entry in the same series:
    // Final Fantasy 14 is not the game called FINAL FANTASY.
    const after = folded.slice(at + key.length + 2).trim().split(' ')[0] ?? '';
    if (/^(\d{1,3}|[ivxl]{1,6})$/.test(after)) continue;

    return index.byTitle.get(key);
  }
  return null;
}
