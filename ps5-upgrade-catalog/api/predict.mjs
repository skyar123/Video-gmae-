/**
 * Price-drop prediction.
 *
 * This is a transparent heuristic, not a model trained on anything. It scores
 * the chance of a better price in the next 30 days from what we can actually
 * observe — how old the game is, whether it is discounted right now, when the
 * PlayStation Store says the current sale ends, how close the next recurring
 * sale window is, and what our own recorded price history says — and it reports which of those drove the answer so the number
 * is always auditable. Confidence rises as the history store fills in.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Approximate recurring storefront sale windows, as month/day ranges. These
 * are historical patterns, not announced dates, and the UI says so.
 */
const SALE_WINDOWS = [
  { name: 'Spring sale', from: [3, 12], to: [3, 20] },
  { name: 'Days of Play', from: [6, 1], to: [6, 12] },
  { name: 'Summer sale', from: [6, 25], to: [7, 10] },
  { name: 'Autumn and Black Friday sales', from: [11, 24], to: [12, 2] },
  { name: 'Winter holiday sale', from: [12, 18], to: [1, 5] },
];

const HORIZON_DAYS = 30;

function daysBetween(later, earlier) {
  return Math.round((later.getTime() - earlier.getTime()) / DAY_MS);
}

/** The next sale window that starts on or after `now`, wrapping into next year. */
export function nextSaleWindow(now = new Date()) {
  let best = null;
  for (const window of SALE_WINDOWS) {
    for (const yearOffset of [0, 1]) {
      const [month, day] = window.from;
      const start = new Date(Date.UTC(now.getUTCFullYear() + yearOffset, month - 1, day));
      const startsInDays = daysBetween(start, now);
      if (startsInDays < 0) continue;
      if (!best || startsInDays < best.startsInDays) {
        best = { name: window.name, startsInDays, start: start.toISOString().slice(0, 10) };
      }
    }
  }
  return best;
}

