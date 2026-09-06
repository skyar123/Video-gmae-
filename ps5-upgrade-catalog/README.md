# PS4 to PS5 Upgrade Catalog

A filterable catalog of 150 PlayStation 4 games that run better on PS5, with live
artwork, trailers and sale prices pulled in at runtime.

## What it does

- **150 games** in `src/games.json`, each with `id`, `title`, `genre`, `artStyle`,
  `protagonist`, `ps5Upgrade` and `description`, plus a `steamAppId` used to load
  artwork before the live request lands.
- **Combinable filters**: title search, genre, protagonist, art style, upgrade type,
  an "on sale now" toggle, and sorting by discount, price or title. Every filter
  narrows the same list, and the grid updates as you type.
- **Live media**: cover art, up to six screenshots and up to three trailers per game,
  played inline.
- **Live prices**: current price and discount percentage, refreshed on demand, in
  your choice of storefront region (default United States).
- **Price-drop prediction**: a per-game estimate of the chance of a lower price in
  the next 30 days, with the reasoning shown in full.
- **Wishlist**: star any game, then filter to just those. Stored in the browser.
- **Shareable views**: every filter lives in the URL, so a filtered list can be
  bookmarked or sent to someone.
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

## How the price-drop predictor works

It is a transparent heuristic, not a model trained on anything, and the UI says so
next to every score. Four signals feed it:

1. **Release age.** Games rarely discount in their first three months, discount
   routinely after a year, and discount deeply once they are a few years old.
2. **Current discount.** A live discount is itself evidence that the near-term
   floor is already here, so it pushes the score down.
3. **Sale calendar.** Approximate recurring windows — spring, Days of Play, summer,
   Black Friday, the winter holidays. These are historical patterns, not announced
   dates. A window inside 30 days raises the score sharply.
4. **Recorded history**, once there is any: how far today's price sits above the
   lowest we have logged, and whether the gap since its last sale exceeds its own
   typical gap.

The score is the estimated chance of a lower price within 30 days, and every game
lists the reasons that produced it. Sorting by **Best time to buy** ranks the
lowest scores first: the games least likely to get cheaper are the ones worth
buying today.

Confidence starts at `low` and rises as history accumulates. Claims that depend on
history are suppressed until there is enough of it — on day one every price is
trivially the lowest ever seen, so the "lowest we have tracked" verdict needs at
least two weeks of observation behind it.

## Price history

Nobody publishes a usable price-history feed, so the app keeps its own. Two things
write to it:

- Every `/api/games` request records the prices it just fetched, so history starts
  accruing from the first visit.
- `netlify/functions/snapshot-prices.mjs` runs daily and covers every game, whether
  or not anyone looked at it.

Only *changes* are stored, which keeps a year of history per game to a few hundred
bytes. Storage is Netlify Blobs in production, keyed per chunk and per region so a
request reads and writes exactly one blob. Locally it falls back to a gitignored
`.price-history.local.json`, so the feature is developable without the platform.

Set `HISTORY_REGIONS` (for example `US,GB`) to snapshot more than one region
nightly. It defaults to `US`.

## Layout of the code

```
api/steam.mjs              storefront client: matching, caching, normalising
api/predict.mjs            the price-drop heuristic
api/history.mjs            recorded price history (Netlify Blobs, or a local file)
netlify/functions/games.mjs            /api/games in production
netlify/functions/snapshot-prices.mjs  nightly price snapshot
vite.config.js             the same route during development
src/App.jsx                the entire UI
src/games.json             the 150-game catalog, each entry carrying its store id
```
