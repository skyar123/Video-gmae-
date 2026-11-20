/**
 * Prints every join the clusterer makes against a live day of the feed, with
 * the evidence it used, so each one can be read and judged by hand.
 *
 *   node scripts/explore-clusters.mjs [minScore]
 *
 * This is not a test. It is how the thresholds in CLUSTER_RULES were chosen:
 * a summary number cannot tell you whether a merge hid a story, and the only
 * way to find that out is to look at the pairs.
 */
import { loadNews } from '../api/news.mjs';
import { storeRows } from '../api/store.mjs';
import { buildTitleIndex, findGameInStory } from '../api/story-games.mjs';
import { CLUSTER_RULES, groupStories } from '../api/story-clusters.mjs';
import catalog from '../src/games.json' with { type: 'json' };

const rules = { ...CLUSTER_RULES };
if (process.argv[2]) rules.minScore = Number(process.argv[2]);
if (process.argv[3]) rules.minShared = Number(process.argv[3]);

const { items } = await loadNews();
let index = null;
try {
  const rows = await storeRows();
  index = buildTitleIndex([
    ...rows.map((row) => ({ name: row.name })),
    ...catalog.map((game) => ({ name: game.title, curated: true })),
  ]);
  console.log(`store index: ${rows.length} rows`);
} catch (error) {
  console.log(`store index unavailable (${error?.message}): name guard is off`);
}

const bursts = items.map((item) => ({
  source: item.source,
  tone: item.tone ?? null,
  title: item.title,
  link: item.link,
  publishedAt: item.publishedAt,
  heat: 0,
  game: index ? findGameInStory(item.title, index) : null,
}));

const { piles, joins } = groupStories(bursts, rules);

console.log(`\n${bursts.length} stories, rules ${JSON.stringify(rules)}`);
console.log(`${joins.length} joins\n`);
for (const join of joins) {
  console.log(`score ${join.score.toFixed(1)}  [${join.shared.join(' ')}]`);
  console.log(`   A ${bursts[join.left].source}: ${bursts[join.left].title}`);
  console.log(`   B ${bursts[join.right].source}: ${bursts[join.right].title}`);
}

const multi = piles.filter((pile) => pile.length > 1);
console.log(`\n${multi.length} piles of more than one, holding ${multi.reduce((n, p) => n + p.length, 0)} stories`);
for (const pile of multi) {
  console.log('');
  for (const at of pile) console.log(`   ${bursts[at].source.padEnd(18)} ${bursts[at].title}`);
}

/*
 * The same day with the bar on the floor, which is how the bar was chosen:
 * every pair the rules could possibly make, in score order, to be read and
 * judged one at a time. A threshold is only honest if you have looked at what
 * sits just under it.
 */
const { joins: all } = groupStories(bursts, { ...rules, minScore: 0.8 });
console.log('\nevery pair at minScore 0.8, in score order:');
for (const join of [...all].sort((a, b) => a.score - b.score)) {
  const mark = join.score >= CLUSTER_RULES.minScore ? 'kept   ' : 'dropped';
  console.log(`  ${mark} ${join.score.toFixed(2)}  [${join.shared.join(' ')}]`);
  console.log(`          ${bursts[join.left].source}: ${bursts[join.left].title.slice(0, 74)}`);
  console.log(`          ${bursts[join.right].source}: ${bursts[join.right].title.slice(0, 74)}`);
}
