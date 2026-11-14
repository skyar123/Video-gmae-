import { sweepForReleases } from '../../api/upcoming.mjs';

/**
 * The release calendar's nightly sweep, on its own schedule.
 *
 * This used to be the last thing in snapshot-prices, after a price reading
 * for every game in the catalog, a ratings refresh, the alert run, the
 * backtest and 300 Steam name searches. A function gets fifteen minutes; the
 * sweep never reliably got its turn, and the calendar served the snapshot
 * baked into the deploy for 46 days without anything reporting a problem.
 *
 * Its own function means its own fifteen minutes, and a failure here cannot
 * take the price snapshot with it or vice versa.
 */
export default async () => {
  const sweep = await sweepForReleases();
  console.log(
    `Swept concepts ${sweep.from}-${sweep.to}: ${sweep.discovered} upcoming found, ` +
      `${sweep.seeds} seeds tracked, ${sweep.calendar} on the calendar, ` +
      `${sweep.recent} just out, ${sweep.mirror} in the store mirror`,
  );
};

export const config = { schedule: '@daily' };
