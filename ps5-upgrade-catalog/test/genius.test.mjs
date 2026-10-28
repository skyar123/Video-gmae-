import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  featuresOf,
  buildTaste,
  scoreGame,
  diversify,
  geniusPicks,
  qualityPrior,
  unify,
  normalizeTitle,
  SHARED_NAMESPACES,
  SIGNAL_WEIGHTS,
  packTaste,
  unpackTaste,
} from '../src/genius.js';
import { evictStoreRows } from '../src/store-cache.js';

const written = (over = {}) => ({
  id: 'a',
  title: 'A',
  genre: 'Narrative',
  artStyle: 'Pixel Art',
  protagonist: 'Female',
  tags: ['cozy'],
  ageRating: { family: 'mild', tier: 'everyone10' },
  ...over,
});

const fromStore = (over = {}) => ({
  id: 1,
  name: 'S',
  genres: ['Adventure'],
  release: '2021-04-01T00:00:00Z',
  stars: 4,
  votes: 900,
  ageRating: { family: 'mild', tier: 'everyone10', interactive: [] },
  plus: { included: false, tier: null },
  ...over,
});

test('a field with nothing in it contributes no feature', () => {
  const sparse = featuresOf({ id: 'x', genre: null, artStyle: '', tags: [], protagonist: undefined });
  assert.equal(sparse.size, 0);
  // Were empties kept, "art:null" would be the feature thousands of games in
  // the mirror share, making "we do not know" the loudest signal there is.
  assert.ok(![...sparse].some((feature) => /null|undefined|:$/.test(feature)));
});

test('the two halves are described in separate namespaces', () => {
  const curatedGenre = [...featuresOf(written())].find((f) => f.startsWith('genre:'));
  const storeGenre = [...featuresOf(fromStore())].find((f) => f.startsWith('sgenre:'));
  assert.equal(curatedGenre, 'genre:Narrative');
  assert.equal(storeGenre, 'sgenre:Adventure');
  // Adventure must not be confused with the hand-written vocabulary: only 3
  // of its 16 terms exist in the store's at all.
  assert.ok(!featuresOf(fromStore()).has('genre:Adventure'));
});

test('publisher, price and content descriptors are not scored', () => {
  const features = featuresOf(
    fromStore({
      publisher: 'Some Studio',
      price: '$19.99',
      ageRating: { family: 'mild', tier: 'teen', descriptors: ['Blood', 'Language'] },
    }),
  );
  // Measured as noise against popularity-matched distractors; see genius.js.
  for (const feature of features) {
    assert.ok(!feature.startsWith('from:'), `publisher leaked: ${feature}`);
    assert.ok(!feature.startsWith('price:'), `price leaked: ${feature}`);
    assert.ok(!feature.startsWith('content:'), `descriptor leaked: ${feature}`);
  }
  assert.ok(features.has('tier:teen'), 'the low-cardinality rating is kept');
});

test('a namespace filter keeps a measurement from reading write-up-only fields', () => {
  const shared = featuresOf(written(), SHARED_NAMESPACES);
  assert.ok(!shared.has('genre:Narrative'));
  assert.ok(!shared.has('art:Pixel Art'));
  assert.ok(shared.has('family:mild'));
});

test('dislikes push a feature negative', () => {
  const liked = buildTaste([{ game: written(), kind: 'owned' }]);
  const disliked = buildTaste([{ game: written(), kind: 'disliked' }]);
  assert.ok(liked.weights.get('tag:cozy') > 0);
  assert.ok(disliked.weights.get('tag:cozy') < 0);
});

test('hiding counts against a game but less than saying so outright', () => {
  assert.ok(SIGNAL_WEIGHTS.hidden < 0);
  assert.ok(Math.abs(SIGNAL_WEIGHTS.hidden) < Math.abs(SIGNAL_WEIGHTS.disliked));
});

test('one liked game does not become a law', () => {
  const once = buildTaste([{ game: written({ id: 'a' }), kind: 'owned' }]);
  const often = buildTaste(
    Array.from({ length: 8 }, (_, i) => ({ game: written({ id: `g${i}` }), kind: 'owned' })),
  );
  assert.ok(often.weights.get('tag:cozy') > once.weights.get('tag:cozy'));
  assert.ok(once.weights.get('tag:cozy') < 1, 'a single signal stays short of certainty');
});

