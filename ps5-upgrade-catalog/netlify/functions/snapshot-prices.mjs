import catalog from '../../src/games.json' with { type: 'json' };
import { CHUNK_SIZE, REVIEW_KEY_PREFIX, mapWithConcurrency } from '../../api/steam.mjs';
import { loadPsnPrice } from '../../api/psn.mjs';
import { recordAndSummarize, saveBlob } from '../../api/history.mjs';
import { loadReviewSignal } from '../../api/reviews.mjs';
import { loadUpcoming, sweepForReleases } from '../../api/upcoming.mjs';
import { replayCalibration } from '../../api/backtest.mjs';
import { warmYouTubePool } from '../../api/goss.mjs';
import { fetchPlusConceptIds } from '../../api/plus.mjs';
import { PLUS_KEY } from '../../api/keys.mjs';
import { loadChunk } from '../../api/history.mjs';
import { BACKTEST_KEY } from '../../api/keys.mjs';
import { conceptPathFor, runAlerts, watchedConceptIds } from '../../api/alerts.mjs';
import { loadBlob } from '../../api/history.mjs';
import { STEAM_MATCH_KEY } from '../../api/keys.mjs';
import { resolveSteamAppId } from '../../api/steam-match.mjs';
import storeIndex from '../../api/store-index.json' with { type: 'json' };

/**
 * Nightly maintenance.
 *
 * Prices: visits record history too, but only for chunks somebody loaded.
 * This makes sure every game gets a daily PlayStation Store reading, which is
 * what the drop predictor learns from.
 *
 * Ratings: player scores and the pros and cons drawn from reviews ship baked
 * into the catalog. Refreshing them here keeps them current between deploys.
 *
 * Calendar: a slice of the store's concept IDs is swept each night, so newly
 * announced games reach the release calendar without a deploy.
 *
 * Alerts: the prices read above are exactly what a price-drop notification
 * needs, so subscriptions are checked here rather than in a second pass over
 * the store. Push goes to phones; email goes out too when it is configured.
 *
 * Scheduled functions only run on published deploys.
 */
/** One run's worth of name searches: about a minute of polite requests. */
const STEAM_MATCH_BATCH = 300;

