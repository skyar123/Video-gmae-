/**
 * Searching for the studio instead of the game.
 *
 * Asked for directly: "I wanna search Dev names like Bethesda and all
 * their games pop up". Typing a publisher used to return nothing, because
 * only the game's own name was indexed, so the one fact every row in the
 * mirror carries about who made it was the one thing you could not look up.
 *
 * This runs against the real 9,222-row index rather than a fixture, because
 * the thing worth protecting is the ranking against a full corpus: whether
 * a title still beats a publisher, and whether a weak rule drags in a
 * studio nobody typed. Counts are asserted as floors and shapes, never as
 * exact numbers, so a rebuilt index does not fail the suite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchStore } from '../api/store.mjs';
import { indexText, parseQuery, scoreMatch } from '../api/search.mjs';

const search = (q) => searchStore({ q, page: 0 });

test('a publisher answers with its games', async () => {
  const bethesda = await search('bethesda');
  assert.ok(bethesda.total >= 5, `expected several Bethesda games, got ${bethesda.total}`);
  // Everything that came back is actually theirs.
  for (const game of bethesda.games) {
    assert.match(game.publisher ?? '', /bethesda/i, `${game.name} is not a Bethesda game`);
  }
});

test('the game named after its publisher still comes first', async () => {
  // Capcom publishes Capcom Arcade Stadium. Somebody typing "capcom" has
  // typed the exact opening of that title, and sorting the whole catalogue
  // of Capcom games together would put a better-reviewed unrelated one on
  // top of the game actually called that.
  const capcom = await search('capcom');
  assert.ok(capcom.total > 5, `expected Capcom's catalogue, got ${capcom.total}`);
  assert.match(capcom.games[0].name, /^Capcom/i, `first hit was ${capcom.games[0].name}`);
});

test('a title match always outranks a publisher match', async () => {
  // The bands are separated by a constant above the highest score a match
  // can score, so this holds however the two are individually ranked.
  const capcom = await search('capcom');
  const titles = [];
  const others = [];
  capcom.games.forEach((game, index) => {
    (/capcom/i.test(game.name) ? titles : others).push(index);
  });
  if (titles.length > 0 && others.length > 0) {
    assert.ok(
      Math.max(...titles) < Math.min(...others),
      'a publisher match was sorted above a title match',
    );
  }
});

test('a publisher nobody typed is not dragged in', async () => {
  for (const nonsense of ['zzzznotagame', 'qqqq', 'xyzzyx']) {
    const found = await search(nonsense);
    assert.equal(found.total, 0, `"${nonsense}" matched ${found.total} games`);
  }
});

test('a short query does not match a studio on its initials', async () => {
  /*
   * The squashed and initials rules exist for game names people shorten:
   * "tlou", "ff7". Against 1,773 company names they are noise, and the
   * damage is not small. Measured against this index with the floor
   * removed: "rg" pulled in 380 games from Ratalaika Games and friends,
   * "hc" 382 from HAMSTER Corporation, and "ff" (which is how people
   * write Final Fantasy) picked up Future Friends Games and FRIENDLY FIRE
   * STUDIOS.
   *
   * Asserted by reason rather than by count, so a rebuilt index cannot
   * quietly turn this green: every row that comes back has to be here
   * because its name matched or because its publisher matched properly,
   * never because somebody's initials lined up.
   */
  for (const short of ['ff', 'rg', 'hc', 'ea', 'sie']) {
    const query = parseQuery(short);
    const found = await search(short);
    for (const game of found.games) {
      const byName = scoreMatch(indexText(game.name), query);
      const byPublisher = scoreMatch(indexText(game.publisher ?? ''), query);
      assert.ok(
        byName > 0 || byPublisher >= 300,
        `"${short}" returned ${game.name} on initials alone (${game.publisher})`,
      );
    }
  }
});

test('a publisher search does not swallow a real title search', async () => {
  // "hela" is the query that started all this. It must still match nothing,
  // or the fallback that looks for the game on PC never runs.
  const hela = await search('hela');
  assert.equal(hela.total, 0, `"hela" matched ${hela.total} games`);
});

test('the search index does not go over the wire', async () => {
  // Two folded indexes per row is most of the response if they ship. `by`
  // was added next to `search`, and only `search` was being stripped.
  const found = await search('bethesda');
  for (const game of found.games) {
    assert.equal(game.search, undefined, `${game.name} shipped its title index`);
    assert.equal(game.by, undefined, `${game.name} shipped its publisher index`);
  }
});

test('an empty query still lists the catalogue', async () => {
  // The publisher branch runs inside `if (query.folded)`, so an empty
  // search must fall through to the ordinary sort rather than score zero
  // against every row.
  const everything = await search('');
  assert.ok(everything.total > 1000, `an empty search returned ${everything.total}`);
});

test('a developer is searchable the same way a publisher is', async () => {
  /*
   * The gap this closes: PlayStation names a publisher and never a
   * developer, so every Sony first-party game answered to Sony Interactive
   * Entertainment and "Naughty Dog" found nothing at all.
   *
   * Asserted against whatever the baked set actually holds rather than
   * against a studio by name, so rebuilding it from Wikidata cannot fail
   * the suite. What must hold is the rule: if a row has a developer, that
   * developer's name finds it.
   */
  const withDeveloper = await searchStore({ q: '', page: 0 });
  const sample = (withDeveloper.games ?? []).find((game) => game.developer);
  if (!sample) return; // Nothing baked yet; nothing to prove.

  const found = await search(sample.developer);
  assert.ok(
    found.games.some((game) => game.id === sample.id),
    `"${sample.developer}" did not find ${sample.name}, which it made`,
  );
});

test('the developer index does not go over the wire either', async () => {
  // Three folded indexes a row is most of the response. The plain
  // `developer` string does go out: the studio button is built from it.
  const found = await searchStore({ q: '', page: 0 });
  for (const game of found.games) {
    assert.equal(game.dev, undefined, `${game.name} shipped its developer index`);
  }
});
