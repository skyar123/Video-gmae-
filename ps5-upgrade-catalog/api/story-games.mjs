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

/** "Dispatch's" without the possessive, leaving "Dispatch" to be matched. */
const stripPossessives = (value) => String(value ?? '').replace(/([\w])[’'‘]s\b/g, '$1');

/** Shorter than this and a "title" is a coincidence waiting to happen. */
const MIN_TITLE = 7;

const tooOrdinary = (words) => {
  if (words.length > 2) return false;
  if (words.every((word) => PLAIN.has(word))) return true;
  // "The Rise" is an article and a common noun, which is a phrase, not a name.
  return words.length === 2 && /^(the|a|an)$/.test(words[0]) && PLAIN.has(words[1]);
};

/**
 * Is this one story about this one game?
 *
 * The feed asks "which of 9,728 games is this about"; a game's own page asks
 * the narrower question, and gets the same guards plus, for a title that is
 * an ordinary word, the requirement that the game lead the headline.
 */
/**
 * Is this title too ordinary, or too short, to match on its own?
 *
 * The same question the index asks before it will hold a title at all, which
 * is why it is answered in one place. Somewhere else has to ask it too: when
 * a reader opens a game's page the catalog knows exactly which game is
 * meant, so the title cannot simply be dropped, but a search for it still
 * needs the stricter reading that an ordinary word deserves.
 */
export function storyIsAbout(text, name, { strict } = {}) {
  const raw = String(text ?? '');
  if (!raw || !name) return false;
  const foldings = readings(raw);
  const keys = [...new Set([foldTitle(name), foldTitle(stripPossessives(name))])].filter(Boolean);
  const tight = strict ?? titleIsOrdinary(name);
  return keys.some((key) => namesTitle(raw, foldings, key, { strict: tight }));
}

export function isSlipperyTitle(name) {
  const key = foldTitle(name);
  if (!key) return true;
  return key.length < MIN_TITLE || tooOrdinary(key.split(' '));
}

/**
 * Is the title made of words that are also just words?
 *
 * A narrower question than isSlipperyTitle, and the right one when the game
 * is already known. Shortness is what makes a title dangerous to *scan a
 * feed for*, because a short string turns up inside prose by accident; it is
 * not what makes a search for it noisy. Searching the press for Stray gets
 * articles about the game, because that is what people write about when they
 * write "Stray". Searching for Lake gets Lake Michigan.
 *
 * Measured on real searches. Judged by length, Stray is slippery and loses
 * two genuine pieces to the stricter reading while shedding only one wrong
 * one, which is a bad trade. Judged by vocabulary it is an ordinary-looking
 * name that nobody else uses, and keeps them.
 */
export function titleIsOrdinary(name) {
  const key = foldTitle(name);
  return key ? tooOrdinary(key.split(' ')) : true;
}

/**
 * Builds the lookup once. Written-up games win over mirror rows of the same
 * name, because a write-up is the better page to send a reader to.
 */
export function buildTitleIndex(games) {
  const byTitle = new Map();
  for (const game of games) {
    const name = game.name ?? game.title;
    /*
     * Under both foldings of its own name, for the same reason the story is
     * read both ways: a headline may put an already-possessive title into
     * the possessive again ("Baldur's Gate 3's next patch"), and the reading
     * that recovers the second apostrophe strips the first one too. Only
     * titles carrying an apostrophe get a second key, which is 200 of the
     * catalog's 9,728, and the spare key also catches the headlines that
     * write the name without its apostrophe at all.
     */
    for (const key of new Set([foldTitle(name), foldTitle(stripPossessives(name))])) {
      if (!key || key.length < MIN_TITLE) continue;
      if (tooOrdinary(key.split(' '))) continue;
      const held = byTitle.get(key);
      if (!held || (!held.curated && game.curated)) byTitle.set(key, { ...game, name });
    }
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

/**
 * A story read two ways, because the apostrophe cuts both ways.
 *
 * Game names contain possessives of their own (Baldur's Gate, No Man's Sky,
 * Marvel's Spider-Man), and headlines put games in the possessive
 * ("Dispatch's free DLC", "Half of Control Resonant's players"). One folding
 * cannot serve both: dropping the apostrophe alone turns "Dispatch's" into
 * "dispatchs" and loses the second, and stripping the whole "'s" turns
 * "Baldur's" into "baldur" while an index built the other way holds
 * "baldurs", and loses the first.
 *
 * On a live day this cost two of the dozen-odd headlines that name a game at
 * all, which is most of a sixth of the join. So the story is folded both
 * ways and matched against both, and the index keeps the one folding it
 * always had.
 */
const readings = (raw) => {
  const plain = ` ${foldTitle(raw)} `;
  const possessive = ` ${foldTitle(stripPossessives(raw))} `;
  return possessive === plain ? [plain] : [plain, possessive];
};

export function findGameInStory(text, index) {
  const raw = String(text ?? '');
  if (!raw) return null;
  const foldings = readings(raw);

  // Only titles beginning with a word the story contains, longest first, so
  // the best candidate is tried before any shorter one it contains.
  const candidates = new Set();
  for (const reading of foldings) {
    for (const word of reading.trim().split(' ')) {
      for (const key of index.byFirstWord.get(word) ?? []) candidates.add(key);
    }
  }

  for (const key of [...candidates].sort((a, b) => b.length - a.length)) {
    if (!namesTitle(raw, foldings, key)) continue;
    return index.byTitle.get(key);
  }
  return null;
}

/**
 * Does this headline name this exact title, and can that be trusted?
 *
 * Every guard the feed matcher uses, in one place, so the two callers cannot
 * drift apart. `strict` adds the one rule that only makes sense when the
 * title is already known to be a slippery one: that it has to lead the
 * headline. See the note on it below.
 */
export function namesTitle(raw, foldings, key, { strict = false } = {}) {
  {
    const folded = foldings.find((reading) => reading.includes(` ${key} `));
    if (!folded) return false;
    const at = folded.indexOf(` ${key} `);

    /*
     * Where the match sits in the untouched headline, which is what the
     * capitalisation guards below read.
     *
     * Found with a pattern rather than by searching for the folded word,
     * because folding removes the punctuation the raw text still has:
     * "Baldur's" folds to "baldurs", and "baldurs" does not occur in
     * "Baldur's Gate 3". Of the 9,728 titles in the catalog, 200 begin with
     * a word carrying an apostrophe, and 199 of them could not be found even
     * in a sentence that named them outright.
     *
     * It takes the first occurrence of the head word, which can differ from
     * the one the folded match found when a headline says it twice. That was
     * true of the indexOf this replaces too, and a headline naming a game
     * twice is one where either occurrence answers the question.
     */
    const head = key.split(' ')[0];
    const loose = new RegExp(
      head.split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^A-Za-z0-9]*'),
      'i',
    );
    const rawAt = loose.exec(raw)?.index ?? -1;

    // A name is capitalised. Without this, every game named after an ordinary
    // word is matched by that word: "voting is a true superpower" was being
    // filed under the game SuperPower.
    if (rawAt < 0 || !/^[A-Z0-9]/.test(raw.slice(rawAt, rawAt + 1))) return false;

    /*
     * A capitalised word immediately before means this is the tail of a
     * longer name: The Wolf Among Us is not Among Us, and Ghosts 'n Goblins
     * is not Goblins.
     *
     * Unless the only thing in front is a label. Games coverage is full of
     * "Review: Gone Home", "Rumour: Days Gone Dev to Announce", "Guide:",
     * "Preview:", and the capitalised word the guard objects to is the word
     * "Review". Searching the press for Gone Home lost two of its eight
     * results to this, both of them reviews of Gone Home.
     *
     * A label is the whole of what precedes the match and ends in a colon,
     * which is what keeps the guard: "The Wolf " is not a label, and neither
     * is "Rumour: Alleged ", where the colon has prose after it.
     */
    const before = raw.slice(0, rawAt);
    // A dash is a label too: "Review – Gone Home (Switch)" is the same
    // sentence as "Review: Gone Home", and outlets use both.
    const label = /^[^:–—]{0,30}[:–—][\s"'“‘]*$/.test(before);
    /*
     * The strict rule needs a shorter idea of a label than the guard above
     * does. A masthead's section word is a label: "Review:", "Rumour:",
     * "Preview:", "Guide:". A quoted sentence with a colon after it is not,
     * and treating it as one let "'Very resilient people': Lake Delhi
     * picking up steam 15 years after dam failure" back through as coverage
     * of the game Lake.
     */
    const sectionLabel = label && before.length <= 14;
    const lead = label ? '' : raw.slice(Math.max(0, rawAt - 40), rawAt).replace(/[:|–—-]\s*$/, '');
    if (/([A-Z][\w'’-]+)[\s'’n]*$/.test(lead)) return false;

    // A number straight after is a different entry in the same series:
    // Final Fantasy 14 is not the game called FINAL FANTASY.
    const after = folded.slice(at + key.length + 2).trim().split(' ')[0] ?? '';
    if (/^(\d{1,3}|[ivxl]{1,6})$/.test(after)) return false;

    /*
     * For a title that is an ordinary word, the game has to be what the
     * headline is about, not a word inside it.
     *
     * Measured against a real search for the game Lake, which returned
     * school-district STEAM bulletins, a shipwreck beneath Lake Superior,
     * and plans for a boat's return to Lake Minnetonka: eight results, none
     * about the game. The guards above take three of them and no more,
     * because "Lake" in "in Lake public schools" is capitalised, follows a
     * lowercase word, and is followed by one.
     *
     * Coverage of a game leads with its name: "Lake review", "Dispatch is
     * getting a physical edition", "Stray, To a T, Wanderstop announced".
     * Prose that happens to contain the word almost never does. A label in
     * front of it is still leading, because "Review: Lake" is the same
     * sentence wearing a hat.
     *
     * It costs recall, and only where recall was worth little: for Stray it
     * drops a genuine piece whose headline buries the name mid-sentence. For
     * Lake it takes eight wrong answers to none, and nothing is a better
     * answer than wrong.
     */
    if (strict && !sectionLabel && !/^[\s"'“‘([]*$/.test(before)) return false;

    return true;
  }
}
