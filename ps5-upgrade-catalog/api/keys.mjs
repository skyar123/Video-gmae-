/**
 * Blob keys shared between modules.
 *
 * These live apart from the modules that own the data so a function needing
 * only a key does not pull in a few megabytes of baked index alongside it.
 */
export const DISCOVERED_KEY = 'store/discovered.json';
export const BACKTEST_KEY = 'predict/backtest.json';
