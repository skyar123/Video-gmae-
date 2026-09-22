/**
 * Title matching, shared by the catalog and the store mirror.
 *
 * Both used to match with `title.toLowerCase().includes(query)`, which fails
 * on almost everything a person actually types. "ragnarok" missed God of War
 * Ragnarök because of the umlaut. "spider man" missed Marvel's Spider-Man
 * because of the hyphen, and "marvel spider man" missed it because of the
 * apostrophe-s. Nine of ten queries tried by hand came back empty against a
 * catalog that had the game.
 *
 * So: fold the text down to letters and digits with accents removed, match
 * per word rather than as one contiguous run, and keep two cheap fallbacks
 * for the ways people compress a name — running it together ("spiderman")
 * and initialising it ("tlou"). Ranking still prefers the closest match, so
 * searching a full title puts that title first.
 */

/** Titles say VII and people type 7, and the store is inconsistent too. */
const ROMAN = {
  ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9',
  x: '10', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16',
};

/**
 * Down to lowercase letters, digits and single spaces.
 *
 * NFD splits an accented letter into the letter plus its mark, so stripping
 * the combining range is what turns "ö" into "o" rather than into a gap.
 * Apostrophes close up ("Marvel's" is one word, "marvels") while every other
 * separator opens a gap, which is what makes "Spider-Man" two words.
 */
export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const words = (folded) => (folded ? folded.split(' ') : []);

/** The same text with roman numerals written as digits, when it has any. */
function withDigits(folded) {
  const parts = words(folded);
  let changed = false;
  const mapped = parts.map((part) => {
    const digit = ROMAN[part];
    if (!digit) return part;
    changed = true;
    return digit;
  });
  return changed ? mapped.join(' ') : null;
}

/**
 * Everything a row can be matched against, precomputed once.
 *
 * `squashed` catches "spiderman"; `initials` catches "tlou". Both are far
 * weaker signals than a word match, and the scoring keeps them that way.
 */
export function indexText(value) {
  const folded = fold(value);
  const parts = words(folded);
  return {
    folded,
    words: parts,
    digits: withDigits(folded),
    squashed: parts.join(''),
    initials: initialsOf(parts),
    // "Final Fantasy VII" initialises to ffvr, but nobody types that; they
    // type ff7. Keeping the digit spelling's initials too costs one string.
    initialsDigits: withDigits(folded) ? initialsOf(words(withDigits(folded))) : null,
  };
}

const initialsOf = (parts) => parts.map((part) => part[0] ?? '').join('');

export function parseQuery(value) {
  const folded = fold(value);
  return { folded, words: words(folded), digits: withDigits(folded), squashed: words(folded).join('') };
}

/** Every query word must open some word in the row, in any order. */
function wordsCover(rowWords, queryWords) {
  const taken = new Array(rowWords.length).fill(false);
  for (const term of queryWords) {
    const at = rowWords.findIndex((word, index) => !taken[index] && word.startsWith(term));
    if (at < 0) return false;
    taken[at] = true;
  }
  return true;
}

/**
 * How well one row answers one query. Negative means no match.
 *
 * The bands are deliberately far apart: an exact title always outranks a
 * prefix, a prefix always outranks a match buried mid-title, and the two
 * compressed forms rank below anything that matched word by word.
 */
export function scoreMatch(row, query) {
  if (!query.folded) return 0;
  if (!row.folded) return -1;

  let score = -1;

  if (row.folded === query.folded || (row.digits && row.digits === query.digits)) {
    score = 1000;
  } else if (row.folded.startsWith(query.folded)) {
    score = 700 - Math.min(row.folded.length - query.folded.length, 60);
  } else {
    const at = row.folded.indexOf(query.folded);
    // Mid-title, and only on a word boundary: "war" should find God of War,
    // not Warhammer's neighbours by way of "Steward".
    if (at > 0 && row.folded[at - 1] === ' ') {
      score = 500 - Math.min(at, 60);
    } else if (wordsCover(row.words, query.words)) {
      score = 380 - Math.min(row.words.length - query.words.length, 40) * 2;
    } else if (row.digits && wordsCover(words(row.digits), words(query.digits ?? query.folded))) {
      score = 360;
    } else if (query.squashed.length >= 4 && row.squashed.includes(query.squashed)) {
      score = 220;
    } else if (
      query.squashed.length >= 2 &&
      (row.initials.startsWith(query.squashed) ||
        row.initialsDigits?.startsWith(query.squashed))
    ) {
      score = 160;
    }
  }

  return score;
}
