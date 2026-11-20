/**
 * Folds the stories the server grouped into one card each, in the view.
 *
 * api/story-clusters.mjs decides which headlines are the same event and
 * stamps each with a `story`. The fold happens here, after the panel's
 * filters have run, because that is the only place it can happen without
 * taking stories off shelves the reader narrowed to: see the long note on
 * tagStories.
 *
 * The face of a card is simply the first member of the list as it arrives.
 * The list is already in the order the reader asked for, so under Latest the
 * card wears the newest version of the story and under Top the loudest, and
 * the card sits exactly where its best member would have sat. Nothing is
 * re-sorted here and no second idea of "best" is invented.
 */
export function foldStories(bursts) {
  const cards = [];
  const at = new Map();

  for (const burst of bursts) {
    const key = burst.story;
    if (!key) {
      cards.push(burst);
      continue;
    }
    const held = at.get(key);
    if (held === undefined) {
      at.set(key, cards.length);
      cards.push({ ...burst, also: [] });
      continue;
    }
    cards[held].also.push({
      source: burst.source,
      title: burst.title,
      link: burst.link,
      publishedAt: burst.publishedAt,
    });
  }

  // A card with an empty `also` is a story whose pile-mates were all filtered
  // out, and it should read as the ordinary story it now is.
  return cards.map((card) => (card.also?.length === 0 ? { ...card, also: undefined } : card));
}
