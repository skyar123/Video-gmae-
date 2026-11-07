/**
 * Blob keys shared between modules.
 *
 * These live apart from the modules that own the data so a function needing
 * only a key does not pull in a few megabytes of baked index alongside it.
 */
export const DISCOVERED_KEY = 'store/discovered.json';
export const BACKTEST_KEY = 'predict/backtest.json';
export const ALERTS_KEY = 'alerts/subscribers.json';
export const STEAM_MATCH_KEY = 'store/steam-matches.json';
/** The whole index in one object. Read for migration, no longer written. */
export const PLUS_KEY = 'store/ps-plus.json';
/** How many objects the index is spread over now. See plus.mjs. */
export const PLUS_SHARDS = 16;
export const plusShardKey = (shard) => `store/ps-plus/${shard}.json`;
export const plusShardFor = (id) => Number(id) % PLUS_SHARDS;

export const SWEEP_LOG_KEY = 'upcoming/last-sweep.json';
export const PLUS_LOG_KEY = 'store/last-plus-scan.json';
