/**
 * One event, several outlets.
 *
 * The feed reads thirty-seven sources, so when something actually happens the
 * screen fills with the same thing said four ways. On a single ordinary day,
 * EA shutting down BioWare arrived from GameSpot, Game Developer, Game
 * Informer and VGC; Pikmin Day from three; the Final Fantasy XIV expansion
 * from four. Twenty of the day's hundred and one press stories were seven
 * events, and because every one of them is fresh and plausible they crowd out
 * the rest of the day.
 *
 * Collapsing them does two things worth having. It gives the slots back to
 * stories nobody else ran. And the size of the pile is itself the news: four
 * outlets on one report is how you know it is the day's big story, which is a
 * thing a flat river of headlines can never tell you.
 *
 * The danger is the opposite of story-games.mjs. There a wrong link sent you
 * to the wrong page; here a wrong merge *hides a story*, and you cannot
 * notice what you were not shown. So every rule below exists because of a
 * specific pair this got wrong on real headlines, and each is named in a
 * test.
 */

/**
 * Function words, and the furniture every outlet puts on every headline.
 *
 * Deliberately short. Which words are uninformative is a question the feed
 * itself answers better than a hand-written list can: a word shared by forty
 * headlines is worth nothing here no matter how meaty it looks, and that
 * falls out of the weighting below. The list only has to cover grammar.
 */
