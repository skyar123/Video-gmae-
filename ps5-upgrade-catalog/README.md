# PS4 to PS5 Upgrade Catalog

A filterable catalog of 245 PlayStation games — 199 PS4 titles with a PS5 upgrade
path, plus 46 PS5-only titles — with live artwork, trailers and sale prices pulled
in at runtime.

## What it does

- **245 games** in `src/games.json`, each with `id`, `title`, `genre`, `artStyle`,
  `protagonist`, `ps5Upgrade` and `description`, plus `platform` (`PS4` or `PS5`),
  `tags` for the curated collections, a `steamAppId` used to load artwork before
  the live request lands, and `ratings` (critic score, player score, pros, cons).
- **Two ratings side by side**: the critic score and the percentage of players
  rating it positively, on every card and in the detail view.
- **Pros and cons pulled from reviews** rather than written by hand, with a count
  of how many reviews raised each point.
- **Kid-friendly verdict** on every card, judged on content rather than the age
  number, with a filter for the family-safe ones.
- **Two views**: a dense grid, or a full-screen snap feed you flick through one
  game at a time.
- **Controls that get out of the way**: the bar collapses to a single row as you
  scroll down and springs back when you scroll up, with active filters staying
  visible as removable chips.
- **Curated collections**: Best deals (computed live from current discounts,
  deepest cut first), Best graphics, Online & social, and Cozy. The last three come
  from tags in the data; every collection composes with the filters below.
- **PS5-only titles are hidden by default** and revealed with one toggle. This is a
  PS4 upgrade catalog first, and those games need different hardware. Choosing the
  `PS5 Only` upgrade type reveals them automatically.
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

## Is it kid friendly?

Every card carries a verdict — Great for kids, Fine for most kids, Mature content,
or Not rated — and a toggle filters to the first two, which covers 170 of the 245
games.

The verdict is judged on **content, not the age number**, because those are
different questions. Lake is rated for teens over a drug reference but is a game
about delivering mail; Call of Duty carries the same rating for very different
reasons. So gore, brutal violence and sexual content rule a game out, while mild
violence, language and drink or drug references only soften it. A Mature-rated
game with none of the former still reads as fine — Disco Elysium, Sifu and Life
is Strange: True Colors all land in the family list.

Severity is read from the content descriptors of whichever boards rated the game,
so the matching covers the Portuguese and German vocabularies as well as English.
Where a game has no descriptors at all, its age tier is the fallback. The board's
own rating is always shown alongside, and the detail view lists exactly which
descriptors ruled a game out.

Board coverage: ESRB is preferred as the US board, but most smaller titles were
never submitted to it, so the chain falls back through PEGI, USK, OFLC, DJCTQ and
IGRS — which agree with the ESRB tier wherever both exist, taking coverage from
138 games to 215. Nothing is inferred from the game itself: with no rating at all
it reads "Not rated", not "probably fine".

## Ratings, pros and cons

Two numbers sit beside each other on every card: the **critic score** from
Metacritic (as carried by the storefront) and the **player score**, the share of
all player reviews that are positive, with the total review count in the tooltip.
Either is omitted rather than guessed when the storefront has no figure. Of the
245 games, 234 have a player score and 148 a critic score.

Pros and cons are counted from the review corpus, not written by us:

- Praise is tallied **only inside positive reviews** and complaints **only inside
  negative ones**, so "great story, awful performance" cannot file story under
  complaints.
- Complaints get their own review sample. The default feed skews so heavily
  positive that a well-liked game would otherwise report no cons at all.
- A theme needs at least three mentions to appear, and each bullet shows its
  count, so a weak signal reads as a weak signal.
- Reviews shorter than 80 characters are dropped — "10/10" carries no theme.

The themes are a fixed vocabulary, so nothing is generated and no review text is
republished. Cyberpunk 2077, for example, comes back with story, soundtrack and
combat as praise, and bugs and crashes as its top complaint by a wide margin.

Ratings ship baked into `src/games.json`, so a card is never blank on first
paint and costs no request. The nightly function refreshes them into blob
storage, and anything it has overrides the baked values.

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
api/reviews.mjs            player ratings and review-derived pros and cons
api/history.mjs            recorded price history (Netlify Blobs, or a local file)
netlify/functions/games.mjs            /api/games in production
netlify/functions/snapshot-prices.mjs  nightly price snapshot
vite.config.js             the same route during development
src/App.jsx                the entire UI
src/games.json             the 245-game catalog, each entry carrying its store id
```

## Adding games

Append to `src/games.json` with `platform` set to `PS4` or `PS5` and `tags` drawn
from `cozy`, `graphics` and `social`. Then resolve the store id once, offline:

```js
import { resolveMany } from './api/steam.mjs';
```

Runtime never searches the storefront — it only fetches by a baked id — so a bad
match is caught while baking rather than shipped to readers. An entry with
`steamAppId: null` renders a lettered gradient and no price, which is correct for
console exclusives and for games sold outside Steam. Eleven of the 229 are in that
state: PlayStation exclusives such as Astro Bot, Demon's Souls and Gran Turismo 7,
and Epic-store titles such as Rocket League, Fall Guys and Genshin Impact. Those
also have no ratings, since the ratings come from the same storefront.