export default async () => {
  const regions = (process.env.HISTORY_REGIONS || 'US')
    .split(',')
    .map((region) => region.trim().toUpperCase())
    .filter(Boolean);

  const chunkCount = Math.ceil(catalog.length / CHUNK_SIZE);
  // Alerts go out for the first region only: a subscriber has one currency.
  const pricesForAlerts = new Map();
  // The recorder already returns each game's summary, so the alert pass can say
  // whether a drop is actually the cheapest this record has seen without a
  // second read of anything.
  const historyForAlerts = new Map();

  for (const countryCode of regions) {
    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      const slice = catalog.slice(chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE);
      const prices = await mapWithConcurrency(slice, 3, (game) =>
        loadPsnPrice(game.psnStorePath, countryCode),
      );
      const games = slice.map((game, index) => ({
        id: game.id,
        title: game.title,
        matched: Boolean(prices[index]),
        price: prices[index] ?? null,
      }));
      const summaries = await recordAndSummarize(chunk, countryCode, games);
      if (countryCode === regions[0]) {
        for (const game of games) {
          pricesForAlerts.set(game.id, game.price);
          if (summaries?.[game.id]) historyForAlerts.set(game.id, summaries[game.id]);
        }
      }
    }
    console.log(`Recorded prices for ${catalog.length} games in ${countryCode}`);
  }

  // Ratings are region-independent, so they only need one pass.
  const asOf = new Date().toISOString().slice(0, 10);
  for (let chunk = 0; chunk < chunkCount; chunk += 1) {
    const slice = catalog.slice(chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE);
    const entries = {};
    for (const game of slice) {
      if (!game.steamAppId) continue;
      const signal = await loadReviewSignal(game.steamAppId);
      if (!signal) continue;
      entries[game.id] = {
        critic: game.ratings?.critic ?? null,
        user: signal.userScore,
        pros: signal.pros,
        cons: signal.cons,
        asOf,
      };
    }
    await saveBlob(`${REVIEW_KEY_PREFIX}${chunk}`, entries);
  }
  console.log('Refreshed review ratings');

  // Score the predictor against what actually happened. Cheap, and the only
  // thing that will ever say whether the heuristic is worth keeping.
  try {
    const histories = {};
    for (let chunk = 0; chunk < chunkCount; chunk += 1) {
      histories[`chunk-${chunk}`] = await loadChunk(chunk, regions[0] ?? 'US');
    }
    const calibration = replayCalibration(histories);
    await saveBlob(BACKTEST_KEY, calibration);
    console.log(
      calibration.ready
        ? `Predictor scored: ${calibration.samples} moments, Brier ${calibration.brier} vs ${calibration.baseRateBrier} for the base rate`
        : `Predictor not scoreable yet: ${calibration.samples} moments so far`,
    );
  } catch (error) {
    console.error('Backtest failed:', error);
  }

  // A store game is watched by id like any other, but it is not in the
  // catalog walk above, so its price is read from the concept page the same
  // way the store view reads one. Only ids with a reachable subscriber behind
  // them, and capped, so a few hundred wishlists cannot become tens of
  // thousands of reads. There is no recorded history for these, so an alert
  // for one says what it costs without claiming to know it is the floor.
  try {
    const concepts = await watchedConceptIds();
    if (concepts.length > 0) {
      const conceptPrices = await mapWithConcurrency(concepts, 3, (id) =>
        loadPsnPrice(conceptPathFor(id), regions[0] ?? 'US'),
      );
      concepts.forEach((id, index) => pricesForAlerts.set(id, conceptPrices[index] ?? null));
      console.log(`Read prices for ${concepts.length} watched store games`);
    }
  } catch (error) {
    console.error('Watched store prices failed:', error);
  }

  try {
    const alerts = await runAlerts(pricesForAlerts, Date.now(), historyForAlerts);
    console.log(
      alerts.skipped
        ? `Price alerts skipped: ${alerts.skipped}`
        : `Price alerts: ${alerts.notified} sent covering ${alerts.drops} drops, ${alerts.subscribers} subscribed`,
    );
  } catch (error) {
    console.error('Price alerts failed:', error);
  }

  // Tie mirror games to their Steam listings, a slice at a time.
  //
  // This is what lets a store game carry review scores and the pros and cons
  // drawn from them, which was the last thing it lacked against a curated
  // one. Matching is one search per game, so the whole mirror cannot be done
  // in one run; a few hundred a night works through it over a couple of
  // weeks and then only new arrivals remain. Games with no Steam listing are
  // recorded as a miss so they are not asked about again every night.
  try {
    const stored = (await loadBlob(STEAM_MATCH_KEY)) ?? { byId: {}, missing: [] };
    const byId = stored.byId ?? {};
    const missing = new Set(stored.missing ?? []);
    // The calendar first: those are the games somebody is waiting on, and
    // there are only a few hundred of them, so they are matched within a
    // night or two rather than whenever the mirror walk reaches them.
    const calendar = await loadUpcoming();
    const candidates = [
      ...[...(calendar.games ?? []), ...(calendar.recent ?? [])].map((row) => ({
        id: row.id,
        name: row.title,
      })),
      ...storeIndex.map((row) => ({ id: row.id, name: row.name })),
    ];

    const queued = new Set();
    const todo = [];
    for (const row of candidates) {
      if (todo.length >= STEAM_MATCH_BATCH) break;
      if (!row.name || queued.has(row.id)) continue;
      if (byId[row.id] != null || missing.has(row.id)) continue;
      queued.add(row.id);
      todo.push(row);
    }

    let found = 0;
    for (const row of todo) {
      const appId = await resolveSteamAppId(row.name);
      if (appId) {
        byId[row.id] = appId;
        found += 1;
      } else {
        missing.add(row.id);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (todo.length > 0) {
      await saveBlob(STEAM_MATCH_KEY, { byId, missing: [...missing] });
      const seen = Object.keys(byId).length + missing.size;
      console.log(
        `Steam matching: ${found} found of ${todo.length} tried, ` +
          `${Object.keys(byId).length} matched overall, ${seen}/${storeIndex.length} of the mirror checked`,
      );
    }
  } catch (error) {
    console.error('Steam matching failed:', error);
  }

  const sweep = await sweepForReleases();
  console.log(
    `Swept concepts ${sweep.from}-${sweep.to}: ${sweep.discovered} upcoming found, ` +
      `${sweep.seeds} seeds tracked, ${sweep.calendar} on the calendar, ` +
      `${sweep.recent} just out, ${sweep.mirror} in the store mirror`,
  );

  /*
   * Which store games PlayStation Plus covers.
   *
   * One request for the lot, from PlayStation's own Plus games page. Asking
   * each game's store page instead would be authoritative and would also be
   * 8,885 fetches, which is not a nightly job, it is a weekend.
   *
   * A failed read leaves the stored list alone. Null and empty are different
   * answers here: empty would mean nothing is included, which is never true
   * and would wipe every badge in the app.
   */
  try {
    const ids = await fetchPlusConceptIds();
    if (ids) {
      await saveBlob(PLUS_KEY, { ids, at: new Date().toISOString() });
      console.log(`PS Plus catalog: ${ids.length} concept ids stored`);
    } else {
      console.log('PS Plus catalog: page unreadable or too short, keeping the stored list');
    }
  } catch (error) {
    console.error('PS Plus catalog refresh failed:', error);
  }

  // The gossip feed's video pool, filled the slow way.
  //
  // A request has ten seconds, so the live path can only rotate a handful of
  // feeds at a time and YouTube refuses most of a burst regardless; the pool
  // sat at 22 videos from 3 of 70 channels. Here there is time to ask for all
  // of them one at a time, a second apart, which is the pattern YouTube
  // actually answers. Failing is harmless: every channel keeps whatever it
  // last had, and the fifteen-minute rotation carries on either way.
  try {
    const warmed = await warmYouTubePool();
    console.log(
      `YouTube pool: ${warmed.answered.length}/${warmed.asked} channels answered, ` +
        `${warmed.written} videos stored` +
        (warmed.silent.length ? `; silent: ${warmed.silent.join(', ')}` : ''),
    );
  } catch (error) {
    console.error('YouTube pool warm failed:', error);
  }
};

export const config = { schedule: '@daily' };