const STOP = new Set(
  `a an the and or but nor of to in on at by for with from as into onto over under
   is are was were be been being has have had do does did will would can could
   should may might must it its it's this that these those there here
   i you he she we they them his her their our your my me us
   not no yes if so than then when what why how who whom which while during after
   before about above below up down out off again more most some any all every both
   each few other another such own same too very just now new only also
   says say said get gets got go goes going make makes made take takes
   one two three first next last best worst top good great big little
   game games gaming gamer video news review reviews preview features feature
   guide interview opinion report reports reportedly rumour rumor rumours rumors
   trailer launch launches release releases announce announced announcement
   update updates coming comes come out now still back way thing things
   ps5 ps4 playstation xbox nintendo switch steam pc console`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Words that place a story in time rather than describe it.
 *
 * Dropped from the evidence because a date is the one thing unrelated
 * stories reliably share: three outlets run a what-are-you-playing column
 * every Saturday, and on the real feed "Something for the Weekend 31/10/26",
 * "What Are You Playing This Weekend? (31st October)" and "The Video Games
 * You Should Play This Weekend - October 30" were held together by nothing
 * but the calendar. They still read as a date in the headline; they just
 * cannot be the reason two headlines are called the same story.
 */
const CALENDAR = new Set(
  `monday tuesday wednesday thursday friday saturday sunday weekend week weekly
   today tomorrow yesterday tonight month monthly year daily
   january february march april may june july august september october november december
   jan feb mar apr jun jul aug sep sept oct nov dec`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Crude on purpose. "leaks" and "leaked" have to meet for the Persona 1
 * pair to cluster, and a real stemmer is a dependency and a surprise; this
 * only has to fold the endings English headlines actually alternate between.
 */
export function stem(word) {
  if (word.length > 6 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Everything a headline might be matched on, before any weighting, in the
 * order the headline says it. The order is evidence in its own right: see
 * sameSinglePhrase below.
 */
export function evidenceOf(title) {
  const words = String(title ?? '')
    .toLowerCase()
    // The possessive comes off as a unit, before anything else. Folding the
    // apostrophe away instead turns "BioWare's" into "biowares", which the
    // stemmer then cuts to "biowar" while a plain "BioWare" stays "bioware",
    // so the most distinctive word in a story is thrown away whenever an
    // outlet happens to write it possessively. Measured on the day this was
    // built it did not change which stories grouped, but it is what the
    // grouping rested on: without it the four EA reports hung off a single
    // bridging outlet, and with it GameSpot and Game Developer agree
    // directly.
    .replace(/[‘’']s\b/g, '')
    .replace(/[‘’']/g, '')
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const out = [];
  for (const word of words) {
    if (STOP.has(word) || CALENDAR.has(word)) continue;
    // A bare number is a date, a price, an episode or a version, and all four
    // recur across stories that have nothing to do with each other.
    if (/^\d+(st|nd|rd|th)?$/.test(word)) continue;
    const root = stem(word);
    if (root.length < 3 || STOP.has(root) || CALENDAR.has(root)) continue;
    out.push(root);
  }
  return out;
}

/**
 * How surprising each word is in today's feed.
 *
 * Rarity is the whole of the weighting, and deliberately so: which words are
 * uninformative is something the feed answers better than a hand-written list
 * of furniture can. A word in forty of today's headlines is worth nothing
 * here however meaty it looks, and a word in two is worth a great deal.
 *
 * Two details here were both got wrong first, and both measured on a real
 * day's feed rather than reasoned about.
 *
 * The count is smoothed, which is what keeps one very rare word from
 * deciding a merge on its own. Without the +1 the two words "DLC" and "map"
 * outweighed the four that four outlets shared about Pikmin Day, and two
 * unrelated stories merged while a real pile did not.
 *
 * And the total is divided back out, so the threshold is in units of "words
 * nobody else used" instead of raw logarithms. Raw, the scores grow with the
 * size of the feed, so a threshold tuned against a hundred headlines
 * loosened the moment the Bluesky haul took the corpus to five hundred, and
 * the merges it had been holding back went through.
 *
 * It does mean the clusterer cannot work without a feed to judge against.
 * Handed two headlines and nothing else it has no idea which of their words
 * are ordinary, and the right answer in that case is the one it gives: it
 * groups nothing. The tests put their pairs inside a real captured day for
 * that reason.
 */
function weigh(docs) {
  const seen = new Map();
  for (const doc of docs) {
    for (const token of new Set(doc)) seen.set(token, (seen.get(token) ?? 0) + 1);
  }
  const total = Math.max(docs.length, 1);
  // What a word used by exactly one story in the feed would be worth, so a
  // score of 1.0 means "the two agree on one word nobody else used".
  const rarest = Math.max(Math.log(total / 2), 0.0001);
  const weight = new Map();
  for (const [token, count] of seen) {
    weight.set(token, Math.log(total / (1 + count)) / rarest);
  }
  return weight;
}

/** Defaults are measured in scripts/explore-clusters.mjs against a real day's feed. */
export const CLUSTER_RULES = {
  /** Two headlines must agree on at least this many words. */
  minShared: 2,
  /**
   * And those words must be surprising enough, added up, to be more than a
   * coincidence, in units of words-nobody-else-used.
   *
   * Calibrated in scripts/explore-clusters.mjs against a real day of 101
   * press headlines, by reading all seventeen pairs it could make and
   * judging each by hand. The eleven true ones scored 2.2 and up; the six
   * wrong ones scored 1.8 and down. This sits in the gap between them
   * rather than on top of either.
   */
  minScore: 2.0,
  /** Coverage of one event lands inside a day or two; past that it is a follow-up. */
  windowHours: 60,
};

/** The shared words, grouped into the stretches of the headline they sit in. */
function phrasesOf(sequence, shared) {
  const runs = [];
  let open = null;
  for (let at = 0; at < sequence.length; at += 1) {
    if (!shared.has(sequence[at])) {
      open = null;
      continue;
    }
    if (open && open.end === at - 1) {
      open.words.push(sequence[at]);
      open.end = at;
    } else {
      open = { words: [sequence[at]], end: at };
      runs.push(open);
    }
  }
  return runs.map((run) => run.words.join(' '));
}

/**
 * The rule that separates coverage from a subject.
 *
 * Two stories about one game agree on its name and nothing else, and they
 * agree on it the same way round, because a name has an order. Two reports of
 * one event agree on the name *and* on something that happened, and they
 * arrange it differently, because each outlet wrote its own sentence.
 *
 * So: when everything two headlines have in common is a single unbroken
 * phrase, said in the same order on both sides, they are about the same
 * thing rather than reporting the same thing, and they stay apart.
 *
 * Every false merge on the day this was built was this shape, and none of
 * them needed the catalog to spot:
 *
 *   What Inspired *Phantom Blade Zero*'s Meigu Lake?
 *   GI Podcast: *Phantom Blade Zero* Is A Must-Play
 *   *Phantom Blade Zero*'s Lead Voice Actor Was Seemingly Replaced
 *
 *   Countdown: *Zelda: Ocarina Of Time* Dungeon Crawl #7
 *   Nintendo Highlights Eight New Things In *Zelda: Ocarina Of Time*
 *
 *   *Final Fantasy 14 Evercold*'s second job is the ranged Zephyr DPS
 *   *Final Fantasy 14 Evercold* gets a four week delay
 *
 * while the four outlets on the day's real story all pass it, because not one
 * of them put the facts in the same order:
 *
 *   EA Reportedly Chose An Unannounced *Star Wars* Game Over *BioWare*'s Next *Mass Effect*
 *   Report: EA shut down *BioWare* in favor of *Star Wars*: *Battlefront* sequel
 *   EA Reportedly Closed *BioWare* To Invest In Developing *Star Wars Battlefront* III
 *   EA chose to shut down *BioWare* so it could make *Star Wars Battlefront* 3 instead
 *
 * It is the one guard here that does not need to know the game, which is what
 * makes it the one that holds: the catalog is PlayStation only, so the
 * Zelda and Pikmin piles are invisible to the join in story-games.mjs, and a
 * guard built on the matched name would have let both of those through.
 */
function sameSinglePhrase(left, right, shared) {
  const here = phrasesOf(left, shared);
  const there = phrasesOf(right, shared);
  return here.length === 1 && there.length === 1 && here[0] === there[0];
}

const hoursApart = (a, b) =>
  Math.abs(new Date(a ?? 0).getTime() - new Date(b ?? 0).getTime()) / 3600000;

/*
 * A note on the guard that is not here.
 *
 * The obvious way to keep three stories about Phantom Blade Zero apart is to
 * ask story-games.mjs which game each headline is about and strike that name
 * out of the evidence, so two stories have to agree on something other than
 * their subject. That was built first, and then measured: on a real day's
 * feed it changed not one join, because it cannot fire where it is needed.
 *
 * The matcher refuses a title preceded by a capitalised word, since that is
 * usually the tail of a longer name, so "What Inspired *Phantom Blade Zero*'s
 * Meigu Lake?" matches nothing and keeps its name in the evidence. And the
 * catalog is PlayStation only, so the Zelda and Pikmin piles are invisible to
 * it by construction. A guard that cannot see the cases it exists for is not
 * a guard, it is a comment, so it was deleted and sameSinglePhrase does the
 * work instead.
 */

/**
 * Groups the feed into events, and reports every pair it joined.
 *
 * Single-link: A joins B and B joins C makes one pile even when A and C never
 * met, because headlines about one event often share nothing but their
 * middles. Nintendo Life's "Nintendo Drops Surprise 'Pikmin Day' Direct" and
 * Game Informer's "Shigeru Miyamoto Proclaims November 1 is Pikmin Day"
 * overlap on almost nothing; Kotaku's version, which says both, is what holds
 * them together.
 */
export function groupStories(bursts, rules = CLUSTER_RULES) {
  const docs = bursts.map((burst) => evidenceOf(burst.title));
  const weight = weigh(docs);

  const parent = bursts.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    for (let walk = index; parent[walk] !== root; ) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const joins = [];

  for (let left = 0; left < bursts.length; left += 1) {
    for (let right = left + 1; right < bursts.length; right += 1) {
      if (find(left) === find(right)) continue;
      if (hoursApart(bursts[left].publishedAt, bursts[right].publishedAt) > rules.windowHours) {
        continue;
      }
      const rightSide = new Set(docs[right]);
      const overlap = [...new Set(docs[left])].filter((token) => rightSide.has(token));
      const shared = new Set(overlap);
      if (shared.size < rules.minShared) continue;
      const score = [...shared].reduce((sum, token) => sum + (weight.get(token) ?? 0), 0);
      if (score < rules.minScore) continue;
      if (sameSinglePhrase(docs[left], docs[right], shared)) continue;
      joins.push({ left, right, shared: [...shared], score });
      parent[find(left)] = find(right);
    }
  }

  const piles = new Map();
  for (let index = 0; index < bursts.length; index += 1) {
    const root = find(index);
    if (!piles.has(root)) piles.set(root, []);
    piles.get(root).push(index);
  }
  return { piles: [...piles.values()], joins };
}

/**
 * Marks which event each story belongs to, and leaves the folding to the view.
 *
 * The first version collapsed the piles here, on the server, and that is the
 * version that quietly breaks the feed's own filters. The reader can narrow
 * the feed to reviews, or to the queer and worker-owned press, or to the trade
 * press; a pile holds stories of several kinds from several shelves, so
 * replacing four stories with one card means three shelves silently lose a
 * story, and a lost story is the one kind of mistake a reader cannot notice.
 * Collapsing the Final Fantasy pile cost the RPG shelf its RPG Site piece.
 *
 * Splitting each pile along shelf lines fixes that and gives up half the
 * point: on the day this was built it turned eighteen stories into twelve
 * cards instead of six, because the duplication is mostly between outlets of
 * different kinds.
 *
 * So the pile is named here and folded in the view, after the filters have
 * run. Every shelf still contains every story it did before, and whatever
 * you are looking at folds within itself: the whole feed shows one card for
 * the four EA reports, and the trade shelf on its own still shows Game
 * Developer's.
 */
export function tagStories(bursts, rules = CLUSTER_RULES) {
  const { piles } = groupStories(bursts, rules);
  const named = new Map();
  for (const pile of piles) {
    if (pile.length < 2) continue;
    // Named after its earliest member, so the name survives the feed being
    // rebuilt and a reader's open card does not jump when a new outlet piles on.
    const first = [...pile].sort(
      (a, b) => new Date(bursts[a].publishedAt ?? 0) - new Date(bursts[b].publishedAt ?? 0),
    )[0];
    for (const index of pile) named.set(index, bursts[first].link);
  }
  return bursts.map((burst, index) =>
    named.has(index) ? { ...burst, story: named.get(index) } : burst,
  );
}
