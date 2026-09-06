# PS4 to PS5 Upgrade Catalog

A filterable catalog of 150 PlayStation 4 games that run better on PS5, with live
artwork, trailers and sale prices pulled in at runtime.

## What it does

- **150 games** in `src/games.json`, each with `id`, `title`, `genre`, `artStyle`,
  `protagonist`, `ps5Upgrade` and `description`.
- **Combinable filters**: title search, genre, protagonist, art style, upgrade type,
  an "on sale now" toggle, and sorting by discount, price or title. Every filter
  narrows the same list, and the grid updates as you type.
- **Live media**: cover art, up to six screenshots and up to three trailers per game,
  played inline.
- **Live prices**: current price and discount percentage, refreshed on demand.
- Dropdown options are derived from the data, so a game with a new genre or art
  style appears in the filters without touching the component.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173 — includes the live-data API
npm run build    # production build into dist/
npm run lint
```

`npm run dev` serves the `/api/games` route through a Vite middleware that shares
its implementation with the Netlify function, so live data works locally without
the Netlify CLI.

## Deploying to Netlify

The app lives in this subdirectory, so set **Base directory** to
`ps5-upgrade-catalog` in the Netlify UI. `netlify.toml` supplies the rest: build
command, `dist` as the publish directory, and the function in
`netlify/functions/`. No environment variables and no API keys are needed.

## Where the live data comes from

Sony publishes no open price or media API for the PlayStation Store, so the app
uses Valve's public storefront endpoints, which need no key and return artwork,
screenshots, trailers and the current discount in one pair of calls per game.

That has one honest consequence: **the price shown is the PC price**, and the UI
labels it that way. It works as a sale signal — publishers usually discount across
storefronts together — but PS Store pricing varies by region, so every game also
links out to its PS Store search page. If you later get access to a PlayStation
price feed, `api/steam.mjs` is the only file that needs to change: keep the shape
returned by `resolveGame` and the rest of the app follows.

Matching is deliberately conservative. A title only resolves when the storefront
name matches closely, with DLC, soundtracks and sequels rejected, so a game with no
confident match falls back to a lettered gradient rather than showing the wrong
box art. Of the 150 titles, 149 resolve; Concrete Genie is a PlayStation exclusive
with no PC listing.

### Request shape

```
GET /api/games?chunk=0      # entries 0-14 of the catalog
GET /api/games?title=Stray  # a single title
GET /api/games?chunk=0&cc=GB  # another storefront region
```

The client requests fixed chunks of 15, so every visitor asks for the same URLs and
the CDN can serve them; responses carry a 30-minute shared cache with
stale-while-revalidate, and the function caches per instance on top of that. Cold,
the whole catalog costs 300 upstream requests; warm, it costs none.

## Data accuracy

Upgrade statuses (`Free PS5 Upgrade`, `PS4 & PS5 Cross-Buy`, `Paid PS5 Upgrade`,
`Backwards Compatible`) were compiled by hand and reflect the usual North American
listing. Publishers change these, and they differ by region — treat the field as a
starting point and confirm on the PS Store before buying.

## Layout of the code

```
api/steam.mjs              storefront client: matching, caching, normalising
netlify/functions/games.mjs  /api/games in production
vite.config.js             the same route during development
src/App.jsx                the entire UI
src/games.json             the 150-game catalog
```
