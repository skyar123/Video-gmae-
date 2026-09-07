import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { CACHE_HEADER, handleGamesRequest } from './api/steam.mjs';

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

  return {
    name: 'games-api',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

export default defineConfig({
  plugins: [react(), gamesApiPlugin()],
});
