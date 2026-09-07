import catalog from '../../src/games.json' with { type: 'json' };
import { CHUNK_SIZE, REVIEW_KEY_PREFIX, mapWithConcurrency } from '../../api/steam.mjs';
import { loadPsnPrice } from '../../api/psn.mjs';
import { recordAndSummarize, saveBlob } from '../../api/history.mjs';
import { loadReviewSignal } from '../../api/reviews.mjs';

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
 * Scheduled functions only run on published deploys.
 */
export default async () => {
  const regions = (process.env.HISTORY_REGIONS || 'US')
    .split(',')
    .map((region) => region.trim().toUpperCase())
    .filter(Boolean);

  const chunkCount = Math.ceil(catalog.length / CHUNK_SIZE);

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
      await recordAndSummarize(chunk, countryCode, games);
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
};

export const config = { schedule: '@daily' };