/** Age in days, or null when the storefront gave us no usable release date. */
function ageInDays(releaseDate, now) {
  if (!releaseDate) return null;
  const parsed = new Date(releaseDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return daysBetween(now, parsed);
}

/**
 * @param live     resolved storefront data for one game
 * @param history  summary from the price history store, or null
 * @returns {{score:number, verdict:string, headline:string, reasons:string[],
 *            nextWindow:object|null, confidence:string}}
 */
export function predictPriceDrop(live, history = null, now = new Date()) {
  if (!live?.matched || !live.price || live.price.isFree) {
    return {
      score: null,
      verdict: 'unknown',
      headline: 'No price data',
      reasons: ['This game has no live price to track.'],
      nextWindow: null,
      confidence: 'none',
    };
  }

  const { price } = live;
  const onSale = price.discountPercent > 0;
  const age = ageInDays(live.releaseDate, now);
  const reasons = [];
  let score = 0;

  // 1. Age. Discounts are rare in the first months and deepen over years.
  if (age === null) {
    score += 30;
  } else if (age < 90) {
    score += 8;
    reasons.push('Released less than three months ago, when discounts are rare.');
  } else if (age < 365) {
    score += 25;
    reasons.push('In its first year, where first real discounts usually land.');
  } else if (age < 1095) {
    score += 38;
    reasons.push('A few years old, so it goes on sale regularly.');
  } else {
    score += 45;
    reasons.push('An older title that discounts often and deeply.');
  }

  // 2. Current state. A live discount is itself evidence the near-term floor
  //    is already here.
  if (onSale) {
    score -= 22;
    reasons.push(`Already discounted ${price.discountPercent}% right now.`);
  } else {
    score += 14;
    reasons.push('Currently at full price.');
  }

  // 2b. The store publishes when a sale ends, so that part is known rather
  //     than guessed. A sale about to expire is a reason to buy now.
  let saleEndsInDays = null;
  if (onSale && price.saleEndsAt) {
    const ends = new Date(price.saleEndsAt);
    if (!Number.isNaN(ends.getTime())) {
      saleEndsInDays = Math.max(0, daysBetween(ends, now));
      score -= saleEndsInDays <= 3 ? 20 : 10;
      reasons.push(
        saleEndsInDays <= 1
          ? 'This sale ends today on the PlayStation Store.'
          : `This sale ends in ${saleEndsInDays} days on the PlayStation Store.`,
      );
    }
  }

  // 3. Proximity to the next recurring sale window. Only worth weighing when
  //    the game is not already discounted with a known end date.
  const nextWindow = nextSaleWindow(now);
  if (nextWindow && saleEndsInDays === null) {
    if (nextWindow.startsInDays <= 7) {
      score += 28;
      reasons.push(`${nextWindow.name} usually starts within a week.`);
    } else if (nextWindow.startsInDays <= 21) {
      score += 18;
      reasons.push(`${nextWindow.name} usually starts in about ${nextWindow.startsInDays} days.`);
    } else if (nextWindow.startsInDays <= 45) {
      score += 8;
      reasons.push(`${nextWindow.name} is roughly ${nextWindow.startsInDays} days out.`);
    }
  }

  // 4. Our own recorded history, once there is enough of it to mean anything.
  //    On day one every price is trivially the lowest we have seen, so the
  //    record-low claim needs a couple of weeks of observation behind it.
  let atRecordLow = false;
  const historyIsMeaningful = (history?.observedDays ?? 0) >= 14;
  if (history?.lowest && typeof history.lowest.final === 'number') {
    const lowest = history.lowest.final;
    if (price.final <= lowest) {
      if (historyIsMeaningful) {
        atRecordLow = true;
        score -= 30;
        reasons.push(
          `Lowest price in the ${history.observedDays} days we have been tracking it.`,
        );
      }
    } else {
      const gapShare = (price.final - lowest) / Math.max(price.initial || price.final, 1);
      score += Math.min(26, Math.round(gapShare * 100 * 0.7));
      reasons.push(
        `We have seen it at ${history.lowest.formatted} (${history.lowest.date}), below today's price.`,
      );
    }
  }

  if (history?.meanDaysBetweenSales && history?.daysSinceLastSale !== null) {
    if (history.daysSinceLastSale > history.meanDaysBetweenSales) {
      score += 14;
      reasons.push(
        `It has been ${history.daysSinceLastSale} days since its last sale, longer than its typical ${history.meanDaysBetweenSales}-day gap.`,
      );
    }
  }

  score = Math.max(2, Math.min(95, Math.round(score)));

  const observedDays = history?.observedDays ?? 0;
  const confidence =
    observedDays >= 60 && (history?.saleCount ?? 0) > 0
      ? 'high'
      : observedDays >= 14
        ? 'medium'
        : 'low';

  let verdict;
  let headline;
  if (onSale && saleEndsInDays !== null && saleEndsInDays <= 3) {
    verdict = 'buy-now';
    headline = saleEndsInDays <= 1 ? 'Sale ends today' : `Sale ends in ${saleEndsInDays} days`;
  } else if (onSale && atRecordLow) {
    verdict = 'buy-now';
    headline = 'Lowest we have tracked';
  } else if (onSale && score < 45) {
    verdict = 'buy-now';
    headline = 'Good price now';
  } else if (age !== null && age < 90 && !onSale) {
    verdict = 'too-new';
    headline = 'Too new to discount';
  } else if (score >= 60) {
    verdict = 'wait';
    headline = 'Drop likely soon';
  } else {
    verdict = 'hold';
    headline = 'No rush either way';
  }

  return {
    score,
    verdict,
    headline,
    reasons,
    nextWindow: saleEndsInDays === null ? nextWindow : null,
    saleEndsInDays,
    confidence,
    horizonDays: HORIZON_DAYS,
  };
}
