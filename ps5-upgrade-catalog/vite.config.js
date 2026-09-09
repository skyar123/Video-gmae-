import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { CACHE_HEADER, handleGamesRequest } from './api/steam.mjs';
import { loadGameNews, loadNews } from './api/news.mjs';
import { loadUpcoming } from './api/upcoming.mjs';
import { searchStore, storeGenres, storeSize } from './api/store.mjs';
import { loadConceptDetail } from './api/concept.mjs';
import { replayCalibration } from './api/backtest.mjs';
import { loadChunk } from './api/history.mjs';

/**
 * Serves the same /api/games responses as the Netlify function during
 * `npm run dev`, so live prices and artwork work without the Netlify CLI.
 */
function gamesApiPlugin() {
  const catalog = JSON.parse(readFileSync(new URL('./src/games.json', import.meta.url)));

  // Returning a value from these hooks would register it as a post-hook, so the
  // middleware is mounted for its side effect only.
  const mount = (server) => {
    server.middlewares.use('/api/games', async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        const { status, body } = await handleGamesRequest(url, catalog);
        response.statusCode = status;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('cache-control', status === 200 ? CACHE_HEADER : 'no-store');
        response.end(JSON.stringify(body));
      } catch (error) {
        response.statusCode = 502;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ error: String(error?.message || error) }));
      }
    });
  };

  const mountJson = (server, path, load) => {
    server.middlewares.use(path, async (request, response) => {
      try {
        const payload = await load();
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(payload));
      } catch (error) {
        response.statusCode = 502;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ error: String(error?.message || error) }));
      }
    });
  };

  const mountStore = (server) => {
    server.middlewares.use('/api/store', async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        const payload =
          url.searchParams.get('facets') === '1'
            ? { genres: await storeGenres(), size: await storeSize() }
            : await searchStore({
                q: url.searchParams.get('q') ?? '',
                genre: url.searchParams.get('genre') ?? '',
                platform: url.searchParams.get('platform') ?? '',
                sort: url.searchParams.get('sort') ?? 'relevance',
                page: Number(url.searchParams.get('page') ?? 0) || 0,
                exclude: (url.searchParams.get('exclude') ?? '').split('\n').filter(Boolean),
              });
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(payload));
      } catch (error) {
        response.statusCode = 502;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ error: String(error?.message || error) }));
      }
    });
  };

  const mountAll = (server) => {
    mount(server);
    server.middlewares.use('/api/news', async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        const game = url.searchParams.get('game');
        const payload = game ? await loadGameNews(game) : await loadNews();
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(payload));
      } catch (error) {
        response.statusCode = 502;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ error: String(error?.message || error) }));
      }
    });
    mountJson(server, '/api/upcoming', loadUpcoming);
    mountStore(server);
    // Computed live in dev so the harness is exercised without waiting for
    // the nightly job; in production this is read from what that job stored.
    mountJson(server, '/api/backtest', async () => {
      const histories = {};
      for (let chunk = 0; chunk < 20; chunk += 1) {
        histories[`chunk-${chunk}`] = await loadChunk(chunk, 'US');
      }
      return replayCalibration(histories);
    });
    server.middlewares.use('/api/concept', async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        const id = Number(url.searchParams.get('id'));
        const genres = (url.searchParams.get('genres') ?? '').split(',').map((g) => g.trim()).filter(Boolean);
        const detail = Number.isFinite(id) && id > 0
          ? await loadConceptDetail(id, (url.searchParams.get('cc') ?? 'US').toUpperCase(), genres)
          : null;
        response.statusCode = detail ? 200 : 404;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(detail ?? { error: 'not found' }));
      } catch (error) {
        response.statusCode = 502;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ error: String(error?.message || error) }));
      }
    });
  };

  return {
    name: 'games-api',
    configureServer: mountAll,
    configurePreviewServer: mountAll,
  };
}

export default defineConfig({
  plugins: [react(), gamesApiPlugin()],
  build: {
    rolldownOptions: {
      output: {
        // The catalog is half the bundle and changes far less often than the
        // code around it, so it gets its own long-lived chunk: editing a
        // component no longer costs a phone another 90KB of catalog.
        manualChunks: (id) => {
          if (id.includes('games.json')) return 'catalog';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
