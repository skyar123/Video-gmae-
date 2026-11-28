/**
 * What the enrichment is actually for.
 *
 * Measured before any of it was built: eleven of the thirty kinds of game
 * this app can be asked for reach the store mirror not at all. Cozy searches
 * 113 games out of 9,728. Pixel art searches 57. The mirror has a name, a
 * coarse genre and nothing else, so there is nothing for those questions to
 * match against.
 *
 * These tests are about two things. That a label from IGDB lets one of those
 * questions reach a store row at all, which is the whole point; and that
 * nothing changes while there is no enrichment, which is the state the app
 * is in right now and will stay in until somebody runs the bake.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONCEPTS, conceptFor, matchesConcept } from '../api/concepts.mjs';

/** A store row as api/store.mjs builds one: a name, coarse genres, no more. */
const storeRow = (extra = {}) => ({
  id: 101,
  name: 'Some Store Game',
  genres: ['Action'],
  ageRating: { tier: 'teen', family: 'mild' },
  ...extra,
});

test('without enrichment, a store row answers exactly as it did before', () => {
  /*
   * The state the app ships in. An absent bake must leave every row and
   * every search precisely as they were, or this becomes a change nobody
   * asked for rather than one that waits for its data.
   */
  const bare = storeRow();
  for (const asked of ['pixel art', 'cozy', 'metroidvania', 'hand drawn', 'deckbuilder']) {
    assert.equal(matchesConcept(bare, conceptFor(asked)), false, `"${asked}" matched a bare row`);
  }
  /*
   * And the coarse genre it does carry still works, which is all it ever
   * had. An earlier version of this used "action", which is not a concept
   * at all, so the control was asserting against nothing.
   */
  const horror = storeRow({ genres: ['Horror'] });
  assert.equal(matchesConcept(horror, conceptFor('horror')), true);
});

test('a label lets a question reach the mirror for the first time', () => {
  const enriched = storeRow({ igdbLabels: ['platform', 'pixel art', 'difficult'] });
  assert.equal(matchesConcept(enriched, conceptFor('pixel art')), true);
  // Still not cozy. One label is not a licence to match everything.
  assert.equal(matchesConcept(enriched, conceptFor('cozy')), false);

  const metro = storeRow({ igdbLabels: ['metroidvania'] });
  assert.equal(matchesConcept(metro, conceptFor('metroidvania')), true);
});

test('labels are matched whole, never as fragments', () => {
  /*
   * The failure this whole join is built to avoid. A substring rule would
   * read "cardiology" as a card game and "retrospective" as retro, across
   * thousands of games at once and with complete confidence.
   */
  const near = storeRow({ igdbLabels: ['cardiology', 'retrospective', 'horrorscope'] });
  assert.equal(matchesConcept(near, conceptFor('card games')), false);
  assert.equal(matchesConcept(near, conceptFor('pixel art')), false);
  assert.equal(matchesConcept(near, conceptFor('horror')), false);
});

test('an age floor still outranks any label', () => {
  /*
   * Toddler is Family and Educational narrowed by what a very young child
   * can be handed. A label must not be a way around that: a game labelled
   * "kids" and rated Mature is not a toddler game.
   */
  const wrong = storeRow({
    igdbLabels: ['kids', 'educational'],
    ageRating: { tier: 'mature', family: 'mature' },
  });
  assert.equal(matchesConcept(wrong, conceptFor('toddler games')), false);

  const right = storeRow({
    igdbLabels: ['kids'],
    genres: ['Family'],
    ageRating: { tier: 'everyone', family: 'safe' },
  });
  assert.equal(matchesConcept(right, conceptFor('toddler games')), true);
});

test('rubbish in the labels is ignored rather than trusted', () => {
  for (const labels of [null, 'not-an-array', [], [null], [{}]]) {
    const row = storeRow({ igdbLabels: labels });
    assert.doesNotThrow(() => matchesConcept(row, conceptFor('cozy')));
    assert.equal(matchesConcept(row, conceptFor('cozy')), false);
  }
});

test('every IGDB vocabulary is lowercase, because the labels are folded', () => {
  /*
   * api/store.mjs lowercases each label once when it attaches them, so a
   * capitalised entry in a concept could never match anything and would
   * fail silently. Exactly the class of mistake that had pixel art
   * reporting as empty while working.
   */
  for (const concept of CONCEPTS) {
    for (const label of concept.igdb ?? []) {
      assert.equal(label, label.toLowerCase(), `${concept.id} has "${label}", which can never match`);
    }
  }
});

test('the labels file that ships is either empty or sane', async () => {
  /*
   * The one failure nothing else here would catch.
   *
   * Every test above uses hand-made rows, so a bake that went wrong and
   * labelled nine thousand games "cozy" would pass all of them and ship. It
   * would also be nearly invisible in use: a cozy shelf with everything on
   * it looks like a working feature until you read it.
   *
   * So the file itself is checked. Empty is the normal state and always
   * fine. Once a bake has run, no single label may cover most of what was
   * described, because no real label does: the commonest IGDB genres sit
   * well under a third, and anything above that means the join, not the
   * catalogue.
   */
  const { default: labels } = await import('../api/igdb-labels.json', {
    with: { type: 'json' },
  });
  const entries = Object.values(labels).filter(Boolean);
  if (entries.length === 0) return;

  const seen = new Map();
  for (const entry of entries) {
    for (const label of [...(entry.genres ?? []), ...(entry.themes ?? []), ...(entry.keywords ?? [])]) {
      const key = String(label).toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const [commonest, count] = [...seen.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['none', 0];
  const share = count / entries.length;
  assert.ok(
    share <= 0.6,
    `"${commonest}" is on ${Math.round(share * 100)}% of described games, which is the join misfiring rather than a real label`,
  );

  // And every described game kept its id, or the file cannot be joined back.
  for (const [id, entry] of Object.entries(labels)) {
    if (!entry) continue;
    assert.ok(/^\d+$/.test(id), `"${id}" is not a store id`);
    assert.ok(Array.isArray(entry.genres), `${id} has no genre list`);
  }
});