test('evidence both ways cancels out', () => {
  const split = buildTaste([
    { game: written({ id: 'a' }), kind: 'liked' },
    { game: written({ id: 'b' }), kind: 'disliked' },
  ]);
  assert.ok(Math.abs(split.weights.get('tag:cozy')) < 0.01);
});

test('saying so outranks owning, which outranks wanting', () => {
  // A shelf records what was bought, not what was enjoyed.
  assert.ok(SIGNAL_WEIGHTS.liked > SIGNAL_WEIGHTS.owned);
  assert.ok(SIGNAL_WEIGHTS.owned > SIGNAL_WEIGHTS.wishlisted);
});

test('a profile survives the trip to the server and back', () => {
  const taste = buildTaste([
    { game: written(), kind: 'liked' },
    { game: fromStore(), kind: 'disliked' },
  ]);
  const { weights } = unpackTaste(JSON.parse(JSON.stringify(packTaste(taste))));
  assert.ok(weights.get('tag:cozy') > 0);
  assert.ok(weights.get('sgenre:Adventure') < 0);
  assert.equal(scoreGame(written({ id: 'other' }), { weights, only: null }).hits.length > 0, true);
});

test('a profile that is not one unpacks to an empty profile', () => {
  for (const junk of [null, undefined, 'nope', 42, { weights: 'no' }, { weights: { a: 'x' } }]) {
    const taste = unpackTaste(junk);
    assert.equal(taste.weights.size, 0);
    assert.equal(scoreGame(written(), taste).hits.length, 0);
  }
});

test('a detailed entry does not outrank a good game the mirror says little about', () => {
  // The bug this pins: scoring by sum meant a write-up carried five fields no
  // game in the mirror has, so every write-up outranked the entire mirror
  // regardless of fit, and picks from the store were impossible.
  const taste = buildTaste([
    { game: written({ id: 'seed' }), kind: 'owned' },
    { game: fromStore({ id: 99, genres: ['Adventure'] }), kind: 'owned' },
  ]);
  const detailed = scoreGame(written({ id: 'other', tags: ['social'], genre: 'Sports' }), taste);
  const plain = scoreGame(fromStore({ id: 2, genres: ['Adventure'] }), taste);
  assert.ok(
    plain.score > detailed.score,
    `matching store game ${plain.score} should beat mismatched write-up ${detailed.score}`,
  );
});

test('five stars from four people is not five stars', () => {
  const confident = qualityPrior(fromStore({ stars: 5, votes: 5000 }));
  const thin = qualityPrior(fromStore({ stars: 5, votes: 4 }));
  assert.ok(confident > thin);
  assert.ok(thin < 0.6);
});

test('both halves score quality on one scale', () => {
  const store = qualityPrior(fromStore({ stars: 5, votes: 10000 }));
  const write = qualityPrior(
    written({ ratings: { critic: 95, user: { percentPositive: 96, total: 50000 } } }),
  );
  assert.ok(Math.abs(store - write) < 0.2, `${store} vs ${write} should be comparable`);
  assert.ok(qualityPrior(written({})) > 0 && qualityPrior(written({})) < 1);
});

test('diversity breaks up a run of near-identical games', () => {
  const clones = Array.from({ length: 6 }, (_, i) => ({
    game: written({ id: `clone${i}` }),
    score: 1 - i * 0.001,
  }));
  const odd = { game: written({ id: 'odd', genre: 'Racing', tags: ['social'], artStyle: '3D' }), score: 0.9 };
  const picked = diversify([...clones, odd], 3);
  assert.ok(picked.some((entry) => entry.game.id === 'odd'), 'the different one must surface');
  assert.equal(picked.length, 3);
});

test('no signals means no picks rather than a guess', () => {
  const { picks } = geniusPicks([written(), fromStore()], []);
  assert.deepEqual(picks, []);
  const onlyNegative = geniusPicks([written(), fromStore()], [
    { game: written({ id: 'z' }), kind: 'disliked' },
  ]);
  assert.deepEqual(onlyNegative.picks, []);
});

