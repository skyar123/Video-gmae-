import catalog from '../../src/games.json' with { type: 'json' };
import { CHUNK_SIZE, resolveMany } from '../../api/steam.mjs';
import { recordAndSummarize } from '../../api/history.mjs';

/**
 * Nightly price snapshot. Visits record history too, but only for chunks
 * somebody actually loaded; this makes sure every game gets a daily reading
 * whether or not it was viewed, which is what the drop predictor learns from.
 *
 * Scheduled functions only run on published deploys.
 */
export default async () => {
  const regions = (process.env.HISTORY_REGIONS || 'US')
    .split(',')
    .map((region) => region.trim().toUpperCase())
    .filter(Boolean);

  for (const countryCode of regions) {
    for (let chunk = 0; chunk * CHUNK_SIZE < catalog.length; chunk += 1) {
      const slice = catalog.slice(chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE);
      const resolved = await resolveMany(slice, countryCode, 2);
      const games = resolved.map((game, index) => ({ ...game, id: slice[index].id }));
      await recordAndSummarize(chunk, countryCode, games);
    }
    console.log(`Recorded prices for ${catalog.length} games in ${countryCode}`);
  }
};

export const config = { schedule: '@daily' };
