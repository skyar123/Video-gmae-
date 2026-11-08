/**
 * Who made each game, baked from Wikidata.
 *
 * PlayStation's own data has a publisher and no developer anywhere in it.
 * Checked directly against The Last of Us Part I, whose concept page
 * reports Sony Interactive Entertainment and nothing about Naughty Dog.
 * So searching a studio by name could only ever find the handful who
 * publish themselves, and every first-party game, which is most of the
 * reason to own a PlayStation, answered to Sony and nobody else.
 *
 * Wikidata has it, free and without a key: P178 is "developer", so every
 * game with a studio credited comes back, and the ones this catalogue
 * holds are kept.
 *
 * Matched on the folded title, which is the same normalising the search
 * uses, so "The Last of Us™ Part I" and "The Last of Us Part I" are one
 * game. That is also the limit of it: a game Wikidata spells differently
 * is simply missed, and a miss is the right failure. The alternative is
 * fuzzy-matching studio credits, and a confidently wrong "made by" is
 * worse than none.
 *
 * This is one of two sources. The other is the store page itself, which
 * sometimes says "Developed by Housemarque Oy" in its own copy; that is
 * read whenever somebody opens a game and remembered, and it wins over
 * this file, because it is about that exact release rather than a title
 * that matched.
 *
 *   npm run bake:developers
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import baked from '../api/store-index.json' with { type: 'json' };
import { baseTitle, fold } from '../api/search.mjs';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'ps5-upgrade-catalog/1.0 (personal game catalog project)';
const PAGE = 2000;

/*
 * Every video game with a studio credited, and no platform filter.
 *
 * Asking Wikidata for PS4 and PS5 games seemed like the obvious
 * narrowing and was the wrong one: it returned 5,424 games and matched
 * 1,642 of ours, with one Naughty Dog game, no Sucker Punch and no Santa
 * Monica. Plenty of games carry no platform statement at all, and the
 * ones that do are not the ones a PlayStation catalogue needs most.
 *
 * Dropping it asks for all 44,045 instead. The platform filter was never
 * needed, because this app already has one: a title is only kept if the
 * PlayStation mirror has that game. Our own catalogue is the filter, and
 * it is a better one than a statement somebody has to have filled in.
 *
 * Labels are asked for by rdfs:label rather than through the label
 * service, which quietly hands back bare ids when it cannot resolve one.
 * Ghost of Tsushima's studio came back as "Q916714", which the Q-id guard
 * then dropped on the floor: a real answer, discarded for being formatted
 * like a failure. Asking for the English label directly cannot do that.
 */
const QUERY = (limit, offset) => `
SELECT DISTINCT ?gameLabel ?devLabel WHERE {
  ?game wdt:P31/wdt:P279* wd:Q7889 .
  ?game wdt:P178 ?dev .
  ?game rdfs:label ?gameLabel . FILTER(LANG(?gameLabel) = "en")
  ?dev  rdfs:label ?devLabel  . FILTER(LANG(?devLabel)  = "en")
}
ORDER BY ?gameLabel ?devLabel
LIMIT ${limit} OFFSET ${offset}`;

/** Belt and braces: a bare id is never a name, however it got here. */
const isQid = (value) => /^Q\d+$/.test(String(value ?? ''));

async function page(offset) {
  const url = `${ENDPOINT}?query=${encodeURIComponent(QUERY(PAGE, offset))}&format=json`;
  for (let tries = 0; tries < 3; tries += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/sparql-results+json' },
    });
    if (response.ok) return (await response.json()).results?.bindings ?? [];
    // The public endpoint throttles rather than refuses, so a pause and a
    // retry is the documented way through rather than a failure.
    console.error(`  offset ${offset}: http ${response.status}, retrying`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Wikidata would not answer for offset ${offset}`);
}

async function everything() {
  const pairs = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await page(offset);
    console.error(`  offset ${offset}: ${rows.length} rows`);
    for (const row of rows) pairs.push([row.gameLabel?.value, row.devLabel?.value]);
    if (rows.length < PAGE) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return pairs;
}

const rows = baked.rows ?? baked;
const mirror = new Map(rows.map((row) => [fold(row.name ?? ''), row.name]));

console.error('Asking Wikidata which studio made what...');
const pairs = await everything();

const AMBIGUOUS = Symbol('more than one studio claims this name');
const byTitle = new Map();
const byBase = new Map();
for (const [title, developer] of pairs) {
  if (!title || !developer || isQid(title) || isQid(developer)) continue;
  const key = fold(title);
  // First answer wins. A game with two developers listed gets the one
  // Wikidata sorts first rather than a guess at which mattered more.
  if (!byTitle.has(key)) byTitle.set(key, developer);
  /*
   * A looser key is only usable while exactly one studio claims it.
   *
   * Stripping an edition or a licensor brand makes two titles collide,
   * and some collisions are real: Wikidata credits two different games
   * called "Spider-Man" to two different studios, and there have been
   * two Tomb Raiders, by Core Design and by Crystal Dynamics. Taking the
   * first would be a coin toss presented as a fact.
   *
   * So the second, disagreeing claim poisons the key for good, and the
   * game keeps no studio at all. A gap is recoverable; the store page
   * fills it the first time somebody opens the game. A wrong credit just
   * sits there looking right.
   */
  const base = baseTitle(title);
  if (base && base !== key) {
    const held = byBase.get(base);
    if (held === undefined) byBase.set(base, developer);
    else if (held !== developer) byBase.set(base, AMBIGUOUS);
  }
}

/*
 * Exact first, edition-stripped only as a fallback.
 *
 * Stripping widens the net and widening a net is how a wrong answer gets
 * in: two unrelated games can share a base name, and Tomb Raider was
 * made by Core Design once and Crystal Dynamics later. An exact title is
 * never overruled by a looser one, so the fallback can only fill a gap,
 * never change an answer that was already right.
 */
const out = {};
let exact = 0;
let loose = 0;
for (const [key, name] of mirror) {
  const direct = byTitle.get(key);
  if (direct) {
    out[key] = direct;
    exact += 1;
    continue;
  }
  const stripped = baseTitle(name);
  const candidate = byBase.get(stripped) ?? byTitle.get(stripped);
  if (candidate && candidate !== AMBIGUOUS) {
    out[key] = candidate;
    loose += 1;
  }
}

const target = fileURLToPath(new URL('../api/developers.json', import.meta.url));
const studios = new Set(Object.values(out));
if (Object.keys(out).length === 0) {
  // Refusing to write an empty file, the same rule bake-upcoming follows:
  // a failed read should not look like a catalogue that lost its studios.
  console.error('Nothing matched. Leaving the existing file alone.');
  process.exit(1);
}

writeFileSync(target, `${JSON.stringify(out, null, 0)}\n`);
console.error(
  `\n${Object.keys(out).length} of ${mirror.size} games matched ` +
    `(${exact} by exact title, ${loose} once the edition was taken off), ` +
    `across ${studios.size} studios.`,
);
for (const want of ['naughty dog', 'insomniac', 'guerrilla', 'sucker punch', 'santa monica']) {
  const n = Object.values(out).filter((studio) => fold(studio).includes(fold(want))).length;
  console.error(`  ${want.padEnd(14)} ${n}`);
}