test('picks never include a game already ruled out', () => {
  const pool = [written({ id: 'keep' }), written({ id: 'drop' }), fromStore({ id: 7 })];
  const { picks } = geniusPicks(pool, [{ game: written({ id: 'seed' }), kind: 'owned' }], {
    exclude: new Set(['drop']),
    limit: 10,
  });
  assert.ok(!picks.some((pick) => pick.game.id === 'drop'));
});

test('a pick can say why it was picked', () => {
  const taste = buildTaste([{ game: written(), kind: 'owned' }]);
  const { hits } = scoreGame(written({ id: 'other' }), taste);
  assert.ok(hits.length > 0);
  assert.ok(hits[0].weight >= hits[hits.length - 1].weight, 'strongest reason first');
});

test('the join folds the mirror into the write-ups without duplicating a game', () => {
  const games = unify(
    [written({ title: "Marvel's Spider-Man" })],
    [fromStore({ id: 5, name: 'Marvel s Spider Man', genres: ['Action'], publisher: 'SIE' })],
  );
  assert.equal(games.length, 1, 'one game is one entry');
  const [game] = games;
  assert.equal(game.genre, 'Narrative', 'the write-up is kept');
  assert.deepEqual(game.genres, ['Action'], 'and gains the store fields');
  assert.equal(game.storeId, 5);
  // This is what makes picks from the mirror possible: a liked write-up now
  // teaches store-side features too.
  assert.ok(featuresOf(game).has('sgenre:Action'));
});

test('a write-up the mirror has no page for survives the join unchanged', () => {
  const games = unify([written({ title: 'Outer Wilds' })], [fromStore({ name: 'Something Else' })]);
  assert.equal(games.length, 2);
  assert.ok(games.some((game) => game.title === 'Outer Wilds' && game.storeId == null));
});

test('the hand-written rating wins over the store copy', () => {
  const [game] = unify(
    [written({ title: 'X', ageRating: { family: 'mild', tier: 'teen', notes: 'checked by hand' } })],
    [fromStore({ name: 'X', ageRating: { family: 'safe', tier: 'everyone' } })],
  );
  assert.equal(game.ageRating.notes, 'checked by hand');
});

test('titles match across punctuation', () => {
  assert.equal(normalizeTitle("Marvel's Spider-Man"), normalizeTitle('Marvel s Spider Man'));
  assert.notEqual(normalizeTitle('Gris'), normalizeTitle('Grid'));
});

test('a game you have already rated is never suggested back', () => {
  // Left to the caller, this went wrong the moment picks changed hands: owned
  // and wanted games stopped being excluded and were recommended to the
  // people who owned them, sitting at the bottom of the list where the
  // diversity pass had pushed them rather than anywhere anyone would look.
  const pool = [written({ id: 'owned' }), written({ id: 'liked' }), written({ id: 'fresh' })];
  const { picks } = geniusPicks(
    pool,
    [
      { game: written({ id: 'owned' }), kind: 'owned' },
      { game: written({ id: 'liked' }), kind: 'liked' },
    ],
    { limit: 10 },
  );
  const ids = picks.map((pick) => pick.game.id);
  assert.deepEqual(ids, ['fresh'], `suggested back: ${ids.filter((id) => id !== 'fresh')}`);
});

test('it does not need to be told twice', () => {
  // The caller may also pass its own exclusions; both must apply.
  const pool = [written({ id: 'a' }), written({ id: 'b' }), written({ id: 'c' })];
  const { picks } = geniusPicks(pool, [{ game: written({ id: 'a' }), kind: 'liked' }], {
    exclude: new Set(['b']),
    limit: 10,
  });
  assert.deepEqual(picks.map((pick) => pick.game.id), ['c']);
});

test('variety is allowed to outrank a slightly better score', () => {
  // The guarantee diversify actually makes, pinned so that a test asserting
  // plain descending order cannot creep back in: the first pick is the
  // strongest, and after that resemblance is allowed to cost a game its place.
  const clones = Array.from({ length: 5 }, (_, i) => ({
    game: written({ id: `clone${i}` }),
    score: 1 - i * 0.001,
  }));
  const different = {
    game: written({ id: 'different', genre: 'Racing', artStyle: '3D', tags: ['social'] }),
    score: 0.99,
  };
  const picked = diversify([...clones, different], 3);
  assert.equal(picked[0].game.id, 'clone0', 'nothing is penalised before anything is picked');
  const order = picked.map((entry) => entry.score);
  assert.ok(
    order.some((score, i) => i > 0 && score > order[i - 1]),
    `variety never overtook score: ${order}`,
  );
});

