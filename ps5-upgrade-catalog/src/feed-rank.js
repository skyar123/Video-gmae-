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

/**
 * How far back a walkthrough sits.
 *
 * Guides are published constantly, so they are always among the freshest
 * things in the feed, and on a real day the Top column opened with two
 * Fortnite item lists and a Witcher 3 choice walkthrough. A day is the
 * number because it says the right thing: a guide counts as yesterday's, so
 * it falls below today's news and stays above the week's. Nothing is hidden
 * by it. Latest, Everything and every shelf are untouched, and guides have a
 * chip of their own for the evening you are actually playing the game.
 */
export const GUIDE_HOURS = 24;

const at = (burst) => new Date(burst.publishedAt ?? 0).getTime();

/**
 * When a story counts as having happened, for ranking.
 *
 * Only the press is moved either way. A pile is a fact about outlets
 * publishing the same report, and the other channels are not outlets: a
 * podcast episode and a person's post are not a second newspaper running the
 * story. Nor is a video or a post a walkthrough in the sense that matters
 * here, which is a page an outlet files hourly for search traffic.
 */
export const rankedAt = (burst) => {
  if (burst.channel !== 'press') return at(burst);
  const lift = burst.coverage > 1 ? (burst.coverage - 1) * OUTLET_HOURS : 0;
  const drop = burst.guide ? GUIDE_HOURS : 0;
  return at(burst) + (lift - drop) * 3600000;
};

/**
 * How many days old costs a channel one place in the round-robin.
 *
 * The merge below gives every channel's best item the same shot at the top,
 * which is what stops the one channel that counts engagement from burying
 * the rest. It also assumes each channel's best is worth about the same, and
 * that is not true when a channel is having a quiet fortnight: the podcast
 * lane's freshest episode was eleven days old while the press lane's was
 * twenty minutes old, and the round-robin sat them four cards apart. The
 * feed read as stale because, in that lane, it was.
 *
 * So age costs places. A channel that has posted today keeps its turn; one
 * that last posted a week ago waits three rounds for it.
 */
export const STALE_DAYS = 2;

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
  const now = Date.now();
  const staleness = (burst) => {
    const age = (now - rankedAt(burst)) / 86400000;
    return age > 0 ? Math.floor(age / STALE_DAYS) : 0;
  };

  const ranked = [];
  for (const lane of lanes.values()) {
    lane
      .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0) || newest(a, b))
      .forEach((burst, place) => ranked.push({ burst, place: place + staleness(burst) }));
  }
  return ranked
    .sort((a, b) => a.place - b.place || newest(a.burst, b.burst))
    .map(({ burst }) => burst);
}
