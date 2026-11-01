/**
 * The Top order, and the one thing it must not become.
 *
 * Boosting a story because several outlets ran it is a boost to whatever the
 * biggest outlets agree on, and the shelves this feed exists to carry, the
 * queer and worker-owned press, the trade press, the small retro and indie
 * sites, never duplicate each other. So the tests here are mostly about the
 * ceiling: how far a pile can climb, and what it is not allowed to do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTLET_HOURS, rankAcrossChannels, rankedAt } from '../src/feed-rank.js';

const HOUR = 3600000;
const now = Date.parse('2026-11-01T12:00:00.000Z');
const story = (overrides) => ({
  channel: 'press',
  heat: 0,
  link: `https://example.test/${Math.random()}`,
  publishedAt: new Date(now).toISOString(),
  ...overrides,
});
const agoHours = (hours) => new Date(now - hours * HOUR).toISOString();
const order = (rows) => rankAcrossChannels(rows).map((row) => row.link);

test('a story several outlets ran counts as fresher than its clock', () => {
  const four = story({ publishedAt: agoHours(6), coverage: 4, link: 'big' });
  const alone = story({ publishedAt: agoHours(1), coverage: undefined, link: 'small' });
  assert.ok(rankedAt(four) > rankedAt(alone));
  assert.deepEqual(order([alone, four]), ['big', 'small']);
});

test('and it is freshness, not an override, so it runs out', () => {
  // Four outlets buys nine hours. A day later the story is behind anything
  // from this morning, which is what stops a big story sitting on top of the
  // feed all week.
  const yesterday = story({ publishedAt: agoHours(26), coverage: 4, link: 'yesterday' });
  const today = story({ publishedAt: agoHours(4), coverage: undefined, link: 'today' });
  assert.deepEqual(order([yesterday, today]), ['today', 'yesterday']);
  assert.equal((rankedAt(yesterday) - Date.parse(yesterday.publishedAt)) / HOUR, 3 * OUTLET_HOURS);
});

test('only the press is boosted', () => {
  /*
   * A pile is a fact about outlets publishing the same report. A podcast
   * episode and a person's post are not a second newspaper running it, and
   * a burst that somehow arrives with a coverage count on another channel
   * must not be lifted by it.
   */
  for (const channel of ['bluesky', 'pod', 'youtube']) {
    const row = story({ channel, publishedAt: agoHours(6), coverage: 5 });
    assert.equal(rankedAt(row), Date.parse(row.publishedAt), `${channel} was boosted`);
  }
});

test('the boost has a ceiling, and it is exactly this high', () => {
  /*
   * The cost of the boost falls on whatever it pushes down, and the shelves
   * worth protecting are the ones that never duplicate: the queer and
   * worker-owned press, the trade press, the small retro and indie sites.
   * So the ceiling is the number that matters, and it is stated here rather
   * than inferred: an extra outlet buys OUTLET_HOURS and nothing else, so a
   * pile of four rises by nine hours and not one minute more.
   *
   * Written the other way round first, and it failed, which was the test
   * doing its job: a four-outlet story ten hours old lands *exactly* level
   * with an hour-old one, so the assertion was being decided by a tie rather
   * than by the rule. The arithmetic is spelled out now.
   */
  const pile = story({ publishedAt: agoHours(10), coverage: 4, link: 'pile' });
  assert.equal((rankedAt(pile) - (now - 10 * HOUR)) / HOUR, 9);
  assert.equal(rankedAt(pile), now - 1 * HOUR, 'ten hours old, reading as one');

  /*
   * And this is what that costs, stated plainly rather than implied: a story
   * on a shelf that never duplicates has to be fresher than the pile's
   * boosted age, not fresher than the pile, to stay ahead of it. Half an
   * hour old clears a pile reading as one hour. Two hours old does not, and
   * writing this test the other way round is how I found out I had been
   * assuming otherwise.
   */
  const fresh = story({ publishedAt: agoHours(0.5), tone: 'queer', link: 'fresh-queer' });
  assert.deepEqual(order([pile, fresh]), ['fresh-queer', 'pile']);

  const older = story({ publishedAt: agoHours(2), tone: 'queer', link: 'older-queer' });
  assert.deepEqual(order([older, pile]), ['pile', 'older-queer']);
});

test('one channel still cannot bury the rest', () => {
  /*
   * The reason this function exists. Only Bluesky carries an engagement
   * count, so a single sort on it put all forty-nine posts above the first
   * headline. Each channel is ranked within itself and the merged order
   * takes the top of each in turn.
   */
  const posts = Array.from({ length: 8 }, (_, i) =>
    story({ channel: 'bluesky', heat: 5000 - i, link: `post-${i}` }),
  );
  const press = Array.from({ length: 3 }, (_, i) =>
    story({ channel: 'press', publishedAt: agoHours(i), link: `press-${i}` }),
  );
  const ranked = order([...posts, ...press]);
  assert.ok(
    ranked.indexOf('press-0') <= 1,
    `the freshest headline landed at ${ranked.indexOf('press-0')}`,
  );
});

test('nothing is dropped or duplicated by ranking', () => {
  const rows = [
    story({ channel: 'press', coverage: 3 }),
    story({ channel: 'bluesky', heat: 90 }),
    story({ channel: 'pod' }),
    story({ channel: undefined }),
    story({ channel: 'press', publishedAt: agoHours(40) }),
  ];
  const ranked = rankAcrossChannels(rows);
  assert.equal(ranked.length, rows.length);
  assert.equal(new Set(ranked.map((r) => r.link)).size, rows.length);
});
