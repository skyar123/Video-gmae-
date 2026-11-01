/**
 * The order the Top view puts the feed in.
 *
 * Two problems, and they pull against each other. Only a Bluesky post
 * carries an engagement number, so ranking the merged feed on that alone put
 * all forty-nine posts above the first headline: sixteen screens of
 * scrolling to reach the news, in a feed whose whole point is that the news
 * is in it. And within the press, where every row scores zero, the order
 * fell back to recency, which is not importance at all.
 */

/**
 * What an extra outlet is worth, in freshness.
 *
 * A headline has no engagement count, so until stories were grouped there
 * was nothing to rank the press on but the clock, and the clock is a poor
 * judge: on the day this was written the top of the press column was two
 * Fortnite item guides, a Witcher 3 choice walkthrough and a Shrek 2
 * rumour, while the day's actual story, EA shutting down BioWare, sat
 * eleven rows down because it had been filed three hours earlier. How many
 * outlets ran something is the first real measure of importance this feed
 * has ever had for a headline.
 *
 * It is spent as freshness rather than as an override, so a big story leads
 * the morning and then decays like everything else instead of sitting on top
 * of the feed all week. Measured on a real day at one, three, six and twelve
 * hours: at one the three-outlet story still could not reach the top ten; at
 * twelve it displaced five stories including a Nintendo piece from another
 * shelf. Three and six behaved identically, pushing out exactly two stories,
 * both of them item guides, so the lower of the two is used and the choice
 * is not sitting on a knife edge.
 */
export const OUTLET_HOURS = 3;

const at = (burst) => new Date(burst.publishedAt ?? 0).getTime();

/**
 * When a story counts as having happened, for ranking.
 *
 * Only the press is boosted. A pile is a fact about outlets publishing the
 * same report, and the other channels are not outlets: a podcast episode and
 * a person's post are not a second newspaper running the story.
 */
export const rankedAt = (burst) =>
  burst.channel === 'press' && burst.coverage > 1
    ? at(burst) + (burst.coverage - 1) * OUTLET_HOURS * 3600000
    : at(burst);

/**
 * Each channel is ranked within itself on whatever it actually has, and the
 * merged order takes the top of each, then the second of each, and so on.
 * The loudest post and the biggest story of the day arrive together instead
 * of one sitting on top of the other. Recency breaks ties, which is also
 * what sorts the channels that have no other measure.
 */
export function rankAcrossChannels(rows) {
  const newest = (a, b) => rankedAt(b) - rankedAt(a);
  const lanes = new Map();
  for (const burst of rows) {
    const lane = burst.channel ?? 'other';
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(burst);
  }
  const ranked = [];
  for (const lane of lanes.values()) {
    lane
      .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0) || newest(a, b))
      .forEach((burst, place) => ranked.push({ burst, place }));
  }
  return ranked
    .sort((a, b) => a.place - b.place || newest(a.burst, b.burst))
    .map(({ burst }) => burst);
}