test('dislikes still count when nothing has been liked yet', () => {
  // Scaling the noes against the yeses zeroed them outright when there were
  // no yeses, throwing away the only thing the reader had actually said.
  const taste = buildTaste([
    { game: written({ id: 'a' }), kind: 'disliked' },
    { game: written({ id: 'b' }), kind: 'disliked' },
  ]);
  assert.ok(taste.weights.get('tag:cozy') < 0);
});

test('a pile of noes cannot drown a handful of yeses', () => {
  // Thumbing down is cheap and writing a game up is not, so without a limit
  // the profile stops describing a person and starts describing the store:
  // most games are not for you, which is true of everybody and ranks nothing.
  const likes = Array.from({ length: 3 }, (_, i) => ({
    game: written({ id: `like${i}` }),
    kind: 'liked',
  }));
  const manyNoes = Array.from({ length: 60 }, (_, i) => ({
    game: written({ id: `no${i}`, genre: 'Racing', tags: ['social'], artStyle: '3D' }),
    kind: 'disliked',
  }));
  const taste = buildTaste([...likes, ...manyNoes]);
  assert.ok(taste.weights.get('tag:cozy') > 0, 'what was liked is still liked');
  assert.ok(taste.weights.get('tag:social') < 0, 'and what was not is still not');
  // Sixty noes against three yeses must not end up sixty times as loud.
  assert.ok(
    Math.abs(taste.weights.get('tag:social')) < 4 * taste.weights.get('tag:cozy'),
    `social ${taste.weights.get('tag:social')} vs cozy ${taste.weights.get('tag:cozy')}`,
  );
});

test('a withdrawn answer counts as a change, not as one answer fewer', () => {
  // The count behind "work the list out again". Measured as a length it goes
  // the wrong way when a thumb is taken back, and does not move at all when a
  // yes is swapped for a no, so the list would sit stale with nothing offered.
  const countChanges = (before, after) => {
    const was = new Map(before.map((row) => [row.game.id, row.kind]));
    const now = new Set();
    let changed = 0;
    for (const row of after) {
      now.add(row.game.id);
      if (was.get(row.game.id) !== row.kind) changed += 1;
    }
    for (const id of was.keys()) if (!now.has(id)) changed += 1;
    return changed;
  };
  const a = { game: written({ id: 'a' }), kind: 'liked' };
  const b = { game: written({ id: 'b' }), kind: 'liked' };
  assert.equal(countChanges([a, b], [a]), 1, 'taking one back is one change');
  assert.equal(
    countChanges([a, b], [a, { game: written({ id: 'b' }), kind: 'disliked' }]),
    1,
    'changing your mind is one change',
  );
  assert.equal(countChanges([a, b], [a, b]), 0, 'nothing changed is nothing to apply');
});

test('a cached row that is spoken for is not the one evicted', () => {
  // The real rule, imported rather than restated: a copy of it in here could
  // pass while the app did something else entirely. The cache turns a stored
  // id back into a game, so evicting a rated game's row leaves an opinion
  // about something the catalog can no longer describe, and the signal stops
  // counting with nothing to show for it.
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: i }));

  const kept = evictStoreRows(rows, new Set(['store:0', 'store:1']), 5);
  assert.equal(kept.length, 5);
  assert.ok(kept.some((row) => row.id === 0), 'the rated row survives');
  assert.ok(kept.some((row) => row.id === 1), 'and so does the other');
  assert.ok(!kept.some((row) => row.id === 2), 'an unspoken-for row goes instead');

  // Everything spoken for: over the cap beats losing an answer.
  assert.equal(evictStoreRows(rows, new Set(rows.map((r) => `store:${r.id}`)), 5).length, 7);
  // Under the cap nothing is touched, and the order is left alone.
  assert.deepEqual(evictStoreRows(rows, new Set(), 20), rows);
  assert.deepEqual(
    evictStoreRows(rows, new Set(), 5).map((r) => r.id),
    [2, 3, 4, 5, 6],
    'the oldest unspoken-for rows are the ones that go',
  );
});
