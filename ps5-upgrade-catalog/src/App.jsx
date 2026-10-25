import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowUpRight,
  Baby,
  BadgePercent,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CirclePlay,
  Clapperboard,
  Clock,
  Dices,
  ExternalLink,
  Flame,
  Gamepad2,
  Heart,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Loader2,
  Mail,
  Mic,
  MessageCircle,
  Newspaper,
  RefreshCw,
  Play,
  Rows3,
  Search,
  SlidersHorizontal,
  Smartphone,
  Moon,
  Sparkles,
  Star,
  Sun,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  Users,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react';
import { buildProfile, recommend, starterPicks } from './recommend.js';
import { fold, indexText, parseQuery, scoreMatch } from '../api/search.mjs';
import { priceStanding } from '../api/standing.mjs';
import gamesData from './games.json';
import creatorsData from './creators.json';

/**
 * The catalog's searchable text, built once.
 *
 * Titles carry the match; the second line is a fallback so that typing a
 * genre or a tag finds something rather than nothing. They are kept apart
 * because a title match should always win: searching "Stray" must not be
 * outranked by a cat game whose notes mention strays.
 */
const SEARCH_ROWS = new Map(
  gamesData.map((game) => [
    game.id,
    {
      title: indexText(game.title),
      meta: indexText(
        [game.genre, game.artStyle, game.protagonist, ...(game.tags ?? [])].join(' '),
      ),
    },
  ]),
);

/* ------------------------------------------------------------------ *
 * Filter options
 *
 * Derived from the data rather than hard-coded, so adding a game with a
 * new genre or art style puts it in the dropdowns automatically.
 * ------------------------------------------------------------------ */

const uniqueValues = (key) =>
  ['All', ...new Set(gamesData.map((game) => game[key]))].sort((a, b) =>
    a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b),
  );

const GENRES = uniqueValues('genre');
const PROTAGONISTS = uniqueValues('protagonist');
const ART_STYLES = uniqueValues('artStyle');
const UPGRADES = uniqueValues('ps5Upgrade');

/**
 * Curated views over the catalog. "Best deals" is computed live from current
 * discounts; the rest come from tags in games.json.
 */
// Two axes share one strip: the first five are places to look, the rest are
// moods. Both labels and counts are cut back hard, because eleven chips at
// their full length measured 1308px wide on a 390px phone, three and a half
// screens of sideways scrolling to reach the last one, and a collection
// nobody can see reads as a collection that does not exist. One word where
// one word will do; the blurb under the results carries the full sentence.
const COLLECTIONS = [
  // "All" is the mirror, 8,885 games, not the few hundred with write-ups. A
  // library that says "All games" and means 3% of the store is the wrong
  // answer to "what can I play", and store rows carry their own art, price
  // and rating, so a card is never empty.
  //
  // It is not literally the whole store, and the blurb no longer says it is.
  // The mirror is built by walking concept ids, and a good part of the PS4
  // back catalogue has no concept page to walk: 107 of the 306 written-up
  // games are absent from it, 101 of them PS4, Outer Wilds and No Man's Sky
  // and Firewatch and Stardew Valley among them. Searching All falls back to
  // the written-up catalog for exactly that reason.
  { value: 'all', label: 'All', tag: null },
  // Deals come second because they are a main reason to open this at all.
  { value: 'deals', label: 'Deals', tag: null },
  // You pay for PS Plus already, so the games it covers cost nothing more.
  // The store marks them "Included" and names the tier that covers them.
  { value: 'plus', label: 'PS Plus', tag: null },
  { value: 'genius', label: 'For you', tag: null },
  // What used to be "All": the hand-written ones, with upgrade paths, tags,
  // representation notes and recorded price history behind them.
  { value: 'curated', label: 'Curated', tag: null },
  { value: 'soon', label: 'Soon', tag: null },
  { value: 'graphics', label: 'Graphics', tag: 'graphics', mood: true },
  { value: 'social', label: 'Social', tag: 'social', mood: true },
  { value: 'cozy', label: 'Cozy', tag: 'cozy', mood: true },
  { value: 'classic', label: 'Classics', tag: 'classic', mood: true },
  { value: 'queer', label: 'Queer', tag: 'queer', mood: true },
  { value: 'disability', label: 'Disability', tag: 'disability', mood: true },
];

const COLLECTION_BLURBS = {
  genius:
    'Worked out from the games you own and want, with the reason for each pick.',
  deals: 'Everything discounted right now, deepest cut first. Updates with the storefront.',
  plus: 'Already covered by your PlayStation Plus subscription, so there is nothing more to pay. Read from the store, which names the tier each one needs.',
  graphics: 'Technical showcases and standout art direction.',
  social: 'Online play, co-op and couch multiplayer.',
  cozy: 'Low-stress games with gentle pacing and no fail state to speak of.',
  classic: 'Older PlayStation games and remasters you can play on a PS4 or PS5 today.',
  queer: 'Games with queer characters or relationships that matter to the story, not background detail.',
  disability: 'Games with disabled or neurodivergent characters, or landmark accessibility work.',
  all: "8,885 games mirrored from the PlayStation Store, plus the written-up ones the mirror has no page for. Hand-written entries are marked; the rest carry the store's own art, price and star rating.",
  curated:
    'The hand-written ones, with upgrade paths, representation notes, kid-friendly verdicts and recorded price history behind each.',
  soon: 'Out in the next few weeks, and everything from the last sixty days. Heart one and it stays on your wishlist through release.',
};

const SORTS = [
  { value: 'catalog', label: 'Catalog order' },
  { value: 'buy', label: 'Best time to buy' },
  { value: 'discount', label: 'Biggest discount' },
  { value: 'price', label: 'Lowest price' },
  { value: 'title', label: 'Title A-Z' },
];

/** Storefront regions. Default is the US, which covers Asheville. */
const REGIONS = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'AU', label: 'Australia' },
  { value: 'JP', label: 'Japan' },
  { value: 'BR', label: 'Brazil' },
  { value: 'MX', label: 'Mexico' },
];

const UPGRADE_STYLES = {
  'Free PS5 Upgrade': 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-600/20',
  'PS4 & PS5 Cross-Buy': 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-600/20',
  'Paid PS5 Upgrade': 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-600/20',
  'Backwards Compatible': 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-500/20',
  'PS5 Only': 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-600/20',
  'PS Plus Classic': 'bg-teal-50 text-teal-700 ring-teal-600/20',
};

const VERDICT_STYLES = {
  'buy-now': 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-600/20',
  wait: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-600/20',
  hold: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-500/20',
  'too-new': 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-600/20',
  // A subscription already covering the game is its own answer, not a price.
  included: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-indigo-600/20',
  unknown: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-500/20',
};

/* ------------------------------------------------------------------ *
 * URL and local state
 * ------------------------------------------------------------------ */

const DEFAULT_FILTERS = {
  q: '',
  genre: 'All',
  protagonist: 'All',
  artStyle: 'All',
  upgrade: 'All',
  sale: false,
  atFloor: false,
  wishlist: false,
  sort: 'catalog',
  region: 'US',
  collection: 'all',
  kidFriendly: false,
  noPurchases: false,
  owned: 'any',
  view: 'grid',
  // PS5-only titles are out of the default view: this is a PS4 upgrade
  // catalog first, and they need different hardware.
  includePs5: false,
};

function readFiltersFromUrl() {
  if (typeof window === 'undefined') return DEFAULT_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const value = (key, fallback) => params.get(key) ?? fallback;
  return {
    q: value('q', ''),
    genre: value('genre', 'All'),
    protagonist: value('protagonist', 'All'),
    artStyle: value('art', 'All'),
    upgrade: value('upgrade', 'All'),
    sale: params.get('sale') === '1',
    atFloor: params.get('floor') === '1',
    wishlist: params.get('wishlist') === '1',
    sort: value('sort', 'catalog'),
    region: (value('cc', localStorage.getItem('region') || 'US') || 'US').toUpperCase(),
    // ?view=store was the whole store before "All" became it, and ?view=all
    // meant the curated list. Both still land somewhere sensible.
    collection: value('view', 'all') === 'store' ? 'all' : value('view', 'all'),
    kidFriendly: params.get('kids') === '1',
    noPurchases: params.get('nomtx') === '1',
    owned: value('owned', 'any'),
    view: params.get('mode') === 'feed' ? 'feed' : 'grid',
    includePs5: params.get('ps5') === '1',
  };
}

/** Only non-default values reach the URL, so a plain link stays plain. */
function writeFiltersToUrl(filters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.genre !== 'All') params.set('genre', filters.genre);
  if (filters.protagonist !== 'All') params.set('protagonist', filters.protagonist);
  if (filters.artStyle !== 'All') params.set('art', filters.artStyle);
  if (filters.upgrade !== 'All') params.set('upgrade', filters.upgrade);
  if (filters.sale) params.set('sale', '1');
  if (filters.atFloor) params.set('floor', '1');
  if (filters.wishlist) params.set('wishlist', '1');
  if (filters.sort !== 'catalog') params.set('sort', filters.sort);
  if (filters.region !== 'US') params.set('cc', filters.region);
  if (filters.collection !== 'all') params.set('view', filters.collection);
  if (filters.kidFriendly) params.set('kids', '1');
  if (filters.noPurchases) params.set('nomtx', '1');
  if (filters.owned !== 'any') params.set('owned', filters.owned);
  if (filters.view === 'feed') params.set('mode', 'feed');
  if (filters.includePs5) params.set('ps5', '1');
  const query = params.toString();
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
}

const WISHLIST_KEY = 'wishlist';
const LIBRARY_KEY = 'library';
const HIDDEN_KEY = 'hidden';

/** Store-mirror ids are numeric; prefixing keeps them out of the catalog's namespace. */
const storeKey = (game) => `store:${game.id}`;
const SAVED_STORE_KEY = 'savedStoreGames';
/** Enough to never be reached in practice, low enough to bound the key. */
const MAX_SAVED_STORE = 500;
const SAVED_RELEASES_KEY = 'savedReleases';
const WISHLIST_PRICES_KEY = 'wishlistPrices';
const DEAL_ALERTS_KEY = 'dealAlerts';

/** Games you are waiting on a price for, which is not the same as wanting them. */
function readDealAlerts() {
  try {
    const raw = localStorage.getItem(DEAL_ALERTS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function readFavouriteCreators() {
  try {
    const raw = localStorage.getItem(FAVOURITE_CREATORS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function readLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

/**
 * Saved upcoming games, stored with the date they had when you saved them.
 * Keeping the old date is the whole trick: comparing it against the store's
 * current one is what turns "saved" into "tell me when it changes".
 */
function readSavedReleases() {
  try {
    const raw = localStorage.getItem(SAVED_RELEASES_KEY);
    const rows = raw ? JSON.parse(raw) : [];
    return new Map(rows.map((row) => [row.id, row]));
  } catch {
    return new Map();
  }
}

/**
 * What each wishlisted game cost when you added it.
 *
 * Recorded once, the first time a live price is seen for something on the
 * wishlist. It is what turns "you wanted this" into "this is $12 cheaper than
 * when you wanted it", which is the whole point of keeping a wishlist.
 */
function readWishlistPrices() {
  try {
    return JSON.parse(localStorage.getItem(WISHLIST_PRICES_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function readHidden() {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

/** Raw mirror rows for the store games that have been saved. */
function readSavedStoreRows() {
  try {
    const raw = localStorage.getItem(SAVED_STORE_KEY);
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function readWishlist() {
  try {
    const raw = localStorage.getItem(WISHLIST_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

/* ------------------------------------------------------------------ *
 * Live storefront data
 * ------------------------------------------------------------------ */

const CHUNK_SIZE = 15;
const CHUNK_COUNT = Math.ceil(gamesData.length / CHUNK_SIZE);

/** How many chunk requests may be in flight at once. */
const LOAD_CONCURRENCY = 6;
/** Grid repaints are the expensive part, so arriving chunks are grouped. */
const FLUSH_MS = 180;

/**
 * Pulls artwork, screenshots, trailers, sale prices and drop predictions from
 * /api/games. Chunk URLs are identical for every visitor, so the CDN can serve
 * most of these without touching the upstream storefront. Cards render
 * immediately and fill in as chunks land.
 *
 * Chunks are fetched several at a time. They used to go one after another,
 * which was fine whenever the CDN had them all and disastrous whenever it did
 * not: a chunk the CDN has to fill costs a couple of seconds upstream at the
 * PlayStation Store, and twenty of those in a row measured 37 to 48 seconds
 * of prices dribbling in from the top of the page down. The cache only holds
 * ten minutes, so anyone opening the app after a break paid that nearly every
 * time. Six in flight brings the same cold load to about five seconds.
 *
 * Results are also grouped before they reach state. One commit per chunk meant
 * forty renders of a 298-card grid during a load; grouping them into a flush
 * every FLUSH_MS keeps prices appearing promptly without the repaint storm.
 */
function useLiveData(region) {
  const [byTitle, setByTitle] = useState(() => new Map());
  const [chunksLoaded, setChunksLoaded] = useState(0);
  const [status, setStatus] = useState('loading');
  const [updatedAt, setUpdatedAt] = useState(null);
  const runId = useRef(0);

  const load = useCallback(
    async (force = false) => {
      const run = ++runId.current;
      if (force || runId.current > 1) {
        setStatus('loading');
        setChunksLoaded(0);
        setByTitle(new Map());
      }

      let failed = 0;
      let done = 0;
      // Games waiting to be shown, and the last time they were handed over.
      let pending = [];
      let flushedAt = 0;

      const flush = () => {
        if (pending.length === 0) return;
        const batch = pending;
        pending = [];
        flushedAt = Date.now();
        setByTitle((previous) => {
          const next = new Map(previous);
          for (const game of batch) next.set(game.title, game);
          return next;
        });
      };

      const fetchChunk = async (chunk) => {
        try {
          // `cache: 'reload'` only bypasses the browser's own cache. The CDN
          // in front of the function would still answer from its copy, so a
          // deliberate refresh also has to look like a URL it has not seen.
          const bust = force ? `&fresh=${Date.now()}` : '';
          const response = await fetch(`/api/games?chunk=${chunk}&cc=${region}${bust}`, {
            cache: force ? 'reload' : 'default',
          });
          if (!response.ok) throw new Error(`request failed: ${response.status}`);
          const payload = await response.json();
          if (runId.current !== run) return;
          pending.push(...(payload.games ?? []));
        } catch {
          failed += 1;
        }
        done += 1;
        if (runId.current !== run) return;
        setChunksLoaded(done);
        if (Date.now() - flushedAt >= FLUSH_MS) flush();
      };

      // A shared queue rather than fixed slices, so a slow chunk cannot hold
      // up the ones behind it. Taken in order, so the top of the page fills
      // first, which is the part anybody is actually looking at.
      const queue = Array.from({ length: CHUNK_COUNT }, (_, index) => index);
      const worker = async () => {
        while (queue.length > 0) {
          if (runId.current !== run) return;
          await fetchChunk(queue.shift());
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(LOAD_CONCURRENCY, CHUNK_COUNT) }, worker),
      );

      if (runId.current !== run) return;
      flush();
      setStatus(failed === CHUNK_COUNT ? 'error' : 'ready');
      setUpdatedAt(new Date());
    },
    [region],
  );

  useEffect(() => {
    // Fetching on mount and on region change is the point of this effect; the
    // state it writes lands asynchronously, once each chunk comes back.
    // eslint-disable-next-line react/set-state-in-effect
    load();
  }, [load]);

  return {
    byTitle,
    status,
    updatedAt,
    progress: chunksLoaded / CHUNK_COUNT,
    refresh: () => load(true),
  };
}

/** How many cards exist before you have scrolled anywhere. */
const PAGE_STEP = 48;

/**
 * Renders a long list a screenful at a time.
 *
 * Every game in the collection used to be in the DOM at once: 242 cards,
 * 15,784 nodes and 221 images for the default view. Unthrottled that still
 * scrolls at 60fps, but the cost is all raw per-node work, so it falls apart
 * exactly where it matters — an older or cheaper phone, or a hot one. Under a
 * 4x CPU handicap the median frame measured 83ms against the 16.7ms a smooth
 * 60fps needs.
 *
 * So the list grows instead. A sentinel below the last card asks for the next
 * batch as it comes into view, well before it is reached, which keeps the DOM
 * to roughly a quarter of what it was without ever showing an empty gap or a
 * "load more" button to press.
 */
function usePagedList(total, resetKey) {
  const [limit, setLimit] = useState(PAGE_STEP);
  // A callback ref rather than a ref object: the sentinel is only rendered
  // while there is more to show, so the observer has to follow it being
  // mounted and unmounted rather than read a ref during render.
  const [sentinel, setSentinel] = useState(null);

  // A new filter, sort or collection is a different list, so it starts again
  // from the top. One scalar key rather than a dependency array, so this stays
  // statically checkable.
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    setLimit(PAGE_STEP);
  }, [resetKey]);

  useEffect(() => {
    if (!sentinel || limit >= total) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setLimit((current) => Math.min(current + PAGE_STEP, total));
      },
      // Start on the next batch a screen and a half early, so the end of the
      // list is never actually reached.
      { rootMargin: '150% 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, limit, total]);

  // Named for what it does rather than `ref`, which the lint rule reads as
  // a ref object being dereferenced mid-render.
  return { limit, attachEnd: setSentinel, hasMore: limit < total };
}

/**
 * Collapses the control bar once you start scrolling down and brings it back
 * the moment you scroll up, so the games get the screen while you browse.
 */
function useScrollCollapse(threshold = 120) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let previous = window.scrollY;
    let ticking = false;
    let settleUntil = 0;

    const apply = (next) => {
      setCollapsed((current) => {
        if (current === next) return current;
        settleUntil = performance.now() + 260;
        return next;
      });
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const current = window.scrollY;
        // Collapsing shortens the sticky bar, which shifts the page and fires
        // another scroll event; without this settle window that feedback can
        // read as a direction change and make the bar oscillate.
        if (performance.now() < settleUntil) {
          previous = current;
          return;
        }
        // A dead zone keeps trackpad jitter from toggling the bar.
        if (current < threshold) apply(false);
        else if (current > previous + 12) apply(true);
        else if (current < previous - 12) apply(false);
        previous = current;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return collapsed;
}

/* ------------------------------------------------------------------ *
 * Small presentational pieces
 * ------------------------------------------------------------------ */

function UpgradeBadge({ value, className = '' }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
        UPGRADE_STYLES[value] ?? UPGRADE_STYLES['Backwards Compatible']
      } ${className}`}
    >
      {value}
    </span>
  );
}

function DiscountBadge({ price }) {
  if (!price || !price.discountPercent) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-xs font-bold text-white shadow-sm">
      <BadgePercent className="h-3.5 w-3.5" aria-hidden="true" />-{price.discountPercent}%
    </span>
  );
}

function VerdictBadge({ prediction, className = '' }) {
  if (!prediction || prediction.verdict === 'unknown') return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${
        VERDICT_STYLES[prediction.verdict]
      } ${className}`}
    >
      {prediction.verdict === 'included' ? (
        <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {prediction.headline}
    </span>
  );
}

/**
 * Suitability at a glance, judged on content rather than the board's age
 * number. A game can be rated Mature and still be fine for a kid if what
 * earned the rating was language or a drug reference; what disqualifies it is
 * gore, brutal violence or sexual content.
 */
// `short` is what fits on a card two-up on a phone; `label` is the real one.
const FAMILY_TIERS = {
  safe: {
    label: 'Great for kids',
    short: 'Kids',
    tone: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-600/20',
  },
  mild: {
    label: 'Fine for most kids',
    short: 'Most kids',
    tone: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-600/20',
  },
  mature: {
    label: 'Mature content',
    short: 'Mature',
    tone: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-600/20',
  },
  unknown: {
    label: 'Not rated',
    short: 'Not rated',
    tone: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-500/20',
  },
};

/** The board's own verdict, kept separate and shown alongside. */
const AGE_TIERS = {
  everyone: { label: 'All ages' },
  everyone10: { label: 'Ages 10+' },
  teen: { label: 'Teen 13+' },
  mature: { label: 'Mature 17+' },
  unknown: { label: 'Not rated' },
};

const FAMILY_TIER_VALUES = ['safe', 'mild'];

/**
 * Whether a rating means "a child can play this".
 *
 * The content verdict alone was not enough. It is derived from descriptor
 * wording, and the board's tier is applied as a floor, which lifts a Teen
 * game with bland descriptors to "mild" — and "mild" was passing this
 * filter. Across one scan five of the eleven games it returned were ESRB T,
 * which is 13+, under a control with a baby on it.
 *
 * So the board's own tier has a veto. Everyone and Everyone 10+ can pass;
 * Teen and Mature cannot, whatever their descriptors read like. A rating
 * that was never read stays excluded: unknown is not an assurance.
 */
/**
 * Whether a game asks for money once you are already inside it.
 *
 * Straight from the rating board: ESRB publishes these as interactive
 * elements beside the content descriptors, and names the loot-box case
 * separately as "In-Game Purchases (Includes Random Items)". So this is a
 * fact about the game rather than a guess from its genre or its price.
 */
const hasInGamePurchases = (ageRating) =>
  (ageRating?.interactive ?? []).some((entry) => /purchases/i.test(entry));

const isKidFriendly = (ageRating) =>
  FAMILY_TIER_VALUES.includes(ageRating?.family) &&
  (ageRating?.tier === 'everyone' || ageRating?.tier === 'everyone10');

function AgeBadge({ ageRating, size = 'sm' }) {
  const family = FAMILY_TIERS[ageRating?.family ?? 'unknown'] ?? FAMILY_TIERS.unknown;
  const pad = size === 'lg' ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-[11px]';
  const board = ageRating?.source
    ? `${ageRating.source} ${ageRating.rating}${ageRating.official ? '' : ' (auto-generated)'}`
    : 'No board rating found';
  return (
    <span
      title={`${family.label}, content based. Board rating: ${board}`}
      className={`inline-flex items-center gap-1 rounded font-semibold ring-1 ring-inset ${pad} ${family.tone}`}
    >
      <Baby className="h-3.5 w-3.5" aria-hidden="true" />
      {size === 'lg' ? (
        family.label
      ) : (
        <>
          <span className="sm:hidden">{family.short}</span>
          <span className="hidden sm:inline">{family.label}</span>
        </>
      )}
    </span>
  );
}

/** The full content picture, for the detail view. */
function AgeDetail({ ageRating }) {
  if (!ageRating) {
    return (
      <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
        No age rating found for this title. Check the PS Store listing before handing it to a
        kid.
      </p>
    );
  }

  const ageTier = AGE_TIERS[ageRating.tier] ?? AGE_TIERS.unknown;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Kid friendly?
        </h3>
        <AgeBadge ageRating={ageRating} size="lg" />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          Board says {ageTier.label}
          {ageRating.source && ` (${ageRating.source} ${ageRating.rating})`}
          {!ageRating.official && ', auto-generated'}
        </span>
      </div>

      {ageRating.concerns.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">
            What rules it out
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ageRating.concerns.map((concern) => (
              <span
                key={concern}
                className="rounded-md bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 text-xs text-rose-700 dark:text-rose-300"
              >
                {concern}
              </span>
            ))}
          </div>
        </div>
      )}

      {ageRating.descriptors.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Content descriptors
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ageRating.descriptors.map((descriptor) => (
              <span
                key={descriptor}
                className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-600 dark:text-slate-300"
              >
                {descriptor}
              </span>
            ))}
          </div>
        </div>
      )}

      {ageRating.notes && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{ageRating.notes}</p>}

      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
        The verdict is judged on content, not the age number: gore, brutal violence and sexual
        content rule a game out, while mild violence, language and drink or drug references do
        not. A Mature-rated game with none of the former still reads as fine.
      </p>
    </div>
  );
}

/** Green for strong, amber for mixed, rose for poor. */
function scoreTone(value) {
  if (value >= 80) return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-600/20';
  if (value >= 60) return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-600/20';
  return 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-600/20';
}

/**
 * Critic score and player score side by side. Both are omitted rather than
 * guessed when the storefront has no figure.
 */
function RatingChips({ ratings, size = 'sm' }) {
  const critic = ratings?.critic ?? null;
  const user = ratings?.user ?? null;
  if (critic == null && user == null) return null;

  const pad = size === 'lg' ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-[11px]';
  return (
    <div className="flex flex-wrap items-center gap-1">
      {critic != null && (
        <span
          title="Metacritic critic score"
          className={`inline-flex items-center gap-1 rounded-md font-semibold ring-1 ring-inset ${pad} ${scoreTone(critic)}`}
        >
          <Star className="h-3.5 w-3.5" aria-hidden="true" />
          {critic}
          <span className={`font-normal opacity-70 ${size === 'lg' ? '' : 'hidden sm:inline'}`}>
            critics
          </span>
        </span>
      )}
      {user != null && (
        <span
          title={`${user.total.toLocaleString()} player reviews${user.label ? `, ${user.label}` : ''}`}
          className={`inline-flex items-center gap-1 rounded-md font-semibold ring-1 ring-inset ${pad} ${scoreTone(user.percentPositive)}`}
        >
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {user.percentPositive}%
          <span className={`font-normal opacity-70 ${size === 'lg' ? '' : 'hidden sm:inline'}`}>
            players
          </span>
        </span>
      )}
    </div>
  );
}

/** Pros and cons, counted across the review sample rather than written by us. */
function ProsAndCons({ ratings }) {
  const pros = ratings?.pros ?? [];
  const cons = ratings?.cons ?? [];
  if (pros.length === 0 && cons.length === 0) return null;

  const column = (title, items, tone, Icon, empty) => (
    <div>
      <h4 className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${tone}`}>
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
          {items.map((item) => (
            <li key={item.label} className="flex items-baseline justify-between gap-3">
              <span>{item.label}</span>
              <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{item.mentions}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <div className="grid gap-6 sm:grid-cols-2">
        {column('What players praise', pros, 'text-emerald-700 dark:text-emerald-300', ThumbsUp, 'No clear pattern.')}
        {column('What they complain about', cons, 'text-rose-700 dark:text-rose-300', ThumbsDown, 'No recurring complaints.')}
      </div>
      <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
        Themes counted across a sample of player reviews. The number is how many mentioned it.
        Praise is counted only in positive reviews and complaints only in negative ones.
        {ratings.asOf && ` Sampled ${ratings.asOf}.`}
      </p>
    </div>
  );
}

const REPRESENTATION_LABELS = { queer: 'Queer representation', disability: 'Disability representation' };

/**
 * What the representation actually is, named per game. A tag alone says
 * nothing and is easy to get wrong; a sentence can be checked.
 */
function RepresentationDetail({ representation }) {
  if (!representation?.length) return null;
  return (
    <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      {representation.map((entry) => (
        <div key={entry.kind} className="not-first:mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
            {REPRESENTATION_LABELS[entry.kind] ?? entry.kind}
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{entry.note}</p>
        </div>
      ))}
      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
        Noted by hand, and deliberately specific. If something here is wrong or a game is
        missing, it is worth correcting.
      </p>
    </div>
  );
}

/**
 * The same image, asked for at the size it will be drawn at.
 *
 * PlayStation's CDN resizes on `w`, and its originals are not small: a
 * screenshot is around 900KB and a piece of key art around 300KB. Drawn into
 * a 180px card or a 96px thumbnail that is almost all waste, and it is paid
 * for on a phone, on mobile data, before the reader has done anything. Key
 * art at 440 is 24KB rather than 306KB, and a screenshot at 1280 is 275KB
 * rather than 900KB, which is also what 960 costs, so 1280 is the sharper
 * buy at the same price.
 *
 * Only PlayStation's image host understands `w`, so everything else is handed
 * back untouched rather than given a parameter it will ignore.
 */
const atWidth = (url, width) =>
  url && url.includes('image.api.playstation.com')
    ? `${url}${url.includes('?') ? '&' : '?'}w=${width}&thumb=false`
    : (url ?? null);

/**
 * Whether the trailers should stay put.
 *
 * A PlayStation trailer is a 30 to 70MB mp4, nothing like the few hundred KB
 * a short-video feed streams, and the feed would start one on every slide it
 * passes. On a metered or slow connection that is someone's data allowance
 * going on autoplay they did not ask for, so the screenshot stands in: the
 * Save-Data header is an explicit request not to do this, and 2g or 3g is the
 * browser saying it would not play well regardless.
 */
const dataSaverNow = () => {
  const link = typeof navigator === 'undefined' ? null : navigator.connection;
  if (!link) return false;
  return Boolean(link.saveData) || ['slow-2g', '2g', '3g'].includes(link.effectiveType);
};

function useDataSaver() {
  const [saving, setSaving] = useState(dataSaverNow);

  useEffect(() => {
    const link = navigator.connection;
    if (!link?.addEventListener) return undefined;
    const update = () => setSaving(dataSaverNow());
    link.addEventListener('change', update);
    return () => link.removeEventListener('change', update);
  }, []);

  return saving;
}

/** Cover art, or a lettered gradient when the game has no storefront match. */
function CoverArt({ game, live, className = '', width = 440 }) {
  const [failed, setFailed] = useState(false);
  // The catalog carries the storefront id, so art can render before the live
  // request lands.
  const image =
    atWidth(live?.heroImage, width) ??
    (game.steamAppId
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId}/header.jpg`
      : null);

  if (!image || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 ${className}`}
      >
        {/* Clamped and sized down. This printed the full title at text-lg
            with no limit, so anything long overflowed the fixed-ratio box and
            was sliced off top and bottom: "Disco Elysium: The Final Cut" lost
            its first and last words. This is what every card shows until art
            arrives, so it has to survive a long name. */}
        <span className="line-clamp-3 px-3 text-center text-sm font-black uppercase leading-snug tracking-wide text-white/90">
          {game.title}
        </span>
      </div>
    );
  }

  return (
    <img
      src={image}
      alt={`Key art for ${game.title}`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}

/** Recorded price points, oldest to newest. Nothing to draw below two points. */
function PriceSparkline({ points }) {
  if (!points || points.length < 2) return null;
  const values = points.map((point) => point.final);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 240;
  const height = 40;

  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((point.final - min) / span) * (height - 6) - 3;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-3 h-10 w-full"
      role="img"
      aria-label={`Recorded price history across ${points.length} changes`}
      preserveAspectRatio="none"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-500" />
    </svg>
  );
}

/**
 * Plays a storefront trailer. Steam serves adaptive streams only, so hls.js is
 * loaded on demand — browsers with native HLS (Safari) skip the download.
 */
function TrailerPlayer({
  video,
  poster,
  muted = false,
  // In a modal, sound and native controls arrive together and the trailer
  // plays once. The feed wants neither of those but still wants sound, so
  // both are separable; the defaults keep the modal's behaviour unchanged.
  controls = !muted,
  loop = muted,
  className,
}) {
  const videoRef = useRef(null);

  /**
   * Muting is set on the element rather than left to the attribute. React
   * does update the property, but a browser that paused on an unmute needs
   * play() called from the same gesture, and that has to happen here.
   */
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.muted = muted;
    if (!muted) element.play().catch(() => {});
  }, [muted]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return undefined;

    // Steam hands over an HLS manifest and nothing else, so that stays the
    // first branch and behaves exactly as before. PlayStation hands over a
    // plain mp4, which a feed slide for a store game passes straight through
    // as a string, and this effect used to bail on anything without `.hls`:
    // the element mounted with no source at all, so a store trailer was a
    // silent black box over the artwork.
    const file = typeof video === 'string' ? video : (video?.mp4 ?? null);
    if (!video?.hls && file) {
      element.src = file;
      // Muted autoplay is allowed, and the feed is always muted until asked
      // otherwise; an unmuted player needs the gesture effect below instead.
      element.play().catch(() => {});
      return () => {
        element.removeAttribute('src');
      };
    }

    if (!video?.hls) return undefined;

    let hls;
    let cancelled = false;

    if (element.canPlayType('application/vnd.apple.mpegurl')) {
      element.src = video.hls;
    } else {
      // The light build drops subtitle and alt-audio support the store
      // trailers never use, and halves the download.
      import('hls.js/light').then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        hls = new Hls({ maxBufferLength: 20 });
        hls.loadSource(video.hls);
        hls.attachMedia(element);
      });
    }

    return () => {
      cancelled = true;
      hls?.destroy();
      element.removeAttribute('src');
    };
  }, [video]);

  return (
    <video
      ref={videoRef}
      poster={poster}
      controls={controls}
      muted={muted}
      loop={loop}
      autoPlay
      playsInline
      className={className ?? 'h-full w-full bg-black object-contain'}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

/** Cents to a plain dollar saving, for a sentence rather than a table. */
const formatSaving = (cents) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

const storeLink = (game) =>
  game.psnStorePath
    ? `https://store.playstation.com/en-us/${game.psnStorePath}`
    : `https://store.playstation.com/en-us/search/${encodeURIComponent(game.title)}`;
const trailerSearchLink = (title) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${title} gameplay PS5`,
  )}`;

/**
 * The sheet every detail view lives in: a bottom sheet on a phone, a centred
 * dialog on a desktop. It owns the things that are easy to get subtly wrong —
 * the escape key, the background scroll lock, focus on open, and a grab handle
 * you can drag down to dismiss — so each modal only has to supply its body.
 */
function ModalSheet({ labelledBy, onClose, children }) {
  const [drag, setDrag] = useState(0);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  /**
   * Drag-to-dismiss, from the handle only. Dragging the whole sheet would
   * fight the scrolling inside it; the handle has nothing else to do.
   */
  const onDragStart = useCallback(
    (event) => {
      const startY = event.clientY;
      const target = event.currentTarget;
      target.setPointerCapture?.(event.pointerId);
      let travelled = 0;

      const onMove = (move) => {
        travelled = Math.max(0, move.clientY - startY);
        setDrag(travelled);
      };
      const onEnd = () => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onEnd);
        target.removeEventListener('pointercancel', onEnd);
        if (travelled > 110) onClose();
        else setDrag(0);
      };

      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onEnd);
      target.addEventListener('pointercancel', onEnd);
    },
    [onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={drag > 0 ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        // The content scrolls inside the sheet rather than the backdrop
        // scrolling behind it, which is what stops iOS rubber-banding the page
        // under an open dialog.
        className="panel-scroll relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white dark:bg-slate-900 pb-[var(--inset-bottom)] shadow-2xl animate-sheet-up sm:my-auto sm:max-h-[90dvh] sm:max-w-3xl sm:rounded-2xl sm:pb-0 sm:animate-pop-in"
      >
        {/* Grab handle: the standard way out of a sheet on a phone. */}
        <div
          onPointerDown={onDragStart}
          className="touch-only sticky top-0 z-20 flex h-6 cursor-grab touch-none items-center justify-center bg-gradient-to-b from-white to-transparent"
        >
          <span className="h-1 w-10 rounded-full bg-slate-300" />
        </div>

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="tap absolute right-3 top-8 z-10 inline-flex items-center justify-center rounded-full bg-slate-900/60 text-white transition-colors hover:bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:top-3 sm:h-9 sm:min-h-0 sm:w-9 sm:min-w-0"
        >
          <X className="h-5 w-5" />
        </button>

        {children}
      </div>
    </div>
  );
}

function GameModal({
  game,
  onHide,
  live,
  pool,
  byTitle,
  wishlisted,
  owned,
  reason,
  dealWatched,
  alertsArmed,
  onToggleDealAlert,
  onOpenAlerts,
  onToggleOwned,
  favouriteCreators,
  onToggleFavouriteCreator,
  onToggleWishlist,
  onOpen,
  onClose,
}) {
  const [selected, setSelected] = useState(null);

  // Ratings ship with the catalog; the nightly refresh overrides them.
  const ratings = live?.ratings ?? game.ratings;

  const videos = live?.videos ?? [];
  const screenshots = live?.screenshots ?? [];

  // Default view: the trailer's poster frame, falling back to key art.
  const view =
    selected ?? (videos[0] ? { kind: 'video-poster', video: videos[0] } : { kind: 'cover' });

  return (
    <ModalSheet labelledBy="game-modal-title" onClose={onClose}>
        {/* Media stage */}
        <div className="relative aspect-video w-full bg-slate-900">
          {view.kind === 'video' ? (
            <TrailerPlayer video={view.video} poster={view.video.thumbnail} />
          ) : view.kind === 'image' ? (
            <img
              src={view.src}
              alt={`Screenshot from ${game.title}`}
              className="h-full w-full object-contain"
            />
          ) : view.kind === 'video-poster' ? (
            <button
              type="button"
              onClick={() => setSelected({ kind: 'video', video: view.video })}
              className="group relative h-full w-full"
              aria-label={`Play ${view.video.name}`}
            >
              <img
                src={view.video.thumbnail}
                alt=""
                className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <CirclePlay
                  className="h-16 w-16 text-white drop-shadow-lg transition-transform group-hover:scale-110"
                  strokeWidth={1.25}
                />
              </span>
            </button>
          ) : (
            <CoverArt game={game} live={live} width={1280} className="h-full w-full" />
          )}
        </div>

        {/* Media thumbnails */}
        {(videos.length > 0 || screenshots.length > 0) && (
          <div className="flex gap-2 overflow-x-auto border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-3">
            {videos.map((video) => (
              <button
                key={video.id}
                type="button"
                onClick={() => setSelected({ kind: 'video', video })}
                title={video.name}
                className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md ring-1 ring-slate-200 dark:ring-slate-700 transition-transform hover:scale-105"
              >
                <img src={video.thumbnail} alt="" className="h-full w-full object-cover" />
                <CirclePlay className="absolute inset-0 m-auto h-6 w-6 text-white drop-shadow" />
              </button>
            ))}
            {screenshots.map((shot) => (
              <button
                key={shot.thumb}
                type="button"
                onClick={() => setSelected({ kind: 'image', src: shot.full })}
                className="h-14 w-24 shrink-0 overflow-hidden rounded-md ring-1 ring-slate-200 dark:ring-slate-700 transition-transform hover:scale-105"
              >
                <img src={shot.thumb} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="p-6 sm:p-8">
          {/* Stacked on a phone: side by side, the title wraps to two lines to
              make room for two buttons that fit fine on their own row. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <h2 id="game-modal-title" className="text-2xl font-bold text-slate-900 dark:text-slate-50 sm:pr-6">
              {game.title}
            </h2>
            <div className="flex shrink-0 items-center gap-2 sm:gap-1">
              <WishlistButton wishlisted={wishlisted} onToggle={onToggleWishlist} withLabel />
              <OwnedButton owned={owned} onToggle={onToggleOwned} withLabel />
              {onHide && (
                <button
                  type="button"
                  onClick={onHide}
                  aria-label={`Stop showing ${game.title}`}
                  title="Not for me"
                  className="tap inline-flex items-center justify-center rounded-lg px-2.5 text-sm text-slate-400 dark:text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 sm:h-9 sm:min-h-0"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {reason && (
            <p className="mt-3 inline-flex items-start gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 px-3 py-2 text-sm font-medium leading-relaxed text-indigo-700 dark:text-indigo-300">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Picked for you: {reason.charAt(0).toLowerCase() + reason.slice(1)}.</span>
            </p>
          )}

          {/* Price first, with the alert attached to it. Both used to sit
              under the metadata chips and the upgrade notes, which put the
              bell at y=1777 on an 844px screen: two screens of scrolling to
              reach the one control this app exists for. What a game costs is
              the thing you came to find out. */}
          <PricePanel game={game} live={live} />
          <DealAlertRow
            watching={dealWatched}
            live={live}
            armed={alertsArmed}
            onToggle={onToggleDealAlert}
            onSetUp={onOpenAlerts}
          />
          <PredictionPanel live={live} />

          <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4">
            {[
              ['Genre', game.genre],
              ['Protagonist', game.protagonist],
              ['Art Style', game.artStyle],
            ].map(([label, value]) => (
              <div key={label}>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {label}
                </span>
                <span className="font-medium text-slate-800 dark:text-slate-100">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <UpgradeBadge value={game.ps5Upgrade} className="whitespace-nowrap" />
            <RatingChips ratings={ratings} size="lg" />
          </div>

          <div className="mt-6 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
            <p className="leading-relaxed text-slate-700 dark:text-slate-200">{game.description}</p>
          </div>

          <RepresentationDetail representation={game.representation} />
          <AgeDetail ageRating={game.ageRating} />
          <ProsAndCons ratings={ratings} />

          <div className="mt-6">
            <a
              href={storeLink(game)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition-transform duration-200 ease-spring hover:bg-indigo-700 active:scale-95"
            >
              <ExternalLink className="h-4 w-4" />
              PS Store
            </a>
          </div>

          <WatchPanel
            game={game}
            favourites={favouriteCreators}
            onToggleFavourite={onToggleFavouriteCreator}
          />

          <GameNews title={game.title} />

          <SimilarGames game={game} pool={pool} byTitle={byTitle} onOpen={onOpen} />
        </div>
    </ModalSheet>
  );
}

/**
 * Live price. The figure comes from a PC storefront, which is the only one
 * that publishes prices openly, so it is labelled plainly rather than passed
 * off as the PlayStation Store price.
 */
/**
 * Whether today's price is actually any good.
 *
 * The app has been recording a price a night per game for weeks, and until now
 * none of it reached the screen: the panel showed what a game costs today and
 * left the only question that matters unanswered. Outer Wilds at $24.99 reads
 * fine until you know it was $14.99 sixteen days ago, and Disco Elysium at
 * $39.99 reads very differently once you know it was $9.99 last month.
 *
 * Everything here is measured, and the window is always stated, because a
 * month of observation is a month of observation and not "the lowest ever".
 */
function PriceHistoryNote({ price, history }) {
  const standing = priceStanding(price, history);
  if (!standing) return null;

  const { atLow, low, days, gap } = standing;
  const window = `${days} day${days === 1 ? '' : 's'} of tracking`;

  const when = new Date(`${low.date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <div
      className={`mt-2 w-full rounded-lg px-3 py-2 text-xs leading-relaxed ring-1 ring-inset ${
        atLow
          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-800'
          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 ring-amber-200 dark:ring-amber-800'
      }`}
    >
      <p className="font-semibold">
        {atLow
          ? `Lowest it has been in ${window}.`
          : `Cheaper before: ${low.formatted} on ${when}${low.discountPercent ? ` (${low.discountPercent}% off)` : ''}.`}
      </p>
      <p className="mt-0.5 text-[11px] opacity-80">
        {atLow
          ? history.saleCount > 0
            ? `${history.saleCount} sale${history.saleCount === 1 ? '' : 's'} seen in that time.`
            : 'No sale seen in that time.'
          : `${formatSaving(Math.abs(gap))} more than that today, over ${window}.`}
        {history.deepestDiscount > 0 &&
          ` Deepest cut seen: ${history.deepestDiscount}%.`}
      </p>
    </div>
  );
}

function PricePanel({ game, live }) {
  if (!live) {
    return (
      <p className="mt-6 flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking the PlayStation Store...
      </p>
    );
  }

  if (!live.price) {
    return (
      <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">
        No PlayStation Store price found for this title. Open the store listing to check.
      </p>
    );
  }

  const { price } = live;
  const saleEnds = price.saleEndsAt ? new Date(price.saleEndsAt) : null;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900 dark:text-slate-50">{price.finalFormatted}</span>
        {price.discountPercent > 0 && (
          <span className="text-sm text-slate-400 dark:text-slate-500 line-through">{price.initialFormatted}</span>
        )}
      </div>
      <DiscountBadge price={price} />
      <a
        href={storeLink(game)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-300 hover:underline"
      >
        Store
        <ArrowUpRight className="h-3.5 w-3.5" />
      </a>
      {saleEnds && (
        <p className="w-full text-xs font-medium text-rose-600 dark:text-rose-300">
          Sale ends {saleEnds.toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </p>
      )}
      <PriceHistoryNote price={price} history={live.history} />
    </div>
  );
}

/**
 * The predictor's own track record, fetched once and shared by every panel.
 *
 * It stays quiet until there is enough history to say anything, which is the
 * honest state for a while yet. When it does speak it is the only line here
 * that is measured rather than reasoned.
 */
let calibrationPromise = null;
function useCalibration() {
  const [calibration, setCalibration] = useState(null);
  useEffect(() => {
    let live = true;
    calibrationPromise ??= fetch('/api/backtest')
      .then((response) => response.json())
      .catch(() => null);
    calibrationPromise.then((value) => {
      if (live) setCalibration(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return calibration;
}

/**
 * The drop predictor's reasoning, shown in full. The score is a heuristic, so
 * the panel always says what produced it rather than asking for trust.
 */
function PredictionPanel({ live }) {
  const calibration = useCalibration();
  const prediction = live?.prediction;
  if (!prediction || prediction.verdict === 'unknown') return null;

  const history = live.history;

  // A game already in a subscription catalog has no drop question to answer,
  // so the panel states that instead of showing a probability of nothing.
  if (prediction.verdict === 'included') {
    return (
      <div className="mt-4 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Price outlook
          </h3>
          <VerdictBadge prediction={prediction} />
        </div>
        <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
          {prediction.reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-indigo-300" />
              {reason}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Price outlook
        </h3>
        <VerdictBadge prediction={prediction} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          role="meter"
          aria-valuenow={prediction.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Estimated chance of a lower price within 30 days"
        >
          <div
            className={`h-full rounded-full ${
              prediction.score >= 60
                ? 'bg-amber-500'
                : prediction.score >= 35
                  ? 'bg-slate-400'
                  : 'bg-emerald-500'
            }`}
            style={{ width: `${prediction.score}%` }}
          />
        </div>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{prediction.score}%</span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Estimated chance of a lower price in the next {prediction.horizonDays} days.
      </p>

      {prediction.depth && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          When it does drop, expect around{' '}
          <span className="font-semibold text-slate-900 dark:text-slate-50">{prediction.depth.percent}% off</span>
          {prediction.depth.basis === 'seen-before'
            ? ', the deepest cut recorded for it so far.'
            : ', the usual depth for a game this age, at the store\u2019s standard steps.'}
        </p>
      )}

      <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
        {prediction.reasons.map((reason) => (
          <li key={reason} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
            {reason}
          </li>
        ))}
      </ul>

      {history?.points?.length > 1 && (
        <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-3">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Recorded since {history.since} · lowest {history.lowest.formatted} on{' '}
            {history.lowest.date}
          </p>
          <PriceSparkline points={history.points} />
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
        A heuristic from release age, current discount, typical sale windows and the price
        history this site has recorded, not an announced sale. Confidence:{' '}
        {prediction.confidence}
        {prediction.confidence === 'low' && ', history is still being collected'}.
      </p>

      {calibration?.ready && (
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          Scored against what actually happened: over {calibration.samples} past moments it
          beat a base-rate guess by {calibration.skill > 0 ? '' : '−'}
          {Math.abs(calibration.skill).toFixed(3)} Brier
          {calibration.skill > 0 ? '' : ', meaning it is not yet earning its keep'}.
        </p>
      )}
    </div>
  );
}

/**
 * "Tell me when this goes on sale", per game.
 *
 * Separate from the wishlist on purpose. A wishlist is a list of things you
 * want; this is a list of things you are waiting on a price for, and they are
 * not the same list. Something can be worth an alert without being something
 * you have decided to buy, and plenty of wishlisted games you already own the
 * disc of.
 */
function DealAlertRow({ watching, live, armed, onToggle, onSetUp }) {
  const onSale = (live?.price?.discountPercent ?? 0) > 0;

  const label = watching
    ? armed
      ? onSale
        ? 'Watching this. You will hear when it drops further.'
        : 'Watching this. You will hear when a deal starts.'
      : // Promising an alert that has nowhere to go is the one thing this row
        // must not do. The game is saved either way; what is missing is a
        // channel, and saying so is the only way the reader can fix it.
        onSale
        ? 'Saved. Turn alerts on to hear if it drops further.'
        : 'Saved. Turn alerts on to hear when a deal starts.'
    : onSale
      ? 'Tell me if this gets cheaper still'
      : 'Tell me when this goes on sale';

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={watching}
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium ring-1 ring-inset transition-transform duration-200 ease-spring active:scale-[0.99] ${
          watching
            ? armed
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-800'
              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 ring-amber-200 dark:ring-amber-800'
            : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 ring-slate-200 dark:ring-slate-700 hover:bg-slate-100'
        }`}
      >
        {watching ? (
          <BellRing className="h-4 w-4 shrink-0" />
        ) : (
          <Bell className="h-4 w-4 shrink-0" />
        )}
        <span className="flex-1">{label}</span>
        {watching && armed && <Check className="h-4 w-4 shrink-0" />}
      </button>

      {watching && !armed && (
        <button
          type="button"
          onClick={onSetUp}
          className="mt-1.5 inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-indigo-600 dark:text-indigo-300 transition-transform duration-200 ease-spring active:scale-95 hover:underline"
        >
          <Bell className="h-4 w-4" />
          Turn alerts on
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}


function WishlistButton({ wishlisted, onToggle, withLabel = false }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      aria-pressed={wishlisted}
      aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors sm:h-8 ${
        wishlisted
          ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 hover:bg-rose-100'
          : 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 hover:text-slate-600'
      }`}
    >
      <Heart className={`h-4 w-4 ${wishlisted ? 'fill-current' : ''}`} />
      {withLabel && (wishlisted ? 'Wishlisted' : 'Wishlist')}
    </button>
  );
}

/**
 * Marks a game as already owned. Kept next to the wishlist heart because the
 * two are the same decision from opposite ends: one is "someday", the other is
 * "already done" — and either way the game should stop competing for attention.
 */
function OwnedButton({ owned, onToggle, withLabel = false }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      aria-pressed={owned}
      aria-label={owned ? 'Remove from library' : 'Add to library'}
      title={owned ? 'In your library' : 'Mark as owned'}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors sm:h-8 ${
        owned
          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100'
          : 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 hover:text-slate-600'
      }`}
    >
      <CircleCheck className="h-4 w-4" />
      {withLabel && (owned ? 'In library' : 'I own it')}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

/** A date still ahead of us, which is the only kind worth printing on a card. */
const isUnreleased = (iso) => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) && at > Date.now();
};

const releaseLabel = (iso) =>
  new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });

function GameCard({
  game,
  live,
  wishlisted,
  owned,
  reason,
  saving,
  actions = true,
  onToggleWishlist,
  onOpen,
}) {
  const ratings = live?.ratings ?? game.ratings;
  const standing = priceStanding(live?.price, live?.history);
  const unreleased = isUnreleased(game.releaseDate);

  return (
    <div className="card-skip group relative flex h-full animate-rise-in flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm transition-all duration-200 ease-spring hover:-translate-y-1 hover:shadow-lg focus-within:ring-2 focus-within:ring-indigo-500 active:scale-[0.98]">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col text-left focus:outline-none"
      >
        <div className="relative aspect-[460/215] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
          <CoverArt game={game} live={live} className="h-full w-full" />
          {live?.videos?.length > 0 && (
            <span className="absolute bottom-2 right-2 rounded-full bg-slate-900/70 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <CirclePlay className="h-4 w-4" />
            </span>
          )}
          {live?.price?.discountPercent > 0 && !owned && (
            <span className="absolute left-2 top-2">
              <DiscountBadge price={live.price} />
            </span>
          )}
          {owned && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
              <CircleCheck className="h-3 w-3" />
              Owned
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-2.5 sm:p-4">
          {/* One quiet row, not three loud ones. A card used to carry up to
              six chips in five colours — genre, upgrade type, a drop verdict,
              representation, an age badge and two scores — stacked above two
              truncated lines of description, which left the price as the
              smallest and last thing on a card in an app about prices. All of
              it is still on the open game, where there is room for it. What is
              left here is what you scan by: the name, a muted line of context,
              and the price. */}
          {/* Always two lines tall, whether the title needs them or not.
              The grid equalises the height of a row, so a one-line title next
              to a two-line one left its card stretched with a band of nothing
              between the genre and the price. Reserving the second line makes
              the two cards the same height for the same reason. */}
          <h2 className="mb-1.5 line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-tight text-slate-800 dark:text-slate-100 sm:min-h-[3rem] sm:pr-7 sm:text-base">
            {game.title}
          </h2>
          {/* Assembled as a list and joined, rather than each part carrying
              its own leading separator. Thirteen of every hundred store rows
              have no genre, and those used to read as "· 4.9" with the dot
              hanging off the front of the line.

              The store's star rating waits for ten votes: five-from-one-vote
              is the commonest number in the mirror and the least telling. */}
          <p className="mb-2 flex items-center gap-1.5 overflow-hidden text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {[
              game.genre ? (
                <span key="genre" className="truncate">
                  {game.genre}
                </span>
              ) : null,
              ratings?.critic != null ? (
                <span key="critic" className="shrink-0 tabular-nums">
                  {ratings.critic}
                </span>
              ) : null,
              isKidFriendly(game.ageRating) ? (
                <Baby key="kids" className="h-3 w-3 shrink-0" aria-label="Kid friendly" />
              ) : null,
              game.stars != null && (game.votes ?? 0) >= 10 ? (
                <span
                  key="stars"
                  className="inline-flex shrink-0 items-center gap-0.5 tabular-nums"
                  title={`${game.stars.toFixed(1)} out of 5 from ${game.votes.toLocaleString()} players`}
                >
                  <Star className="h-3 w-3" />
                  {game.stars.toFixed(1)}
                </span>
              ) : null,
            ]
              .filter(Boolean)
              .flatMap((part, index) =>
                index === 0
                  ? [part]
                  : [
                      <span key={`sep-${part.key}`} aria-hidden="true">
                        ·
                      </span>,
                      part,
                    ],
              )}
          </p>
          {reason && (
            <p className="mb-2 line-clamp-2 text-[11px] font-medium leading-relaxed text-indigo-600 dark:text-indigo-300">
              <Sparkles className="mr-1 inline h-3 w-3 align-[-1px]" />
              {reason}
            </p>
          )}
          {/* The price row is always here, even before a price arrives and
              even when none ever will. It used to render only once a price
              existed, which meant every card in the grid grew by a line as
              its chunk landed — the whole page shuffling under your thumb
              while you were reading it — and the fifty titles the store has
              no readable price for just ended early with no explanation. */}
          <div className="mt-auto min-h-[2.25rem] pr-10 pt-2">
            {live?.price ? (
              <>
                {/* A price you do not have to pay is not the headline. If a
                    Plus tier covers the game, that is the answer, and the
                    price it would otherwise cost goes quiet beside it. */}
                {live.price.plus?.included ? (
                  <p className="flex items-baseline gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-white">
                      PS Plus
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500 line-through">
                      {live.price.finalFormatted}
                    </span>
                  </p>
                ) : (
                  <p className="flex items-baseline gap-1.5">
                    <span className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-50 sm:text-lg">
                      {live.price.finalFormatted}
                    </span>
                    {live.price.discountPercent > 0 && (
                      <span className="text-xs text-slate-400 dark:text-slate-500 line-through">
                        {live.price.initialFormatted}
                      </span>
                    )}
                  </p>
                )}
                {/* The depth of a cut says nothing on its own. Sorting Best
                    deals by discount puts 50% off at the top whether that is
                    the floor or half what it went for last month, and this is
                    the difference, in the two words a card has room for. */}
                {unreleased ? (
                  <p className="mt-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300">
                    Out {releaseLabel(game.releaseDate)}
                  </p>
                ) : null}
                {standing && (
                  <p
                    className={`mt-1 text-[11px] font-semibold ${
                      standing.atLow ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {standing.atLow
                      ? 'Lowest yet'
                      : `Was ${standing.low.formatted}`}
                  </p>
                )}
                {saving > 0 && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                    {formatSaving(saving)} cheaper than when you added it
                  </p>
                )}
              </>
            ) : live ? (
              // The chunk arrived and carried no price: the store has no page
              // we can read for this one. Saying so beats an empty gap.
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Price not tracked</p>
            ) : (
              // Still in flight. A bar the width of a price keeps the card the
              // same height it will be a moment from now.
              <span
                aria-hidden="true"
                className="block h-4 w-14 animate-pulse rounded bg-slate-100 dark:bg-slate-800"
              />
            )}
          </div>
        </div>
      </button>

      {/* One control on a card, not six.
          
          Every card carried three: a hover rail for pointers and a bordered
          row of three full-width targets for touch. Forty eight cards made
          that a hundred and forty four buttons on one screen, and the row was
          the loudest thing on it. Owning and hiding a game are things you do
          once, from the game itself, so they live in its page now; wanting
          one is the thing you do while scanning, so it stays here.
          
          It sits over the price row rather than below it, so losing the rail
          took forty four pixels off every card instead of moving them. */}
      {actions && (
        <button
          type="button"
          onClick={onToggleWishlist}
          aria-pressed={wishlisted}
          aria-label={wishlisted ? `Remove ${game.title} from wishlist` : `Add ${game.title} to wishlist`}
          className={`tap absolute bottom-1 right-1 z-10 inline-flex items-center justify-center rounded-full transition-all duration-200 ease-spring active:scale-90 ${
            wishlisted
              ? 'text-rose-500'
              : 'text-slate-300 dark:text-slate-600 hover:text-rose-400'
          }`}
        >
          <Heart className={`h-[22px] w-[22px] ${wishlisted ? 'fill-current' : ''}`} />
        </button>
      )}
    </div>
  );
}

function EmptyState({ filters, wishlist, library, status, onClear, onSearchStore }) {
  if (filters.collection === 'genius' && library.size === 0 && wishlist.size === 0) {
    return (
      <div className="py-20 text-center text-slate-500 dark:text-slate-400">
        <Sparkles className="mx-auto mb-3 h-8 w-8 text-indigo-300" />
        <p className="text-lg text-slate-700 dark:text-slate-200">Nothing to work from yet.</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed">
          Tick the check on a few games you already own, or heart the ones you want. Picks
          appear as soon as there is one, and get sharper with every game you add.
        </p>
      </div>
    );
  }

  // Name the thing that actually emptied the list. Searching a word nothing
  // matches used to be reported as "no games matching those filters", followed
  // by a tip about PS5-only titles being hidden, which was both the wrong
  // diagnosis and the wrong remedy: no PS5 toggle brings back a word that is
  // not in the catalog.
  const query = filters.q.trim();
  const searching = query.length > 0;

  return (
    <div className="py-20 text-center text-slate-500 dark:text-slate-400">
      <Sparkles className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
      <p className="text-lg text-slate-700 dark:text-slate-200">
        {searching ? `Nothing here matches “${query}”.` : 'No games match these filters.'}
      </p>

      {searching ? (
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed">
          {filters.collection === 'all'
            ? 'It may still be in the wider store.'
            : 'You are inside a collection, so this only searched part of the catalog.'}
        </p>
      ) : (
        <>
          {filters.wishlist && wishlist.size === 0 && (
            <p className="mt-1 text-sm">Your wishlist is empty. Tap the heart on any card.</p>
          )}
          {filters.atFloor && (
            <p className="mt-1 text-sm">
              Nothing here is at its lowest recorded price right now.
            </p>
          )}
          {!filters.includePs5 && (
            <p className="mt-1 text-sm">PS5-only titles are hidden. Turn them on to see more.</p>
          )}
          {filters.sale && status === 'loading' && (
            <p className="mt-1 text-sm">Still checking prices, so more may appear.</p>
          )}
        </>
      )}

      <div className="mt-5 flex flex-col items-center gap-3">
        {/* When a search came up empty the whole store is the useful next move,
            so it belongs here rather than orphaned at the foot of the page. */}
        {searching && onSearchStore && (
          <button
            type="button"
            onClick={onSearchStore}
            className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-transform duration-200 ease-spring active:scale-95 hover:bg-indigo-700"
          >
            <Search className="h-4 w-4" />
            Look in the whole store
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          className="font-medium text-indigo-600 dark:text-indigo-300 hover:underline"
        >
          {searching ? 'Clear search and filters' : 'Clear all filters'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Watch it first
 * ------------------------------------------------------------------ */

const FAVOURITE_CREATORS_KEY = 'favouriteCreators';

/**
 * YouTube lets you search inside a single channel, which turns "has this
 * person played it" into one link rather than a search you have to sift.
 */
const creatorSearchLink = (handle, title) =>
  `https://www.youtube.com/@${handle}/search?query=${encodeURIComponent(title)}`;

const reviewSearchLink = (title) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} review`)}`;

const creatorsByHandle = Object.fromEntries(creatorsData.map((creator) => [creator.handle, creator]));

/**
 * Whose take on a game you want.
 *
 * Every creator this app tracks is a woman, trans, or non-binary, so the
 * coverage list already reads from outside the default games-press voice.
 * These narrow it further when you want a specific vantage point, and they
 * match on the identity each creator states for themselves rather than on
 * anything inferred.
 */
const CREATOR_LENSES = [
  { value: 'any', label: 'Anyone', match: () => true },
  {
    value: 'women',
    // Matches the stated word, never pronouns. Including "she/they" here put a
    // creator whose stated identity is "non-binary (she/they)" under Women,
    // which is the pronoun-based inference this file claims not to make. A
    // pronoun is not an identity, and non-binary is not a subset of women.
    label: 'Women',
    match: (creator) => /\bwom(a|e)n\b/i.test(creator.identity ?? ''),
  },
  {
    value: 'trans',
    label: 'Trans & non-binary',
    match: (creator) => /trans|non-binary|transmasc/i.test(creator.identity ?? ''),
  },
];

const lensFor = (value) => CREATOR_LENSES.find((lens) => lens.value === value) ?? CREATOR_LENSES[0];

/** A real video, so the link lands on the video rather than a profile page. */
const videoLink = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

/**
 * Who has actually covered this game.
 *
 * The catalog carries verified coverage: every creator's uploads were indexed
 * and matched against game titles, so this is a list of videos that exist
 * rather than a guess from genre. Starred creators come first.
 */
function WatchPanel({ game, favourites, onToggleFavourite }) {
  const [showAll, setShowAll] = useState(false);
  const [lensValue, setLensValue] = useState('any');
  const lens = lensFor(lensValue);

  const covered = useMemo(() => {
    const entries = (game.coverage ?? [])
      .map((entry) => ({ ...entry, creator: creatorsByHandle[entry.handle] }))
      .filter((entry) => entry.creator && lens.match(entry.creator));
    return entries.sort(
      (a, b) =>
        Number(favourites.has(b.handle)) - Number(favourites.has(a.handle)) || b.videos - a.videos,
    );
  }, [game, favourites, lens]);

  // The searchable list follows the same lens, so picking one narrows both
  // what has been found and what is offered to look for.
  const uncovered = useMemo(
    () =>
      creatorsData
        .filter((creator) => lens.match(creator))
        .filter((creator) => !covered.some((entry) => entry.handle === creator.handle)),
    [covered, lens],
  );

  // How many videos the lens is hiding, so narrowing never looks like nothing
  // exists when in fact it was filtered out.
  const totalCovered = (game.coverage ?? []).filter((entry) => creatorsByHandle[entry.handle]).length;

  return (
    <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Watch it first
      </h3>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <a
          href={reviewSearchLink(game.title)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-transform duration-200 ease-spring hover:bg-rose-700 active:scale-95"
        >
          <CirclePlay className="h-4 w-4" />
          Reviews
        </a>
        <a
          href={trailerSearchLink(game.title)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-transform duration-200 ease-spring hover:bg-slate-900 active:scale-95"
        >
          <CirclePlay className="h-4 w-4" />
          Gameplay
        </a>
      </div>

      <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
        {CREATOR_LENSES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setLensValue(entry.value)}
            aria-pressed={lensValue === entry.value}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
              lensValue === entry.value
                ? 'bg-violet-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {covered.length > 0 ? (
        <>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            {covered.length === 1 ? 'One creator has' : `${covered.length} creators have`} played
            this. Each link opens their actual video.
            {covered.length < totalCovered &&
              ` ${totalCovered - covered.length} more hidden by this lens.`}
          </p>
          <ul className="space-y-1.5">
            {covered.map((entry) => (
              <li key={entry.handle} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggleFavourite(entry.handle)}
                  aria-pressed={favourites.has(entry.handle)}
                  aria-label={`${favourites.has(entry.handle) ? 'Unstar' : 'Star'} ${entry.creator.name}`}
                  className={`shrink-0 rounded p-1 transition-transform duration-200 ease-spring active:scale-90 ${
                    favourites.has(entry.handle)
                      ? 'text-amber-500'
                      : 'text-slate-300 dark:text-slate-600 hover:text-slate-500'
                  }`}
                >
                  <Star className={`h-4 w-4 ${favourites.has(entry.handle) ? 'fill-current' : ''}`} />
                </button>
                <a
                  href={videoLink(entry.videoId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100 group-hover:text-indigo-600">
                        {entry.creator.name}
                      </span>
                      <span className="text-[11px] text-violet-600 dark:text-violet-300">{entry.creator.identity}</span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {entry.videos === 1 ? '1 video' : `${entry.videos} videos`}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {entry.videoTitle}
                    </span>
                  </span>
                  <CirclePlay className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600 group-hover:text-rose-600" />
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          {totalCovered > 0
            ? `${totalCovered} tracked ${totalCovered === 1 ? 'creator has' : 'creators have'} played this, but none matching this lens.`
            : 'None of the tracked creators has a video for this one.'}
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowAll((open) => !open)}
        className="mt-3 text-xs font-medium text-indigo-600 dark:text-indigo-300 hover:underline"
      >
        {showAll
          ? 'Hide'
          : `Search the other ${uncovered.length} ${uncovered.length === 1 ? 'channel' : 'channels'}`}
      </button>

      {showAll && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {uncovered.map((creator) => (
            <li key={creator.handle}>
              <a
                href={creatorSearchLink(creator.handle, game.title)}
                target="_blank"
                rel="noopener noreferrer"
                title={`${creator.identity}: ${creator.note}`}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-200"
              >
                {creator.name}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
        Coverage comes from indexing every tracked creator's uploads and matching them to this
        title, so these are videos that exist rather than a guess. Channels with no match are
        searchable above in case they posted since. Every creator here is a woman, trans or
        non-binary, and the lens matches what each states for themselves.
      </p>
    </div>
  );
}

/**
 * "More like this": scores every other game against one you are looking at.
 * Weighted so that the things you actually browse by — the curated tags and
 * the genre — matter more than incidental matches like protagonist.
 */
function similarGames(game, pool, limit = 4) {
  const tags = new Set(game.tags ?? []);
  const scored = [];

  for (const other of pool) {
    if (other.id === game.id) continue;
    let score = 0;
    if (other.genre === game.genre) score += 3;
    for (const tag of other.tags ?? []) if (tags.has(tag)) score += 2;
    if (other.artStyle === game.artStyle) score += 2;
    if (other.protagonist === game.protagonist) score += 1;
    if (other.ageRating?.family === game.ageRating?.family) score += 1;
    if (score >= 4) scored.push({ other, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.other.title.localeCompare(b.other.title))
    .slice(0, limit)
    .map((entry) => entry.other);
}

/**
 * What the press has been saying about this one game.
 *
 * The merged publisher feeds only carry the last day or so, which is no help
 * when you open a game whose moment was last month, so a single game's news
 * comes from a search across the whole press instead. Nothing is fetched until
 * the modal is open, which is the only time it is worth asking.
 */
function GameNews({ title }) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  // Scoped by masthead, which is the only honest way to do it: each of these
  // sites is an LGBTQ+ outlet or a worker-owned one founded by queer writers.
  // There is no filter here claiming to find pieces written by a woman, since
  // a feed does not carry that and guessing from a byline is guessing at
  // someone's identity. Women critics are surfaced in the list above instead.
  const [queerOnly, setQueerOnly] = useState(false);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react/set-state-in-effect
    setState({ status: 'loading', items: [] });
    const scope = queerOnly ? '&perspective=queer' : '';
    fetch(`/api/news?game=${encodeURIComponent(title)}${scope}`)
      .then((response) => response.json())
      .then((payload) => {
        if (live) setState({ status: 'ready', items: payload.items ?? [] });
      })
      .catch(() => {
        if (live) setState({ status: 'error', items: [] });
      });
    return () => {
      live = false;
    };
  }, [title, queerOnly]);

  const toggle = (
    <div className="mb-3 flex gap-1.5">
      {[
        [false, 'All press'],
        [true, 'Queer & worker-owned'],
      ].map(([value, label]) => (
        <button
          key={String(value)}
          type="button"
          onClick={() => setQueerOnly(value)}
          aria-pressed={queerOnly === value}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
            queerOnly === value
              ? 'bg-violet-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (state.status === 'loading') {
    return (
      <div className="mt-8 border-t border-slate-100 dark:border-slate-800 pt-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          <Newspaper className="h-4 w-4" />
          In the news
        </h3>
        {toggle}
        <p className="flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking the press...
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 border-t border-slate-100 dark:border-slate-800 pt-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        <Newspaper className="h-4 w-4" />
        In the news
      </h3>
      {toggle}
      {state.items.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-slate-500">
          {state.status === 'error'
            ? 'Could not reach the press just now.'
            : queerOnly
              ? 'Nothing from the queer or worker-owned press on this one yet.'
              : 'Nothing in the press on this one right now.'}
        </p>
      )}
      <ul className="space-y-1.5">
        {state.items.map((item) => (
          <li key={item.link}>
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-baseline gap-2 rounded-lg px-2 py-1.5 -mx-2 transition-colors hover:bg-slate-50"
            >
              <span className="shrink-0 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                {item.source}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-snug text-slate-700 dark:text-slate-200 group-hover:text-slate-900">
                {item.title}
              </span>
              <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                {relativeTime(item.publishedAt)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SimilarGames({ game, pool, byTitle, onOpen }) {
  const similar = useMemo(() => similarGames(game, pool), [game, pool]);
  if (similar.length === 0) return null;

  return (
    <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        More like this
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {similar.map((other) => {
          const live = byTitle.get(other.title);
          return (
            <button
              key={other.id}
              type="button"
              onClick={() => onOpen(other.id)}
              className="group overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 text-left transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:shadow-md active:scale-95"
            >
              <div className="aspect-[460/215] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                <CoverArt game={other} live={live} className="h-full w-full" />
              </div>
              <div className="p-2">
                <p className="line-clamp-2 text-xs font-semibold leading-tight text-slate-700 dark:text-slate-200">
                  {other.title}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{other.genre}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Feed view
 * ------------------------------------------------------------------ */


/**
 * Wide media for a store game, read once per concept and kept for the session.
 *
 * The mirror carries one image per game: the vertical capsule, 460px wide.
 * Stretched across a phone it is a crop of a crop, and it was all a store
 * slide ever had, which is why the feed went flat the moment the library
 * became the whole store rather than the written-up few: those still had
 * Steam's wide screenshots and their trailer, and the other eight thousand
 * had neither. The concept page already carries eight screenshots and the
 * trailer, and the endpoint already returns them. A slide only has to ask,
 * and only once it is nearly on screen.
 */
const conceptMedia = new Map();
const conceptMediaInFlight = new Map();

function useConceptMedia(storeId, enabled) {
  const [media, setMedia] = useState(() => (storeId ? conceptMedia.get(storeId) ?? null : null));

  useEffect(() => {
    if (!enabled || !storeId) return undefined;
    const cached = conceptMedia.get(storeId);
    if (cached) {
      // eslint-disable-next-line react/set-state-in-effect
      setMedia(cached);
      return undefined;
    }

    let alive = true;
    const read =
      conceptMediaInFlight.get(storeId) ??
      fetch(`/api/concept?id=${storeId}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => ({
          shots: (payload?.screenshots ?? []).filter(Boolean),
          trailer: payload?.trailer ?? null,
        }))
        .catch(() => ({ shots: [], trailer: null }))
        .then((value) => {
          // Remembered either way: a slide with no screenshot still has its
          // key art, so a failed read costs a flourish rather than the card,
          // and scrolling past it again should not ask a second time.
          conceptMedia.set(storeId, value);
          conceptMediaInFlight.delete(storeId);
          return value;
        });
    conceptMediaInFlight.set(storeId, read);
    read.then((value) => {
      if (alive) setMedia(value);
    });

    return () => {
      alive = false;
    };
  }, [storeId, enabled]);

  return media;
}

/**
 * One full-screen card in the feed. Snap points do the paging, so this only
 * has to look right and get out of the way — the art runs edge to edge and
 * the text sits over a gradient rather than in a panel.
 */
function FeedSlide({
  game,
  live,
  wishlisted,
  reason,
  actions = true,
  muted,
  onToggleMuted,
  onToggleWishlist,
  onOpen,
}) {
  // The trailer plays only while this slide is the one on screen, and starts
  // muted the way a feed does. Anything off screen is torn down so a long
  // scroll never leaves a stack of decoding videos behind.
  const slideRef = useRef(null);
  const [centred, setCentred] = useState(false);

  useEffect(() => {
    const element = slideRef.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setCentred(entry.isIntersecting),
      { threshold: 0.6 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Media is read a screen early so a slide is already dressed by the time it
  // arrives, rather than swapping its background in under the reader. Once a
  // slide has been near it stays near: the answer is cached, and re-arming
  // would only ask again.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = slideRef.current;
    if (!element || near) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNear(true);
      },
      { rootMargin: '150% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  // A wide screenshot fills the screen far better than the 460px capsule, so
  // use one as soon as the live data arrives and fall back until then.
  // Asked for the trailer, mostly. The screenshots come back with it and
  // stand in where a store row has no art at all, but a row almost always has
  // some and it is better than they are: see the note on the background.
  const storeMedia = useConceptMedia(game.storeId, near && !(live?.screenshots?.length > 0));
  const dataSaver = useDataSaver();

  // The order here is about what each source actually is, which is not what
  // the shape of the code suggests.
  //
  // A written-up game falls back to Steam's header.jpg, and that really is a
  // 460x215 capsule, so one of Steam's screenshots fills a phone far better.
  // That is what the first line is for, and the note this replaces was
  // written for that case.
  //
  // A store row is not that case. `heroImage` holds PlayStation's own key
  // art, which the mirror carries at 3840x2160, 16:9, measured at eight of
  // eight: already the wide hero a capsule is not, and drawn by someone paid
  // to make the game look good. A gameplay screenshot is a lateral move at
  // best and often a downgrade, which is plain on Sly 3, where bold character
  // art became a dark and murky frame. So the key art goes ahead of the
  // screenshots and they stand in only where a row has no art at all.
  const background =
    live?.screenshots?.[0]?.full ??
    atWidth(live?.heroImage, 1280) ??
    atWidth(storeMedia?.shots?.[0], 1280) ??
    (game.steamAppId
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId}/header.jpg`
      : null);
  const ratings = live?.ratings ?? game.ratings;
  const price = live?.price;
  const standing = priceStanding(price, live?.history);

  const trailer = live?.videos?.[0] ?? storeMedia?.trailer ?? null;

  return (
    <section
      ref={slideRef}
      className="feed-slide relative flex h-full w-full items-end overflow-hidden bg-slate-900"
    >
      {background ? (
        <img
          src={background}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full scale-105 object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600" />
      )}
      {centred && trailer && !dataSaver && (
        <TrailerPlayer
          video={trailer}
          poster={background}
          muted={muted}
          // A feed slide loops and never shows the browser's own controls,
          // whether or not the sound is on.
          controls={false}
          loop
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-slate-950/10" />

      <div className="relative w-full p-5 pb-[calc(6rem+var(--inset-bottom))] sm:p-8 sm:pb-[calc(6.5rem+var(--inset-bottom))]">
        <div className="mx-auto flex max-w-3xl items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-white/15 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
                {game.genre}
              </span>
              <span className="rounded-md bg-white/15 px-2 py-1 text-xs font-semibold text-white backdrop-blur">
                {game.ps5Upgrade}
              </span>
              {price?.discountPercent > 0 && (
                <span className="rounded-md bg-rose-600 px-2 py-1 text-xs font-bold text-white">
                  -{price.discountPercent}%
                </span>
              )}
              {standing && (
                <span
                  className={`rounded-md px-2 py-1 text-xs font-bold text-white backdrop-blur ${
                    standing.atLow ? 'bg-emerald-600' : 'bg-amber-600/90'
                  }`}
                >
                  {standing.atLow ? 'Lowest yet' : `Was ${standing.low.formatted}`}
                </span>
              )}
            </div>

            <h2 className="text-3xl font-bold leading-tight text-white drop-shadow sm:text-5xl">
              {game.title}
            </h2>

            {reason && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-indigo-500/25 px-3 py-1 text-sm font-medium text-white ring-1 ring-inset ring-white/25 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                {reason}
              </p>
            )}

            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/80 sm:text-base">
              {game.description}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/90">
              {ratings?.critic != null && (
                <span className="inline-flex items-center gap-1.5">
                  <Star className="h-4 w-4" /> {ratings.critic} critics
                </span>
              )}
              {ratings?.user && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4" /> {ratings.user.percentPositive}% players
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Baby className="h-4 w-4" />
                {(FAMILY_TIERS[game.ageRating?.family ?? 'unknown'] ?? FAMILY_TIERS.unknown).label}
              </span>
              {price && (
                <span className="inline-flex items-baseline gap-2 font-semibold">
                  {price.finalFormatted}
                  {price.discountPercent > 0 && (
                    <span className="text-xs font-normal text-white/50 line-through">
                      {price.initialFormatted}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Action rail, thumb-reachable on a phone.
              
              Three things, not five. Marking a game owned and opening its
              store page both sat here and both already live on the game's
              own page, which is one tap away through the middle button. What
              is left is what you actually do while scrolling: want it, look
              at it, hear it. */}
          <div className="flex shrink-0 flex-col items-center gap-3">
            {actions && (
              <>
            <button
              type="button"
              onClick={onToggleWishlist}
              aria-pressed={wishlisted}
              aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
              className={`rounded-full p-3 backdrop-blur transition-transform duration-200 ease-spring active:scale-90 ${
                wishlisted ? 'bg-rose-600 text-white' : 'bg-white/15 text-white hover:bg-white/25'
              }`}
            >
              <Heart className={`h-5 w-5 ${wishlisted ? 'fill-current' : ''}`} />
            </button>
              </>
            )}
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Details for ${game.title}`}
              className="rounded-full bg-white/15 p-3 text-white backdrop-blur transition-transform duration-200 ease-spring hover:bg-white/25 active:scale-90"
            >
              <Info className="h-5 w-5" />
            </button>
            {trailer && (
              <button
                type="button"
                onClick={onToggleMuted}
                aria-pressed={!muted}
                aria-label={muted ? 'Turn trailer sound on' : 'Turn trailer sound off'}
                className={`rounded-full p-3 text-white backdrop-blur transition-transform duration-200 ease-spring active:scale-90 ${
                  muted ? 'bg-white/15 hover:bg-white/25' : 'bg-white/90 text-slate-900 dark:text-slate-50 hover:bg-white'
                }`}
              >
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * What has changed since you saved something. A game can slip, get pulled
 * forward, or simply come out; all three are worth a word.
 */
function releaseUpdates(saved, upcoming) {
  if (!upcoming || saved.size === 0) return [];
  const current = new Map(
    [...(upcoming.games ?? []), ...(upcoming.recent ?? [])].map((game) => [game.id, game]),
  );

  const updates = [];
  for (const row of saved.values()) {
    const now = current.get(row.id);
    if (!now) continue;
    const wasOut = new Date(row.releaseDate).getTime() <= Date.now();
    const isOut = new Date(now.releaseDate).getTime() <= Date.now();

    if (now.releaseDate !== row.releaseDate) {
      const later = new Date(now.releaseDate) > new Date(row.releaseDate);
      updates.push({
        id: row.id,
        title: now.title,
        kind: later ? 'delayed' : 'moved-up',
        from: row.releaseDate,
        to: now.releaseDate,
      });
    } else if (isOut && !wasOut) {
      updates.push({ id: row.id, title: now.title, kind: 'out', to: now.releaseDate });
    }
  }
  return updates;
}

const UPDATE_TEXT = {
  delayed: (update) =>
    `Delayed to ${new Date(update.to).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`,
  'moved-up': (update) =>
    `Moved up to ${new Date(update.to).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`,
  out: () => 'Out now',
};

/**
 * Phone navigation.
 *
 * A 390pt screen cannot hold a wordmark, a search field and four icon buttons
 * on one row without squeezing the search down to two characters, and a bar
 * across the bottom is where a hand actually rests. Pointer layouts keep the
 * single header row and never see this.
 */
function BottomBar({ view, onView, onBriefing, onSurprise, canSurprise, updates }) {
  const items = [
    { key: 'grid', label: 'Browse', icon: LayoutGrid, active: view === 'grid' },
    { key: 'feed', label: 'Feed', icon: Rows3, active: view === 'feed' },
    { key: 'goss', label: 'Goss', icon: Flame, badge: updates },
    { key: 'surprise', label: 'Tonight', icon: Dices, disabled: !canSurprise },
  ];

  return (
    <nav
      aria-label="Sections"
      className="touch-only fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 pb-[var(--inset-bottom)] backdrop-blur"
    >
      <div className="flex">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            aria-current={item.active ? 'page' : undefined}
            onClick={() => {
              if (item.key === 'goss') onBriefing();
              else if (item.key === 'surprise') onSurprise();
              else onView(item.key);
            }}
            className={`relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 transition-colors active:bg-slate-100 disabled:opacity-40 ${
              item.active ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <item.icon className={`h-[22px] w-[22px] ${item.active ? 'stroke-[2.4]' : ''}`} />
            <span className="text-[10px] font-semibold tracking-tight">{item.label}</span>
            {item.badge > 0 && (
              <span className="absolute right-[26%] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ *
 * Tonight
 * ------------------------------------------------------------------ */

/**
 * Moods, defined against things the catalog actually knows. Each one is a
 * filter plus the sentence it puts under the pick, so a choice always comes
 * with a reason rather than arriving out of nowhere.
 */
const MOODS = [
  {
    value: 'cozy',
    label: 'Something cozy',
    emoji: '\u{1F343}',
    match: (game) => game.tags?.includes('cozy'),
    why: 'Low stakes, gentle pacing, nothing to lose.',
  },
  {
    value: 'story',
    label: 'A good story',
    emoji: '\u{1F4D6}',
    match: (game) =>
      game.genre === 'Narrative' ||
      (game.ratings?.pros ?? []).some((pro) => pro.label === 'Story and writing'),
    why: 'Players single out the writing on this one.',
  },
  {
    value: 'queer',
    label: 'Queer stories',
    emoji: '\u{1F308}',
    match: (game) =>
      game.tags?.includes('queer') ||
      (game.representation ?? []).some((entry) => entry.kind === 'queer'),
    why: 'Queer characters or relationships that matter to the plot.',
  },
  {
    value: 'people',
    label: 'With people',
    emoji: '\u{1F3AE}',
    match: (game) => game.tags?.includes('social'),
    why: 'Built for co-op, couch play or playing alongside someone.',
  },
  {
    value: 'beautiful',
    label: 'Something beautiful',
    emoji: '\u{2728}',
    match: (game) => game.tags?.includes('graphics'),
    why: 'On the list for its art direction, not just its tech.',
  },
  {
    value: 'any',
    label: 'Anything good',
    emoji: '\u{1F3B2}',
    match: () => true,
    why: 'Highly rated, and you have not ruled it out.',
  },
];

/** Quality tips the coin when several games fit the mood equally well. */
const moodScore = (game) => {
  const critic = game.ratings?.critic ?? 75;
  const user = game.ratings?.user?.percentPositive ?? 80;
  return (critic / 100 + user / 100) / 2;
};

/**
 * "What should I actually play tonight."
 *
 * Genius picks answers what to buy. Nothing answered the other question, which
 * for anyone with a backlog is the harder one: you already own things, so
 * which do you boot up? This prefers your library whenever you have one, and
 * only falls back to the whole catalog when you do not.
 */
/* ------------------------------------------------------------------ *
 * Email price alerts
 * ------------------------------------------------------------------ */

const THEME_KEY = 'theme';

/**
 * Light, dark, or whatever the phone says.
 *
 * The class is already set before first paint by a script in index.html, so
 * this only has to keep it in step afterwards. "System" is the default and
 * stays live: changing the phone's appearance while the app is open moves
 * the app with it, which is the behaviour anyone who schedules dark mode at
 * sunset expects.
 */
function useTheme() {
  const [choice, setChoice] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) ?? 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#020617' : '#ffffff');
    };
    apply();

    if (choice !== 'system') return undefined;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [choice]);

  const set = useCallback((next) => {
    setChoice(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Without storage the choice lasts for this visit only.
    }
  }, []);

  return [choice, set];
}

const FEED_MUTED_KEY = 'feedMuted';

/**
 * Sound in the feed, remembered. Muted to start with, because a page that
 * makes noise on open is a page you close; once you have asked for sound it
 * should stay on across slides and across visits.
 */
const readFeedMuted = () => {
  try {
    return localStorage.getItem(FEED_MUTED_KEY) !== '0';
  } catch {
    return true;
  }
};

const ALERT_TOKEN_KEY = 'alertToken';

/**
 * Whether this browser can be pushed to at all.
 *
 * On an iPhone the answer is no until the site has been added to the Home
 * Screen, and Safari does not expose PushManager before that, so the check
 * doubles as the detection for "tell them to install it first".
 */
const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

const isInstalled = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);

const isApple = () =>
  typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

/** VAPID keys travel as base64url; subscribe() wants the raw bytes. */
function decodeKey(base64) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

const readAlertToken = () => {
  try {
    return localStorage.getItem(ALERT_TOKEN_KEY);
  } catch {
    return null;
  }
};

/** Whole percentages people actually think in. */
const ALERT_THRESHOLDS = [
  [0, 'Any drop'],
  [20, '20% or more'],
  [33, 'A third off'],
  [50, 'Half price'],
];

/**
 * The state behind "email me when this drops".
 *
 * The wishlist stays where it lives, in localStorage. What goes to the server
 * is the address, the ids being watched and their titles, and nothing else.
 * The token the server returns is kept here so a later wishlist edit can be
 * synced without asking for the address a second time.
 */
function useAlerts(wishlist, dealAlerts, region, saved = []) {
  const [token, setToken] = useState(readAlertToken);
  const [state, setState] = useState({
    status: 'loading',
    configured: null,
    pushAvailable: null,
    vapidPublicKey: null,
    pushEnabled: false,
    emailConfirmed: false,
    confirmed: false,
    email: null,
    watching: 0,
    minDiscount: 20,
  });

  // Two lists feed this: things you want, and things you asked to be told the
  // price of. Saved store games are in here too now. They are not in the
  // nightly catalog walk, so the job reads their price from the concept page
  // instead; what it cannot do is say a drop is the lowest ever, because
  // nothing has been recording them.
  const watchable = useMemo(
    () => {
      const wanted = (game) => wishlist.has(game.id) || dealAlerts.has(game.id);
      return [...gamesData.filter(wanted), ...saved.filter(wanted)].map((game) => ({
        id: game.id,
        title: game.title,
      }));
    },
    [wishlist, dealAlerts, saved],
  );

  // Which channels this site has, and where this browser stands with them.
  // Always asks for both: the capability answer decides what the sheet can
  // offer, and it is needed whether or not there is a token yet.
  useEffect(() => {
    let live = true;
    Promise.all([
      fetch('/api/alerts').then((response) => response.json()),
      token
        ? fetch(`/api/alerts?status=${encodeURIComponent(token)}`).then((response) => response.json())
        : Promise.resolve(null),
    ])
      .then(([capability, status]) => {
        if (!live) return;

        if (token && status && !status.ok) {
          // The subscription is gone; forget the token rather than pretend.
          try {
            localStorage.removeItem(ALERT_TOKEN_KEY);
          } catch {
            // Nothing to clean up if storage is unavailable.
          }
          setToken(null);
        }

        setState((previous) => ({
          ...previous,
          ...(status?.ok ? status : { pushEnabled: false, emailConfirmed: false, confirmed: false }),
          status: 'ready',
          configured: capability.email ?? capability.configured ?? null,
          pushAvailable: Boolean(capability.push) && pushSupported(),
          vapidPublicKey: capability.vapidPublicKey ?? null,
        }));
      })
      .catch(() => {
        if (live) setState((previous) => ({ ...previous, status: 'ready' }));
      });
    return () => {
      live = false;
    };
  }, [token]);

  // Keep the watched set in step with the wishlist, quietly and after the
  // tapping has stopped.
  useEffect(() => {
    if (!token) return undefined;
    const timer = setTimeout(() => {
      fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync', token, games: watchable, region }),
      })
        .then((response) => response.json())
        .then((payload) => {
          if (payload.ok) setState((previous) => ({ ...previous, ...payload }));
        })
        .catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [token, watchable, region]);

  const subscribe = useCallback(
    async (email, minDiscount) => {
      const response = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'subscribe', email, games: watchable, minDiscount, region }),
      });
      const payload = await response.json();
      if (payload.ok) {
        try {
          localStorage.setItem(ALERT_TOKEN_KEY, payload.token);
        } catch {
          // Without storage the token lives only for this visit.
        }
        setToken(payload.token);
        setState((previous) => ({ ...previous, ...payload, email, minDiscount, status: 'ready' }));
      }
      return payload;
    },
    [watchable, region],
  );

  /**
   * Turns on notifications for this phone.
   *
   * The permission prompt has to come from the tap itself, so everything here
   * runs in that gesture. Every failure has its own sentence, because "did
   * not work" on a notification prompt is the least helpful thing an app can
   * say: blocked, unsupported and not-installed all need different actions.
   */
  const enablePush = useCallback(async () => {
    if (!pushSupported()) {
      return {
        ok: false,
        error:
          isApple() && !isInstalled()
            ? 'On an iPhone this needs the app on your Home Screen first. Tap Share, then Add to Home Screen, and open it from there.'
            : 'This browser cannot do notifications.',
      };
    }
    if (!state.vapidPublicKey) return { ok: false, error: 'Push is not switched on for this site.' };

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        ok: false,
        error:
          permission === 'denied'
            ? 'Notifications are blocked for this app. Turn them back on in your phone settings, then try again.'
            : 'Notifications were not allowed.',
      };
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      // An existing subscription is reused: re-subscribing with a different
      // key is what makes a browser hand back a dead endpoint.
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(state.vapidPublicKey),
        }));

      const response = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'subscribe-push',
          token,
          subscription: subscription.toJSON(),
          games: watchable,
          minDiscount: state.minDiscount,
          region,
        }),
      });
      const payload = await response.json();
      if (!payload.ok) return payload;

      try {
        localStorage.setItem(ALERT_TOKEN_KEY, payload.token);
      } catch {
        // Without storage the token lives only for this visit.
      }
      setToken(payload.token);
      setState((previous) => ({ ...previous, ...payload }));
      return payload;
    } catch (error) {
      return { ok: false, error: `Could not subscribe this phone (${error?.message ?? error}).` };
    }
  }, [state.vapidPublicKey, state.minDiscount, token, watchable, region]);

  const disablePush = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      await subscription?.unsubscribe();
    } catch {
      // The server record is what stops the sending; the local one is tidiness.
    }
    if (token) {
      await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'unsubscribe-push', token }),
      }).catch(() => {});
    }
    setState((previous) => ({ ...previous, pushEnabled: false }));
  }, [token]);

  const setThreshold = useCallback(
    (minDiscount) => {
      setState((previous) => ({ ...previous, minDiscount }));
      if (!token) return;
      fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync', token, games: watchable, minDiscount, region }),
      }).catch(() => {});
    },
    [token, watchable, region],
  );

  const stop = useCallback(async () => {
    if (token) {
      await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'unsubscribe', token }),
      }).catch(() => {});
    }
    try {
      localStorage.removeItem(ALERT_TOKEN_KEY);
    } catch {
      // Already gone as far as this browser is concerned.
    }
    setToken(null);
    setState((previous) => ({ ...previous, confirmed: false, email: null, watching: 0 }));
  }, [token]);

  return { ...state, token, watchable, subscribe, enablePush, disablePush, setThreshold, stop };
}

/**
 * The sign-up sheet. Four states, and each one says exactly where things
 * stand: mail not switched on, not signed up, waiting on a confirmation
 * click, or running.
 */
function AlertsSheet({ alerts, onClose }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState(null);
  const [showPush, setShowPush] = useState(false);

  const count = alerts.watchable.length;
  const needsHomeScreen = isApple() && !isInstalled();

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await alerts.subscribe(email.trim(), alerts.minDiscount);
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(result.error ?? 'That did not work. Try again in a moment.');
  };

  const togglePush = async () => {
    setPushBusy(true);
    setPushError(null);
    if (alerts.pushEnabled) {
      await alerts.disablePush();
    } else {
      const result = await alerts.enablePush();
      if (!result.ok) setPushError(result.error ?? 'That did not work.');
    }
    setPushBusy(false);
  };

  const thresholds = (
    <>
      <p className="mt-6 text-sm font-semibold text-slate-700 dark:text-slate-200">Tell me when it is</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {ALERT_THRESHOLDS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => alerts.setThreshold(value)}
            aria-pressed={alerts.minDiscount === value}
            className={`min-h-[2.75rem] rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 ease-spring active:scale-[0.97] ${
              alerts.minDiscount === value
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <ModalSheet labelledBy="alerts-title" onClose={onClose}>
      <div className="p-6 sm:p-8">
        <h2 id="alerts-title" className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
          <Mail className="h-6 w-6 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
          Email me when it drops
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {count === 0
            ? 'Heart a game, or tap the bell on one, and it becomes part of the list this watches.'
            : // Two lists feed this, so the copy cannot name only one of them.
              `Watching ${count === 1 ? '1 game' : `${count} games`} from your wishlist and your bells. Add to either and it joins on its own.`}
        </p>

        {/* Email is the channel this app is set up around. It goes first, at
            full width, and says plainly when it cannot deliver yet. */}
        <div className="mt-5 rounded-2xl bg-slate-50 dark:bg-slate-950 p-4 ring-1 ring-inset ring-slate-200 dark:ring-slate-700">
          {alerts.emailConfirmed ? (
            <>
              <p className="inline-flex items-start gap-2 text-sm leading-relaxed text-emerald-800 dark:text-emerald-200">
                <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Emailing <strong className="font-semibold">{alerts.email}</strong> the
                  night a watched game gets cheaper.
                </span>
              </p>
              <button
                type="button"
                onClick={() => {
                  alerts.stop();
                  onClose();
                }}
                className="mt-3 min-h-[2.75rem] w-full rounded-xl bg-white dark:bg-slate-900 px-4 text-sm font-medium text-slate-700 dark:text-slate-200 ring-1 ring-inset ring-slate-300 dark:ring-slate-600 transition-transform duration-200 ease-spring active:scale-[0.98] hover:bg-slate-100"
              >
                Stop emails and delete my address
              </button>
            </>
          ) : sent || (alerts.token && alerts.email) ? (
            <p className="inline-flex items-start gap-2 text-sm leading-relaxed text-indigo-900 dark:text-indigo-200">
              <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Check your inbox at <strong className="font-semibold">{alerts.email ?? email}</strong>.
                There is a confirmation link waiting, and nothing is sent until you
                click it. Look in spam if it is not there in a minute.
              </span>
            </p>
          ) : alerts.configured === false ? (
            // The reader of this app is also the person who owns the site, so
            // the honest thing is the actual two steps rather than a shrug.
            <>
              <p className="inline-flex items-start gap-2 text-sm leading-relaxed text-amber-900 dark:text-amber-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Email needs a sending key before anything can arrive, so the form
                  is hidden rather than pretending.
                </span>
              </p>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                <li>
                  Get a free API key at <strong className="font-semibold">resend.com</strong>,
                  signing up with the address you want the alerts at.
                </li>
                <li>
                  In Netlify, add it under Site settings → Environment variables as{' '}
                  <code className="rounded bg-slate-200 dark:bg-slate-700 px-1 py-0.5 font-mono text-xs">RESEND_API_KEY</code>,
                  then redeploy.
                </li>
              </ol>
              <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                No domain and no DNS records needed. The default sender only
                delivers to the address that owns the Resend account, which is
                exactly what one person watching their own wishlist wants.
              </p>
            </>
          ) : (
            <form onSubmit={submit}>
              <label htmlFor="alert-email" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Your email
              </label>
              <input
                id="alert-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 min-h-[2.75rem] w-full rounded-xl border border-slate-300 dark:border-slate-600 px-3 text-base outline-none transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={busy}
                className="mt-3 min-h-[2.75rem] w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-transform duration-200 ease-spring active:scale-[0.98] hover:bg-indigo-700 disabled:opacity-60"
              >
                {busy ? 'Sending confirmation…' : 'Email me about drops'}
              </button>
              {error && (
                <p role="alert" className="mt-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
                  {error}
                </p>
              )}
            </form>
          )}
        </div>

        {thresholds}

        <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          One email a night at most, only when something is actually cheaper than
          it was when you added it, and never twice for the same sale. We store
          your address and the game ids being watched. Nothing else, no tracking,
          no sharing, and every email has a one-click unsubscribe.
        </p>

        {/* Phone notifications still work and cost nothing, but they are not
            what was asked for, so they sit behind a line of text rather than a
            button competing with the email form. */}
        {alerts.pushAvailable !== false && !needsHomeScreen && (
          <div className="mt-5 border-t border-slate-100 dark:border-slate-800 pt-4">
            {alerts.pushEnabled ? (
              <p className="flex items-start gap-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                <span className="flex-1">
                  This phone is also getting notifications.{' '}
                  <button
                    type="button"
                    onClick={togglePush}
                    disabled={pushBusy}
                    className="font-semibold text-indigo-600 dark:text-indigo-300 hover:underline disabled:opacity-60"
                  >
                    {pushBusy ? 'Turning off…' : 'Turn those off'}
                  </button>
                </span>
              </p>
            ) : showPush ? (
              <>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  A notification on this phone needs nothing set up, so it works
                  even while email is waiting on a key.
                </p>
                <button
                  type="button"
                  onClick={togglePush}
                  disabled={pushBusy}
                  className="mt-2 min-h-[2.75rem] w-full rounded-xl bg-white dark:bg-slate-900 px-4 text-sm font-medium text-slate-700 dark:text-slate-200 ring-1 ring-inset ring-slate-300 dark:ring-slate-600 transition-transform duration-200 ease-spring active:scale-[0.98] hover:bg-slate-100 disabled:opacity-60"
                >
                  {pushBusy ? 'Asking…' : 'Notify this phone instead'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowPush(true)}
                className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:underline"
              >
                Prefer a phone notification?
              </button>
            )}

            {pushError && (
              <p role="alert" className="mt-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm leading-relaxed text-rose-800 dark:text-rose-200">
                {pushError}
              </p>
            )}
          </div>
        )}
      </div>
    </ModalSheet>
  );
}

function TonightSheet({ catalog, library, hidden, onOpenGame, onClose }) {
  const [mood, setMood] = useState(null);
  const [fromLibrary, setFromLibrary] = useState(library.size > 0);
  const [pick, setPick] = useState(null);
  const [seen, setSeen] = useState(() => new Set());

  const pool = useMemo(() => {
    const chosen = MOODS.find((entry) => entry.value === mood);
    if (!chosen) return [];
    return catalog.filter(
      (game) =>
        !hidden.has(game.id) &&
        (!fromLibrary || library.has(game.id)) &&
        chosen.match(game),
    );
  }, [catalog, mood, fromLibrary, library, hidden]);

  /** Weighted toward the better-reviewed end without ever being predictable. */
  const draw = useCallback(
    (exclude) => {
      const fresh = pool.filter((game) => !exclude.has(game.id));
      const candidates = fresh.length > 0 ? fresh : pool;
      if (candidates.length === 0) return null;
      const ranked = [...candidates].sort((a, b) => moodScore(b) - moodScore(a));
      // Pick from the better half, at random inside it.
      const top = ranked.slice(0, Math.max(3, Math.ceil(ranked.length / 2)));
      return top[Math.floor(Math.random() * top.length)];
    },
    [pool],
  );

  const choose = (value) => {
    setMood(value);
    setSeen(new Set());
    setPick(null);
  };

  useEffect(() => {
    if (!mood) return;
    // eslint-disable-next-line react/set-state-in-effect
    setPick(draw(new Set()));
  }, [mood, fromLibrary, draw]);

  const again = () => {
    const nextSeen = new Set(seen);
    if (pick) nextSeen.add(pick.id);
    setSeen(nextSeen);
    setPick(draw(nextSeen));
  };

  const chosenMood = MOODS.find((entry) => entry.value === mood);

  return (
    <ModalSheet labelledBy="tonight-title" onClose={onClose}>
      <div className="p-6 sm:p-8">
        <h2 id="tonight-title" className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          What are you in the mood for?
        </h2>

        {library.size > 0 && (
          <div className="mt-4 flex gap-1.5">
            {[
              [true, `From my ${library.size} owned`],
              [false, 'Anything in the catalog'],
            ].map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setFromLibrary(value)}
                aria-pressed={fromLibrary === value}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
                  fromLibrary === value
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          {MOODS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              onClick={() => choose(entry.value)}
              aria-pressed={mood === entry.value}
              className={`flex min-h-[3rem] items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all duration-200 ease-spring active:scale-[0.97] ${
                mood === entry.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
              }`}
            >
              <span aria-hidden="true">{entry.emoji}</span>
              {entry.label}
            </button>
          ))}
        </div>

        {mood && !pick && (
          <p className="mt-6 rounded-xl bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            Nothing in {fromLibrary ? 'your library' : 'the catalog'} matches that yet.
            {fromLibrary && ' Try the whole catalog, or mark a few more games as owned.'}
          </p>
        )}

        {pick && (
          <div className="mt-6 animate-rise-in overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <button
              type="button"
              onClick={() => onOpenGame(pick.id)}
              className="block w-full text-left"
            >
              <div className="aspect-[460/215] w-full bg-slate-100 dark:bg-slate-800">
                <CoverArt game={pick} live={null} className="h-full w-full" />
              </div>
              <div className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-indigo-500">
                  {fromLibrary ? 'From your library' : 'Worth a look'}
                </p>
                <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-50">{pick.title}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{chosenMood?.why}</p>
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {pick.description}
                </p>
              </div>
            </button>

            <div className="grid grid-cols-2 divide-x divide-slate-100 dark:divide-slate-800 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={again}
                className="flex h-12 items-center justify-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 transition-colors active:bg-slate-100"
              >
                <Dices className="h-4 w-4" />
                Something else
              </button>
              <button
                type="button"
                onClick={() => onOpenGame(pick.id)}
                className="flex h-12 items-center justify-center gap-2 text-sm font-medium text-indigo-600 dark:text-indigo-300 transition-colors active:bg-slate-100"
              >
                <Info className="h-4 w-4" />
                Tell me more
              </button>
            </div>
          </div>
        )}

        {!mood && (
          <p className="mt-6 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            {library.size > 0
              ? `Picks come from the ${library.size} games you have marked as owned, so this answers what to play rather than what to buy.`
              : 'Mark a few games as owned and this starts picking from your own shelf instead of the whole catalog.'}
          </p>
        )}
      </div>
    </ModalSheet>
  );
}

/* ------------------------------------------------------------------ *
 * Store mirror
 * ------------------------------------------------------------------ */

/**
 * The long tail behind the curated catalog: everything the store itself lists,
 * as the store lists it. These cards deliberately look different from the
 * hand-picked ones — no kid-friendly verdict, no representation note, no
 * description — because nobody has read these games, only indexed them.
 */
/**
 * A game from the store mirror, opened.
 *
 * The mirror's index only holds enough for a card, so the rest — the
 * description, the screenshots, the trailer, the live price and the drop
 * prediction — is read from the store the moment you open one. The card you
 * tapped is shown immediately and fills in around itself, so this never
 * starts as a blank sheet.
 *
 * Most of what used to be curated-only now arrives here too, because it
 * turned out to be derivable rather than written: the age rating and its
 * descriptors come from the store's own rating block, and the player score
 * and the pros and cons are counted from Steam's review corpus once the
 * nightly matcher has tied this game to its Steam listing. A game with no
 * Steam release simply has none, which is the honest answer.
 *
 * What it still does not claim is the representation note, because that is
 * a judgement somebody has to make and sign, not a fact to be read off a
 * page. Those exist only where one has been written.
 */
function StoreGameModal({
  game,
  region,
  wishlisted,
  owned,
  dealWatched,
  alertsArmed,
  onToggleDealAlert,
  onOpenAlerts,
  onToggleWishlist,
  onToggleOwned,
  onClose,
}) {
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState('loading');
  const [shot, setShot] = useState(null);
  const [expanded, setExpanded] = useState(false);
  // Joined once so the fetch effect depends on a stable string, not an array
  // that is a new object on every render.
  const genreList = (game.genres ?? []).join(',');

  useEffect(() => {
    let live = true;
    // Fetching the listing on open is the point of this effect.
    // eslint-disable-next-line react/set-state-in-effect
    setStatus('loading');
    fetch(
      `/api/concept?id=${game.id}&cc=${region}&genres=${encodeURIComponent(genreList)}` +
        (game.steamAppId ? `&steam=${game.steamAppId}` : ''),
    )
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('failed'))))
      .then((payload) => {
        if (!live) return;
        setDetail(payload);
        setStatus('ready');
      })
      .catch(() => {
        if (live) setStatus('error');
      });
    return () => {
      live = false;
    };
  }, [game.id, region, genreList, game.steamAppId]);

  // Some store descriptions open with the tagline verbatim, and the tagline
  // is already on screen a few lines above: OneShot printed "The World Knows
  // You Exist." twice, once as the tagline and once as the first sentence of
  // its own description. One in twelve games checked did this. Dropping the
  // repeat is better than dropping the tagline, which is usually the better
  // line of the two and is what the card has room for.
  const description = useMemo(() => {
    const text = (detail?.description ?? '').trim();
    const tagline = (detail?.tagline ?? '').trim();
    if (!text || !tagline) return text;
    if (!text.toLowerCase().startsWith(tagline.toLowerCase())) return text;
    const rest = text.slice(tagline.length).trim();
    // Only when something is left: a description that is nothing but the
    // tagline should still say something rather than going blank.
    return rest.length > 0 ? rest : text;
  }, [detail?.description, detail?.tagline]);

  const art = detail?.art ?? game.art;
  const screenshots = detail?.screenshots ?? [];
  const hero = shot ?? art;
  const stars = detail?.stars ?? game.stars;
  const votes = detail?.votes ?? game.votes;
  const release = detail?.releaseDate ?? game.release;
  const ageRating = detail?.ageRating ?? game.ageRating ?? null;

  // PricePanel and PredictionPanel are the catalog's, and take the same shapes.
  const asGame = { title: game.name, psnStorePath: `concept/${game.id}` };
  const asLive = detail ? { price: detail.price, prediction: detail.prediction, history: null } : null;

  return (
    <ModalSheet labelledBy="store-modal-title" onClose={onClose}>
      <div className="relative aspect-video w-full bg-slate-900">
        {detail?.trailer && !shot ? (
          <video
            src={detail.trailer}
            poster={atWidth(art, 1280) ?? undefined}
            controls
            // Nothing is fetched until play is pressed: these files run to
            // tens of megabytes and the poster holds the stage until then.
            preload="none"
            playsInline
            className="h-full w-full bg-black object-contain"
          />
        ) : hero ? (
          <img
            src={atWidth(hero, 1280)}
            alt={`Key art for ${game.name}`}
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>

      {/*
        Every image here is asked for at the size it is drawn at. The store
        serves screenshots around 900KB each, and this strip puts nine of them
        in 96x56 buttons: opening one game used to pull 15MB of imagery before
        the reader had done anything at all.
      */}
      {screenshots.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto bg-slate-50 dark:bg-slate-950 p-2">
          {[...(art ? [art] : []), ...screenshots].map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => setShot(src === art ? null : src)}
              className={`h-14 w-24 shrink-0 overflow-hidden rounded-md ring-1 transition-transform hover:scale-105 ${
                (shot ?? art) === src ? 'ring-2 ring-indigo-500' : 'ring-slate-200 dark:ring-slate-700'
              }`}
            >
              <img
                src={atWidth(src, 256)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      <div className="p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <h2 id="store-modal-title" className="text-2xl font-bold text-slate-900 dark:text-slate-50 sm:pr-6">
            {game.name}
          </h2>
          <div className="flex shrink-0 items-center gap-2 sm:gap-1">
            <WishlistButton wishlisted={wishlisted} onToggle={onToggleWishlist} withLabel />
            <OwnedButton owned={owned} onToggle={onToggleOwned} withLabel />
          </div>
        </div>

        {detail?.tagline && (
          <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">{detail.tagline}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {/* Two different things, kept visibly apart: PlayStation's stars out
              of five, and the share of Steam reviewers who liked it. */}
          <RatingChips ratings={detail?.ratings} size="lg" />
          {stars > 0 && (
            <span
              title={`${(votes ?? 0).toLocaleString()} PlayStation ratings`}
              className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-sm font-semibold text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-600/20"
            >
              <Star className="h-3.5 w-3.5 fill-current" />
              {stars.toFixed(1)}
              <span className="font-normal opacity-70">
                {(votes ?? 0).toLocaleString()} ratings
              </span>
            </span>
          )}
          {(game.platforms ?? []).map((platform) => (
            <span
              key={platform}
              className="rounded-md bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-sm font-semibold text-slate-600 dark:text-slate-300"
            >
              {platform}
            </span>
          ))}
          {(game.genres ?? []).map((genre) => (
            <span
              key={genre}
              className="rounded-md bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-1 text-sm font-semibold text-indigo-700 dark:text-indigo-300"
            >
              {genre}
            </span>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {[
            ['Publisher', detail?.publisher ?? game.publisher],
            ['Released', release ? new Date(release).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : null],
          ]
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {label}
                </span>
                <span className="font-medium text-slate-800 dark:text-slate-100">{value}</span>
              </div>
            ))}
        </div>

        {detail?.ratings && (
          <div className="mt-5">
            <ProsAndCons ratings={detail.ratings} />
          </div>
        )}

        {ageRating && (
          <div className="mt-5">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Rated
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <AgeBadge ageRating={ageRating} size="lg" />
              {/* The board's own descriptors, quoted. This is the whole
                  reason the badge can be trusted: it is not a guess from the
                  genre, it is what the rating was issued on. */}
              {[...ageRating.descriptors, ...(ageRating.interactive ?? [])].map((entry) => (
                <span
                  key={entry}
                  className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300"
                >
                  {entry}
                </span>
              ))}
            </div>
          </div>
        )}

        {status === 'loading' && !detail && (
          <p className="mt-6 flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading the store listing...
          </p>
        )}

        {description && (
          <div className="mt-5">
            {/* Store copy runs to marketing-page length — several screens of
                bullet points on a phone. It opens clamped, with the rest one
                tap away. */}
            <p
              className={`whitespace-pre-line leading-relaxed text-slate-700 dark:text-slate-200 ${
                expanded ? '' : 'line-clamp-5'
              }`}
            >
              {description}
            </p>
            {description.length > 320 && (
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                className="mt-1 text-sm font-medium text-indigo-600 dark:text-indigo-300 hover:underline"
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        <PricePanel game={asGame} live={asLive} />
        {/* The nightly job reads a price for every watched store game from
            its concept page, so this promises nothing it cannot keep. What it
            cannot say is that a drop is the lowest ever: only catalog games
            have their prices recorded night after night. */}
        <DealAlertRow
          watching={dealWatched}
          live={asLive}
          armed={alertsArmed}
          onToggle={onToggleDealAlert}
          onSetUp={onOpenAlerts}
        />
        <PredictionPanel live={asLive} />

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <a
            href={reviewSearchLink(game.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 font-medium text-white transition-transform duration-200 ease-spring hover:bg-rose-700 active:scale-95"
          >
            <CirclePlay className="h-4 w-4" />
            Reviews
          </a>
          <a
            href={trailerSearchLink(game.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 font-medium text-white transition-transform duration-200 ease-spring hover:bg-slate-800 active:scale-95"
          >
            <CirclePlay className="h-4 w-4" />
            Gameplay
          </a>
          <a
            href={detail?.storeUrl ?? `https://store.playstation.com/en-us/concept/${game.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition-transform duration-200 ease-spring hover:bg-indigo-700 active:scale-95"
          >
            <ExternalLink className="h-4 w-4" />
            PS Store
          </a>
        </div>

        <GameNews title={game.name} />

        <p className="mt-8 border-t border-slate-100 dark:border-slate-800 pt-4 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
          Indexed from the PlayStation Store. The rating is PlayStation's own, from{' '}
          {(votes ?? 0).toLocaleString()} players. This game is not one of the hand-reviewed
          entries, so there is no kid-friendly verdict or representation note on it.
        </p>
      </div>
    </ModalSheet>
  );
}

/**
 * A store row wearing the catalog's shape.
 *
 * The mirror publishes nine facts and the catalog carries fifteen, so the six
 * that are hand-made come back empty rather than invented, and `coverage`
 * records which kind of row this is. Every card in the app reads these field
 * names, which is the whole point: one card, not two of them drifting apart.
 *
 * The id is namespaced because concept ids and catalog ids are different
 * numbering schemes, and an accidental collision would heart the wrong game.
 */
/**
 * An upcoming release in the mirror's shape.
 *
 * Both come from the same place: a PlayStation Store concept id. The upcoming
 * endpoint simply names its fields differently. Normalising here means one
 * adapter, one key namespace and one saved cache rather than three of each,
 * and a game you saved before release stays the same game afterwards.
 */
function upcomingAsStoreRow(row) {
  return {
    id: row.id,
    name: row.title,
    release: row.releaseDate,
    platforms: row.platforms,
    genres: row.genres,
    publisher: row.publisher,
    price: row.price,
    stars: row.stars,
    votes: row.votes,
    art: row.art,
    steamAppId: row.steamAppId ?? null,
  };
}

function storeRowAsGame(row, coverage = 'store') {
  return {
    id: `store:${row.id}`,
    storeId: row.id,
    title: row.name,
    genre: (row.genres ?? [])[0] ?? null,
    // The catalog's platform field is one of PS4 or PS5 and the "show PS5
    // only titles" filter compares against it, so a joined list would read as
    // neither and quietly escape the filter.
    platform: (row.platforms ?? []).length === 1 && row.platforms[0] === 'PS5' ? 'PS5' : 'PS4',
    publisher: row.publisher ?? null,
    releaseDate: row.release ?? null,
    stars: row.stars ?? null,
    votes: row.votes ?? null,
    coverage,
    // None of this is knowable from the mirror, and guessing it is how a
    // store row would start pretending to be a curated one.
    artStyle: null,
    protagonist: null,
    tags: [],
    representation: [],
    // Present on upcoming rows and on mirror rows swept since ratings were
    // read; absent on older ones, where null means "not known" rather than
    // "fine for children", which is why the kid filter excludes it.
    ageRating: row.ageRating ?? null,
    ratings: null,
    description: null,
    // Known once the nightly matcher has tied this concept to a Steam
    // listing, which is what lets the store view show a player score and the
    // pros and cons counted from it.
    steamAppId: row.steamAppId ?? null,
    ps5Upgrade: null,
    // Carried on the row itself: a saved store game is not in the live price
    // feed, which is keyed by catalog title, so without this its card would
    // sit on the loading shimmer for ever.
    storeLive: storeRowAsLive(row),
    // The row this was built from, so a card can open the store view for it
    // and hearting it can cache it without having to find it again.
    raw: row,
    // The catalog's search index is built once from games.json and cannot
    // know about these, so each row brings its own.
    searchRow: {
      title: indexText(row.name ?? ''),
      meta: indexText([...(row.genres ?? []), row.publisher ?? ''].join(' ')),
    },
  };
}

/**
 * The live-data shape a card expects, built from the row itself.
 *
 * Store rows carry their own art and price, so they never wait on the live
 * endpoint the catalog uses. `ratings` stays null deliberately: PlayStation's
 * stars run to five and are often five-from-one-vote, and dropping them into
 * the slot that holds Metacritic's hundred would read as a perfect score.
 */
function storeRowAsLive(row) {
  return {
    heroImage: row.art ?? null,
    price: row.price
      ? {
          finalFormatted: row.price,
          discountPercent: 0,
          // Same shape the live price read produces, so the card's PS Plus
          // badge works for a store row without knowing where it came from.
          // No tier: the catalog page says a game is included, not which
          // tier covers it, and inventing one would be worse than omitting.
          plus: row.plusIncluded ? { included: true, tier: row.plusTier ?? null } : undefined,
        }
      : null,
    ratings: null,
  };
}

/** Query state for the mirror, kept out of the component that renders it. */
function useStoreSearch({ active, q, genre, sort, plusOnly = false, familyOnly = false, noPurchases = false }) {
  const [state, setState] = useState({ status: 'idle', games: [], total: 0, page: 0 });
  const request = useRef(0);
  // Everything that decides which games belong in the list, as against which
  // of them match what has been typed.
  const shape = `${genre}|${sort}|${plusOnly}|${familyOnly}|${noPurchases}`;
  const lastShape = useRef(shape);

  useEffect(() => {
    if (!active) return undefined;
    const run = ++request.current;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (genre) params.set('genre', genre);
    if (sort) params.set('sort', sort);
    if (plusOnly) params.set('plus', '1');
    if (familyOnly) params.set('family', '1');
    if (noPurchases) params.set('nopurchases', '1');

    // Rows are kept while a query narrows, because a list shrinking under the
    // typing is the answer arriving. Changing a filter is not that: the old
    // rows are not a stale version of the answer, they are the wrong answer.
    // Tapping PS Plus left the unfiltered library on screen for as long as the
    // request took, so games that are not on PS Plus sat under the PS Plus
    // chip, which is exactly what the chip promises they are not.
    const shapeChanged = lastShape.current !== shape;
    lastShape.current = shape;

    // eslint-disable-next-line react/set-state-in-effect
    setState((previous) =>
      shapeChanged
        ? { status: 'loading', games: [], total: 0, page: 0 }
        : { ...previous, status: 'loading' },
    );
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/store?${params}`);
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json();
        if (request.current !== run) return;
        setState({ status: 'ready', games: payload.games, total: payload.total, page: 0 });
      } catch {
        if (request.current === run) setState({ status: 'error', games: [], total: 0, page: 0 });
      }
    }, q ? 220 : 0);

    return () => clearTimeout(timer);
  }, [active, q, genre, sort, plusOnly, familyOnly, noPurchases, shape]);

  const more = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (genre) params.set('genre', genre);
    if (sort) params.set('sort', sort);
    if (plusOnly) params.set('plus', '1');
    if (familyOnly) params.set('family', '1');
    if (noPurchases) params.set('nopurchases', '1');
    params.set('page', String(state.page + 1));
    try {
      const response = await fetch(`/api/store?${params}`);
      const payload = await response.json();
      setState((previous) => ({
        ...previous,
        games: [...previous.games, ...payload.games],
        page: payload.page,
      }));
    } catch {
      // A failed "load more" leaves what is already on screen alone.
    }
  }, [q, genre, sort, plusOnly, familyOnly, noPurchases, state.page]);

  return { ...state, more };
}

/**
 * The "Whole store" view. Browsing sorts by PlayStation's own star rating,
 * weighted down until enough people have voted, so the top is genuinely
 * well-liked rather than one five-star review.
 */
/**
 * The whole store as a feed, so the view switch means the same thing here as
 * it does anywhere else.
 */
/**
 * What PlayStation Plus is giving away right now.
 *
 * The scan answers "is this in the catalog", which is a different question
 * from "what is free this month". The monthly games are claimed and kept, and
 * nothing on a game's store page marks them, so they come from the blog post
 * that announces them. Shown only when that post could actually be read: a
 * panel whose whole job is to say "this one is free" has no business guessing.
 */
function PlusThisMonth({ now, onSearch }) {
  const monthly = now?.monthly;
  const catalog = now?.catalog;
  if (!monthly && !catalog) return null;

  // Each name searches for itself. Being told a game is free and left to
  // retype its name is a strange place to stop, and the mirror has a page for
  // most of them.
  const row = (entry, label, tone) => {
    if (!entry) return null;
    return (
      <div className="min-w-0">
        <p className={`text-[11px] font-bold uppercase tracking-wide ${tone}`}>
          {label} · {entry.month}
        </p>
        <p className="mt-1 text-sm font-semibold leading-snug text-slate-900 dark:text-white">
          {entry.games.map((name, index) => (
            <Fragment key={name}>
              {index > 0 && <span className="text-slate-400 dark:text-slate-500"> · </span>}
              {onSearch ? (
                <button
                  type="button"
                  onClick={() => onSearch(name)}
                  className="text-left underline decoration-dotted underline-offset-4 hover:decoration-solid"
                >
                  {name}
                </button>
              ) : (
                name
              )}
            </Fragment>
          ))}
        </p>
      </div>
    );
  };

  const link = monthly?.link ?? catalog?.link;

  return (
    <div className="mb-3 rounded-2xl bg-gradient-to-br from-indigo-50 to-violet-50 p-4 ring-1 ring-indigo-100 dark:from-indigo-950/50 dark:to-violet-950/40 dark:ring-indigo-900/60">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-300" />
        <div className="min-w-0 flex-1 space-y-3">
          {row(monthly, 'Yours to claim this month', 'text-indigo-600 dark:text-indigo-300')}
          {row(catalog, 'Just added to the catalog', 'text-violet-600 dark:text-violet-300')}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
            >
              PlayStation Blog <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function StoreFeed({ query, curatedFirst = [], curatedReason, curatedByName, saved, plusOnly = false, familyOnly = false, noPurchases = false, muted, onToggleMuted, onOpenCurated, onOpenStore }) {
  const results = useStoreSearch({ active: true, q: query, genre: '', sort: 'rating', plusOnly, familyOnly, noPurchases });
  const [sentinel, setSentinel] = useState(null);
  const loadMore = results.more;
  const hasMore = results.games.length < results.total;

  useEffect(() => {
    if (!sentinel || !hasMore) return undefined;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && loadMore(), {
      rootMargin: '150% 0px',
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, loadMore]);

  if (results.status === 'loading' && results.games.length === 0) {
    return <PanelMessage icon={Loader2} spin label="Searching the store index..." />;
  }
  if (results.games.length === 0 && curatedFirst.length === 0) {
    return <PanelMessage icon={Search} label="Nothing in the index matches that." />;
  }

  return (
    <>
      {/* Written-up games the mirror has no page for, first. */}
      {curatedFirst.map((game) => (
        <FeedSlide
          key={`curated-${game.id}`}
          game={game}
          live={game.storeLive}
          reason={curatedReason}
          wishlisted={saved.wishlist.has(game.id)}
          muted={muted}
          onToggleMuted={onToggleMuted}
          onToggleWishlist={() => saved.toggle(null, game, 'wishlist')}
          onOpen={() => onOpenCurated(game.id)}
        />
      ))}
      {results.games
        .filter((row) => !saved.hidden.has(storeKey(row)))
        .filter((row) => !curatedFirst.some((game) => game.title === row.name))
        .map((row) => {
          const twin = curatedByName.get(row.name?.toLowerCase());
          const game = storeRowAsGame(row);
          const key = twin ? twin.id : game.id;
          return (
            <FeedSlide
              key={game.id}
              game={game}
              live={game.storeLive}
              reason={twin ? 'In your catalog, with the full write-up' : undefined}
              wishlisted={saved.wishlist.has(key)}
              muted={muted}
              onToggleMuted={onToggleMuted}
              onToggleWishlist={() => saved.toggle(row, twin, 'wishlist')}
              onOpen={() => (twin ? onOpenCurated(twin.id) : onOpenStore(row))}
            />
          );
        })}
      {hasMore && <div ref={setSentinel} aria-hidden="true" className="h-px" />}
    </>
  );
}

function StorePanel({ query, curatedFirst = [], curatedReason, curatedByName, saved, plusOnly = false, familyOnly = false, noPurchases = false, onOpenCurated, onOpenStore, onSearch }) {
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState('rating');
  const [facets, setFacets] = useState({ genres: [], size: 0 });

  useEffect(() => {
    let live = true;
    fetch('/api/store?facets=1')
      .then((response) => response.json())
      .then((payload) => {
        if (live) setFacets(payload);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const results = useStoreSearch({ active: true, q: query, genre, sort, plusOnly, familyOnly, noPurchases });

  // Ask for the next page a screen and a half early, so the end of the list is
  // never actually reached. A callback ref because the sentinel only exists
  // while there is more to load.
  const [moreSentinel, setMoreSentinel] = useState(null);
  const loadMore = results.more;
  const hasMore = results.games.length < results.total;
  useEffect(() => {
    if (!moreSentinel || !hasMore) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: '150% 0px' },
    );
    observer.observe(moreSentinel);
    return () => observer.disconnect();
  }, [moreSentinel, hasMore, loadMore]);

  return (
    <>
      {plusOnly && <PlusThisMonth now={facets.plusNow} onSearch={onSearch} />}
      <p className="mb-3 text-xs font-medium text-slate-400 dark:text-slate-500">
        {plusOnly ? (
          <>
            {(results.total + curatedFirst.length).toLocaleString()} covered so far ·{' '}
            {COLLECTION_BLURBS.plus}
          </>
        ) : (
          <>
            {results.total.toLocaleString()} of {facets.size.toLocaleString()} games indexed ·{' '}
            {COLLECTION_BLURBS.all}
          </>
        )}
      </p>

      <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
        {[
          ['rating', 'Best rated'],
          ['new', 'Newest'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSort(value)}
            aria-pressed={sort === value}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
              sort === value
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="w-px shrink-0 self-stretch bg-slate-200 dark:bg-slate-700" />
        <button
          type="button"
          onClick={() => setGenre('')}
          aria-pressed={genre === ''}
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
            genre === '' ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
          }`}
        >
          Any genre
        </button>
        {facets.genres.slice(0, 24).map((entry) => (
          <button
            key={entry.genre}
            type="button"
            onClick={() => setGenre(entry.genre === genre ? '' : entry.genre)}
            aria-pressed={genre === entry.genre}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
              genre === entry.genre
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
            }`}
          >
            {entry.genre}
            <span className={genre === entry.genre ? 'text-white/60' : 'text-slate-400 dark:text-slate-500'}>
              {entry.count}
            </span>
          </button>
        ))}
      </div>

      {results.status === 'loading' && results.games.length === 0 && curatedFirst.length === 0 ? (
        <PanelMessage icon={Loader2} spin label="Searching the store index..." />
      ) : results.games.length === 0 && curatedFirst.length === 0 ? (
        <PanelMessage
          icon={Search}
          label={
            results.status === 'error'
              ? 'The store index is not answering right now.'
              : 'Nothing in the index matches that.'
          }
          /*
           * The mirror is 8,885 games and the store is bigger, so a game can
           * be real and absent from here: Hunt: Showdown 1896 was October's
           * monthly game and has no page in the index at all. Being told a
           * game is free and then shown an empty screen is a dead end, and
           * the store is where it gets claimed anyway.
           */
          action={
            query && results.status !== 'error'
              ? {
                  label: 'Look on the PlayStation Store',
                  onClick: () =>
                    window.open(
                      `https://store.playstation.com/en-us/search/${encodeURIComponent(query)}`,
                      '_blank',
                      'noopener,noreferrer',
                    ),
                }
              : undefined
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {/* Written-up games the mirror cannot answer for, first. */}
            {curatedFirst.map((game) => (
              <GameCard
                key={`curated-${game.id}`}
                game={game}
                live={game.storeLive}
                reason={curatedReason}
                wishlisted={saved.wishlist.has(game.id)}
                owned={saved.library.has(game.id)}
                onToggleWishlist={() => saved.toggle(null, game, 'wishlist')}
                onOpen={() => onOpenCurated(game.id)}
              />
            ))}
            {results.games
              .filter((row) => !saved.hidden.has(storeKey(row)))
              .filter((row) => !curatedFirst.some((game) => game.title === row.name))
              .map((row) => {
                const twin = curatedByName.get(row.name?.toLowerCase());
                const game = storeRowAsGame(row);
                const key = twin ? twin.id : game.id;
                return (
                  <GameCard
                    key={game.id}
                    game={game}
                    live={game.storeLive}
                    reason={twin ? 'In your catalog, with the full write-up' : undefined}
                    wishlisted={saved.wishlist.has(key)}
                    owned={saved.library.has(key)}
                    onToggleWishlist={() => saved.toggle(row, twin, 'wishlist')}
                    onOpen={() => (twin ? onOpenCurated(twin.id) : onOpenStore(row))}
                  />
                );
              })}
          </div>

          {/* The rest of the app grows its lists as you reach them; this was
              the one place that stopped and asked you to press a button. */}
          {results.games.length < results.total && (
            <div ref={setMoreSentinel} className="mt-6 flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-slate-300 dark:text-slate-600" />
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Briefing: news + release calendar
 * ------------------------------------------------------------------ */

/**
 * Both panels fetch on first open rather than on mount — nobody should pay for
 * seven RSS feeds and a store crawl just to browse the catalog.
 */
function useDeferredEndpoint(url, active) {
  const [state, setState] = useState({ status: 'idle', data: null });
  const started = useRef(false);

  const load = useCallback(
    async (force = false) => {
      if (started.current && !force) return;
      started.current = true;
      setState((previous) => ({ status: 'loading', data: force ? null : previous.data }));
      try {
        const response = await fetch(url, force ? { cache: 'reload' } : undefined);
        if (!response.ok) throw new Error(String(response.status));
        setState({ status: 'ready', data: await response.json() });
      } catch {
        setState({ status: 'error', data: null });
      }
    },
    [url],
  );

  useEffect(() => {
    if (!active) return;
    // Kicking off the first fetch is the point of this effect.
    // eslint-disable-next-line react/set-state-in-effect
    load();
  }, [active, load]);

  return { ...state, reload: () => load(true) };
}

function relativeTime(iso) {
  if (!iso) return '';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

/* ------------------------------------------------------------------ *
 * The Goss
 * ------------------------------------------------------------------ */

const GOSS_SEEN_KEY = 'gossSeenAt';

/**
 * Each kind gets its own colour and its own word, because the whole point of
 * the panel is telling at a glance what sort of thing you are looking at.
 */
const GOSS_KINDS = {
  beef: {
    label: 'Beef',
    icon: Flame,
    pill: 'bg-rose-500 text-white',
    glow: 'from-rose-500/15 dark:from-rose-500/10',
  },
  trailer: {
    label: 'Trailers',
    icon: Clapperboard,
    pill: 'bg-indigo-500 text-white',
    glow: 'from-indigo-500/15 dark:from-indigo-500/10',
  },
  review: {
    label: 'Reviews',
    icon: Star,
    pill: 'bg-amber-500 text-white',
    glow: 'from-amber-500/15 dark:from-amber-500/10',
  },
  pod: {
    label: 'Heard it',
    icon: Mic,
    pill: 'bg-emerald-500 text-white',
    glow: 'from-emerald-500/15 dark:from-emerald-500/10',
  },
  buzz: {
    label: 'Buzz',
    icon: MessageCircle,
    pill: 'bg-sky-500 text-white',
    glow: 'from-sky-500/15 dark:from-sky-500/10',
  },
};

const GOSS_ORDER = ['beef', 'trailer', 'review', 'pod', 'buzz'];

const heatLabel = (heat) =>
  heat >= 1000 ? `${(heat / 1000).toFixed(heat >= 10_000 ? 0 : 1)}k` : String(heat);

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/**
 * One burst.
 *
 * A post and a headline are not the same object and should not look the same:
 * a post *is* the story, so it gets the author's face and its full text, while
 * a headline is a pointer to one, so it gets the picture and a summary. Both
 * always name who said it, which is the only honest way to carry gossip about
 * real people.
 */
/**
 * The video id out of a watch link, or null for anything that is not one.
 *
 * Every YouTube burst carries its id in the link it already has, so the feed
 * can show a real 16:9 still and play the thing in place without a second
 * request to find out what it is.
 */
function youTubeId(link) {
  // watch?v=, youtu.be/, /shorts/ and /embed/. Shorts matter: 12 of 59 videos
  // in one sample were shorts, and matching only watch links left every one
  // of them as a still with no way to play it.
  const match = /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})(?![\w-])/.exec(link ?? '');
  return match ? match[1] : null;
}

/**
 * The media at the top of a card.
 *
 * 181 of 222 bursts arrive with a picture and the feed was rendering them as
 * 64x96 stamps beside the text, which is a column of headlines with postage
 * on it. The art leads instead, full width and 16:9.
 *
 * Video gets the same treatment plus a play control. Nothing from YouTube
 * loads until it is pressed: the still is a plain image, and only a tap
 * swaps in the player. That keeps a feed of forty videos to forty images
 * rather than forty embeds, and means nothing is handed to YouTube for
 * someone who only scrolled past.
 */
function GossMedia({ burst, videoId, playing, onPlay }) {
  // maxres is the only still that is natively 16:9; the hqdefault the feed
  // supplies is 4:3 with bars, so it is the fallback rather than the source.
  const [src, setSrc] = useState(
    videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : burst.image,
  );
  const [dead, setDead] = useState(false);
  if (dead) return null;

  if (playing && videoId) {
    return (
      <div className="relative aspect-video w-full bg-black">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={burst.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => {
          // maxres does not exist for every upload; fall back once, then give
          // up and let the card be text, rather than showing a broken frame.
          if (videoId && src !== burst.image && burst.image) setSrc(burst.image);
          else setDead(true);
        }}
        className="h-full w-full object-cover transition-transform duration-500 ease-swift group-hover:scale-[1.03]"
      />
      {videoId && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent"
          />
          <button
            type="button"
            onClick={onPlay}
            aria-label={`Play ${burst.title}`}
            className="tap absolute inset-0 grid place-items-center transition-transform duration-200 ease-spring active:scale-95"
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-slate-900 shadow-lg backdrop-blur transition-all duration-200 group-hover:bg-white">
              <Play className="ml-0.5 h-6 w-6 fill-current" />
            </span>
          </button>
        </>
      )}
    </div>
  );
}

function GossCard({ burst, fresh }) {
  const kind = GOSS_KINDS[burst.kind] ?? GOSS_KINDS.buzz;
  const post = burst.source === 'Bluesky';
  const external = burst.externalLink ? hostOf(burst.externalLink) : null;
  const videoId = youTubeId(burst.link);
  const [playing, setPlaying] = useState(false);
  // A post's picture stays inline under its text, where it reads as something
  // the person attached. A headline's or a video's picture is the thing
  // itself, so it leads.
  const hero = videoId || (!post && burst.image) ? true : false;

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg">
      {hero && (
        <GossMedia
          burst={burst}
          videoId={videoId}
          playing={playing}
          onPlay={() => setPlaying(true)}
        />
      )}

      <div className="relative p-3">
        {!hero && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent ${kind.glow}`}
          />
        )}

        <div className="relative">
          <div className="mb-2 flex items-center gap-1.5">
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${kind.pill}`}
            >
              <kind.icon className="h-3 w-3" />
              {kind.label}
            </span>
            {fresh && (
              <span
                className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-500"
                title="New since you last looked"
              />
            )}
            {burst.heat > 0 && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-rose-500">
                <Flame className="h-3 w-3" />
                {heatLabel(burst.heat)}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
              {relativeTime(burst.publishedAt)}
            </span>
          </div>

          <div className="flex gap-3">
            {post && burst.avatar && (
              <img
                src={burst.avatar}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
                className="h-9 w-9 shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 object-cover"
              />
            )}

            <div className="min-w-0 flex-1">
              <p className="mb-0.5 truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {post ? (burst.authorName ?? burst.author) : burst.source}
                {burst.note && (
                  <span
                    className={`font-normal ${
                      burst.tone === 'queer'
                        ? 'text-violet-500 dark:text-violet-300'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {' '}
                    · {burst.note}
                  </span>
                )}
              </p>
              {/* The link stretches over the text block only, so the picture
                  above can carry its own play control without nesting a
                  button inside an anchor. */}
              <a
                href={burst.link}
                target="_blank"
                rel="noopener noreferrer"
                className="line-clamp-3 text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100 after:absolute after:inset-0 after:content-[''] hover:underline"
              >
                {burst.title}
              </a>
              {burst.summary && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {burst.summary}
                </p>
              )}
              {post && burst.image && (
                <img
                  src={burst.image}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                  className="mt-2 h-40 w-full rounded-lg bg-slate-100 dark:bg-slate-800 object-cover"
                />
              )}
              {external && (
                <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-500 dark:text-indigo-300">
                  <ExternalLink className="h-3 w-3" />
                  {external}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Top, ranked so that one channel cannot bury the rest.
 *
 * Only a Bluesky post carries an engagement number. Press headlines, podcast
 * episodes and videos all sit at zero, so ranking the merged feed on that
 * number alone put all forty-nine posts above the first headline: sixteen
 * screens of scrolling to reach the news, in a feed whose whole point was
 * that the news is in it.
 *
 * So each channel is ranked within itself first, on whatever it actually
 * has, and the merged order takes the top of each, then the second of each,
 * and so on. The loudest post and the freshest headline arrive together
 * instead of one sitting on top of the other. Recency breaks ties, which is
 * also what sorts the channels that have no other measure.
 */
function rankAcrossChannels(rows) {
  const newest = (a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0);
  const lanes = new Map();
  for (const burst of rows) {
    const lane = burst.channel ?? 'other';
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(burst);
  }
  const ranked = [];
  for (const lane of lanes.values()) {
    lane
      .sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0) || newest(a, b))
      .forEach((burst, place) => ranked.push({ burst, place }));
  }
  return ranked
    .sort((a, b) => a.place - b.place || newest(a.burst, b.burst))
    .map(({ burst }) => burst);
}

/**
 * The gossip column.
 *
 * Bursts arrive already interleaved by kind, so scrolling gives you a beef,
 * then a trailer, then a review, rather than eighteen layoff stories in a row.
 * The chips are there for when you want only one of those.
 */
function GossPanel({ bursts, counts, status, onReload }) {
  const [kind, setKind] = useState('all');
  const [order, setOrder] = useState('top');

  // Read once per mount, then immediately record this visit: the dots have to
  // keep pointing at the same things while you scroll, but a reopen tomorrow
  // should compare against today.
  const [seenAt] = useState(() => {
    try {
      return Number(localStorage.getItem(GOSS_SEEN_KEY)) || 0;
    } catch {
      return 0;
    }
  });

  const loaded = bursts.length > 0;
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(GOSS_SEEN_KEY, String(Date.now()));
    } catch {
      // Without storage every burst simply reads as new.
    }
  }, [loaded]);

  const isFresh = (burst) => {
    const at = burst.publishedAt ? Date.parse(burst.publishedAt) : NaN;
    return Boolean(seenAt) && Number.isFinite(at) && at > seenAt;
  };

  if (status === 'loading' && bursts.length === 0) {
    return <PanelMessage icon={Loader2} spin label="Getting into it..." />;
  }
  if (bursts.length === 0) {
    return (
      <PanelMessage
        icon={Flame}
        label="Nothing to report. Suspiciously quiet."
        action={{ label: 'Try again', onClick: onReload }}
      />
    );
  }

  // "Queer press" filters on where a story came from rather than what sort
  // of thing it is, which is a different axis to the rest. It is here
  // because folding the news column into this feed would otherwise have
  // quietly removed the one filter that column existed to offer.
  const picked =
    kind === 'all'
      ? bursts
      : kind === 'queer-press'
        ? bursts.filter((burst) => burst.tone === 'queer')
        : bursts.filter((burst) => burst.kind === kind);

  const shown =
    order === 'latest'
      ? [...picked].sort(
          (a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0),
        )
      : rankAcrossChannels(picked);
  const freshCount = bursts.filter(isFresh).length;
  const queerPress = bursts.filter((burst) => burst.tone === 'queer').length;
  const chips = [
    ['all', 'Everything', bursts.length],
    ...GOSS_ORDER.filter((key) => (counts?.[key] ?? 0) > 0).map((key) => [
      key,
      GOSS_KINDS[key].label,
      counts[key],
    ]),
    ...(queerPress > 0 ? [['queer-press', 'Queer press', queerPress]] : []),
  ];

  return (
    <>
      {freshCount > 0 && (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-rose-50 dark:bg-rose-950/50 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:text-rose-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
          {freshCount} new since you last looked
        </p>
      )}

      <div className="mb-2 flex gap-1.5">
        {[
          ['top', 'Top', Flame],
          ['latest', 'Latest', Clock],
        ].map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setOrder(value)}
            aria-pressed={order === value}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all duration-200 ease-spring active:scale-95 ${
              order === value
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 hover:bg-slate-100'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
        {chips.map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            aria-pressed={kind === value}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
              kind === value
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 hover:bg-slate-100'
            }`}
          >
            {label}
            <span className="ml-1 opacity-60">{count}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <PanelMessage icon={Flame} label="Nothing of that sort right now." />
      )}

      <ul className="space-y-2">
        {shown.map((burst) => (
          <li key={burst.link}>
            <GossCard burst={burst} fresh={isFresh(burst)} />
          </li>
        ))}
      </ul>
    </>
  );
}

const MONTH_LABEL = (iso) =>
  new Date(iso).toLocaleDateString([], { month: 'long', year: 'numeric' });

const daysUntil = (iso) =>
  Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

/**
 * Grouped by month so a long scroll still reads as a calendar rather than a
 * list. The day block on the left is the anchor your eye follows down.
 */
function UpcomingPanel({
  games,
  recent,
  status,
  onReload,
  catalogTitles,
  saved,
  onToggleSaved,
  updates,
}) {
  const [when, setWhen] = useState('ahead');
  const [playing, setPlaying] = useState(null);

  const savedList = useMemo(
    () => [...games, ...recent].filter((game) => saved.has(game.id)),
    [games, recent, saved],
  );
  const list = when === 'ahead' ? games : when === 'out' ? recent : savedList;
  const updateFor = useMemo(() => new Map(updates.map((u) => [u.id, u])), [updates]);

  const months = useMemo(() => {
    const groups = new Map();
    for (const game of list) {
      const key = MONTH_LABEL(game.releaseDate);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(game);
    }
    return [...groups.entries()];
  }, [list]);

  if (status === 'loading' && games.length === 0 && recent.length === 0) {
    return <PanelMessage icon={Loader2} spin label="Checking the store calendar..." />;
  }
  if (games.length === 0 && recent.length === 0) {
    return (
      <PanelMessage
        icon={CalendarDays}
        label="No dated releases came back."
        action={{ label: 'Try again', onClick: onReload }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="no-scrollbar -mb-2 flex gap-1.5 overflow-x-auto">
        {[
          ['ahead', 'Coming soon', games.length],
          ['out', 'Just released', recent.length],
          ['saved', 'Saved', savedList.length],
        ].map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => setWhen(value)}
            aria-pressed={when === value}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
              when === value
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-1 ring-inset ring-slate-200 dark:ring-slate-700 hover:bg-slate-100'
            }`}
          >
            {value === 'saved' && <Bell className="h-3.5 w-3.5" />}
            {label}
            <span className={when === value ? 'text-white/60' : 'text-slate-400 dark:text-slate-500'}>{count}</span>
          </button>
        ))}
      </div>

      {updates.length > 0 && when !== 'saved' && (
        <button
          type="button"
          onClick={() => setWhen('saved')}
          className="flex w-full items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-left text-sm font-medium text-amber-800 dark:text-amber-200 ring-1 ring-inset ring-amber-200 dark:ring-amber-800 transition-transform duration-200 ease-spring active:scale-[0.99]"
        >
          <Bell className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {updates.length === 1
              ? `${updates[0].title}: ${UPDATE_TEXT[updates[0].kind](updates[0]).toLowerCase()}`
              : `${updates.length} of your saved games changed`}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0" />
        </button>
      )}

      {list.length === 0 && (
        <PanelMessage
          icon={when === 'saved' ? Bell : CalendarDays}
          label={
            when === 'saved'
              ? 'Nothing saved yet. Tap the bell on a release to follow it.'
              : when === 'ahead'
                ? 'Nothing dated ahead right now.'
                : 'Nothing has landed in the last two months.'
          }
        />
      )}

      {months.map(([month, entries]) => (
        <section key={month}>
          <h3 className="sticky top-0 z-10 -mx-1 mb-2 bg-slate-50/95 px-1 py-1 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 backdrop-blur">
            {month}
          </h3>
          <ul className="space-y-2">
            {entries.map((game) => {
              const date = new Date(game.releaseDate);
              const away = daysUntil(game.releaseDate);
              const inCatalog = catalogTitles.has(game.title.toLowerCase());
              const update = updateFor.get(game.id);
              const isPlaying = playing === game.id;

              return (
                <li key={game.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                  <div className="flex items-stretch gap-3 p-2.5">
                    <div className="flex w-12 shrink-0 flex-col items-center justify-center self-center rounded-lg bg-slate-900 py-1.5 text-white">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-white/60">
                        {date.toLocaleDateString([], { month: 'short' })}
                      </span>
                      <span className="text-lg font-bold leading-none tabular-nums">
                        {date.getDate()}
                      </span>
                    </div>

                    {game.art && (
                      <button
                        type="button"
                        onClick={() => game.trailer && setPlaying(isPlaying ? null : game.id)}
                        disabled={!game.trailer}
                        aria-label={game.trailer ? `Play the ${game.title} trailer` : undefined}
                        className="relative h-14 w-14 shrink-0 self-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800 disabled:cursor-default"
                      >
                        <img
                          src={game.art}
                          alt=""
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                          }}
                          className="h-full w-full object-cover"
                        />
                        {game.trailer && (
                          <span className="absolute inset-0 flex items-center justify-center bg-slate-900/35 text-white transition-colors hover:bg-slate-900/50">
                            <CirclePlay className="h-5 w-5 drop-shadow" />
                          </span>
                        )}
                      </button>
                    )}

                    <a
                      href={game.storeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 flex-1"
                    >
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
                        {game.title}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {game.publisher}
                        {game.genres?.length > 0 && ` · ${game.genres.join(', ')}`}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {update && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                            {UPDATE_TEXT[update.kind](update)}
                          </span>
                        )}
                        <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          {game.platforms?.join(' / ') || 'PS5'}
                        </span>
                        {away > 0 && away <= 30 && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                            {away <= 1 ? 'Tomorrow' : `in ${away} days`}
                          </span>
                        )}
                        {game.price && (
                          <span className="rounded bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                            {game.price}
                          </span>
                        )}
                        {inCatalog && (
                          <span className="rounded bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                            In catalog
                          </span>
                        )}
                      </div>
                    </a>

                    <button
                      type="button"
                      onClick={() => onToggleSaved(game)}
                      aria-pressed={saved.has(game.id)}
                      aria-label={
                        saved.has(game.id)
                          ? `Stop following ${game.title}`
                          : `Follow ${game.title} for date changes`
                      }
                      title={saved.has(game.id) ? 'Following' : 'Tell me if this changes'}
                      className={`tap inline-flex shrink-0 items-center justify-center self-center rounded-lg transition-colors ${
                        saved.has(game.id)
                          ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300'
                          : 'text-slate-300 dark:text-slate-600 hover:bg-slate-100 hover:text-slate-600'
                      }`}
                    >
                      <Bell className={`h-4 w-4 ${saved.has(game.id) ? 'fill-current' : ''}`} />
                    </button>
                  </div>

                  {isPlaying && game.trailer && (
                    <div className="border-t border-slate-100 dark:border-slate-800 p-2.5 pt-2">
                      <video
                        src={game.trailer}
                        poster={game.art ?? undefined}
                        controls
                        autoPlay
                        playsInline
                        className="w-full rounded-lg bg-black"
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PanelMessage({ icon: Icon, label, spin = false, action }) {
  return (
    <div className="py-16 text-center text-slate-500 dark:text-slate-400">
      <Icon className={`mx-auto mb-3 h-7 w-7 text-slate-300 dark:text-slate-600 ${spin ? 'animate-spin' : ''}`} />
      <p className="text-sm">{label}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-3 rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition-transform duration-200 ease-spring active:scale-95"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * A slide-over rather than another view mode: news and dates are things you
 * dip into and dismiss, and the catalog stays exactly where you left it.
 */
function BriefingDrawer({
  open,
  tab,
  onTab,
  onClose,
  catalogTitles,
  upcoming,
  saved,
  onToggleSaved,
  updates,
}) {
  const goss = useDeferredEndpoint('/api/goss', open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = tab === 'upcoming' ? upcoming : goss;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="News and releases">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-sm"
      />
      <aside className="relative flex h-full w-full max-w-md animate-slide-in flex-col border-l border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pt-[var(--inset-top)] shadow-2xl sm:max-w-lg lg:max-w-2xl">
        <header className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5">
          <div className="flex flex-1 gap-1">
            {[
              ['goss', 'Goss', Flame],
              ['upcoming', 'Upcoming', CalendarDays],
            ].map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => onTab(value)}
                aria-pressed={tab === value}
                className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-all duration-200 ease-spring active:scale-95 sm:h-9 ${
                  tab === value
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={active.reload}
            aria-label="Refresh"
            className="tap inline-flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:h-9 sm:min-h-0 sm:w-9 sm:min-w-0"
          >
            <RefreshCw className={`h-4 w-4 ${active.status === 'loading' ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="tap inline-flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:h-9 sm:min-h-0 sm:w-9 sm:min-w-0"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="no-scrollbar panel-scroll flex-1 overflow-y-auto p-3">
          {tab === 'goss' ? (
            <GossPanel
              bursts={goss.data?.bursts ?? []}
              counts={goss.data?.counts ?? null}
              status={goss.status}
              onReload={goss.reload}
            />
          ) : (
            <UpcomingPanel
              games={upcoming.data?.games ?? []}
              recent={upcoming.data?.recent ?? []}
              status={upcoming.status}
              onReload={upcoming.reload}
              catalogTitles={catalogTitles}
              saved={saved}
              onToggleSaved={onToggleSaved}
              updates={updates}
            />
          )}
        </div>

        <footer className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 pb-[calc(0.5rem+var(--inset-bottom))] pt-2 text-[11px] text-slate-400 dark:text-slate-500">
          {tab === 'goss'
            ? 'Posts, headlines and episodes from the people who said them. Tap through for the source.'
            : 'Read from the PS Store nightly, so delayed games move themselves and new ones turn up on their own.'}
        </footer>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

/** Compact on/off control used throughout the filter sheet. */
function TogglePill({ active, onClick, icon: Icon, label, count, tone, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
        active ? `${tone} text-white` : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${active && label === 'Wishlist' ? 'fill-current' : ''}`} />
      {label}
      {count !== undefined && count !== 0 && (
        <span className={active ? 'text-white/60' : 'text-slate-400 dark:text-slate-500'}>{count}</span>
      )}
    </button>
  );
}

/** Options are plain strings, or {value, label} when the two differ. */
/** A small caps label that turns one long panel into a few short ones. */
function SheetGroup({ label, children, className = '' }) {
  return (
    <div className={className}>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {label}
      </p>
      {children}
    </div>
  );
}

/** Light, dark, or follow the phone. */
function ThemePicker({ value, onChange }) {
  return (
    <div className="flex gap-1.5">
      {[
        ['system', 'Auto', Smartphone],
        ['light', 'Light', Sun],
        ['dark', 'Dark', Moon],
      ].map(([key, label, Icon]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={`inline-flex min-h-[2.25rem] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
            value === key
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

function Select({ label, value, options, onChange }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // w-full so a long label like "All Upgrade Types" is the select's
        // problem to shrink rather than overflowing its box, and a tighter
        // right pad so the native chevron does not sit on the text.
        className="w-full min-w-0 cursor-pointer truncate rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 py-2 pl-3 pr-8 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
      >
        {options.map((option) => {
          const optionValue = typeof option === 'string' ? option : option.value;
          const optionLabel = typeof option === 'string' ? option : option.label;
          return (
            <option key={optionValue} value={optionValue}>
              {optionValue === 'All' ? label : optionLabel}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export default function App() {
  const [filters, setFilters] = useState(readFiltersFromUrl);
  const [wishlist, setWishlist] = useState(readWishlist);
  const [dealAlerts, setDealAlerts] = useState(readDealAlerts);
  const [hidden, setHidden] = useState(readHidden);
  const [savedReleases, setSavedReleases] = useState(readSavedReleases);
  const [favouriteCreators, setFavouriteCreators] = useState(readFavouriteCreators);
  const [library, setLibrary] = useState(readLibrary);
  const [storeRowCache, setStoreRowCache] = useState(readSavedStoreRows);
  const [activeGameId, setActiveGameId] = useState(null);
  // Store-mirror games are keyed apart from catalog ids so both can share one
  // wishlist and one library without ever colliding.
  const [activeStoreGame, setActiveStoreGame] = useState(null);
  const [tonightOpen, setTonightOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const [feedMuted, setFeedMuted] = useState(readFeedMuted);

  const toggleFeedMuted = useCallback(() => {
    setFeedMuted((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(FEED_MUTED_KEY, next ? '1' : '0');
      } catch {
        // A browser refusing storage just means sound resets next visit.
      }
      return next;
    });
  }, []);
  const [wishlistPrices, setWishlistPrices] = useState(readWishlistPrices);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrolled = useScrollCollapse();

  const { byTitle, status, updatedAt, progress, refresh } = useLiveData(filters.region);
  const barRef = useRef(null);
  const collectionsRef = useRef(null);

  // A chip with no number on it reads as decorative rather than as a real
  // collection, so the mirror's size is fetched once, up front — this is a
  // few hundred bytes, not the 2.7MB index, and costs nothing idle.
  const [storeSize, setStoreSize] = useState(null);
  const [storePlus, setStorePlus] = useState(0);
  useEffect(() => {
    let live = true;
    fetch('/api/store?facets=1')
      .then((response) => response.json())
      .then((payload) => {
        if (!live) return;
        if (typeof payload.size === 'number') setStoreSize(payload.size);
        if (typeof payload.plus?.included === 'number') setStorePlus(payload.plus.included);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const [briefing, setBriefing] = useState({ open: false, tab: 'goss' });

  // The calendar is fetched when the panel opens, and also when something is
  // being followed — that is the only way the header can say a date moved
  // before you go looking.
  const upcoming = useDeferredEndpoint(
    '/api/upcoming',
    (briefing.open && briefing.tab === 'upcoming') ||
      savedReleases.size > 0 ||
      filters.collection === 'soon',
  );

  const releaseChanges = useMemo(
    () => releaseUpdates(savedReleases, upcoming.data),
    [savedReleases, upcoming.data],
  );

  /** Saving stores today's date so a later one reads as a change. */
  const toggleSavedRelease = useCallback((game) => {
    setSavedReleases((previous) => {
      const next = new Map(previous);
      if (next.has(game.id)) next.delete(game.id);
      else next.set(game.id, { id: game.id, title: game.title, releaseDate: game.releaseDate });
      try {
        localStorage.setItem(SAVED_RELEASES_KEY, JSON.stringify([...next.values()]));
      } catch {
        // Storage is a convenience; the in-memory map still works.
      }
      return next;
    });
  }, []);

  // Acknowledging an update means adopting the new date as the saved one.
  const clearReleaseChanges = useCallback(() => {
    setSavedReleases((previous) => {
      const next = new Map(previous);
      for (const change of releaseChanges) {
        const row = next.get(change.id);
        if (row) next.set(change.id, { ...row, releaseDate: change.to });
      }
      try {
        localStorage.setItem(SAVED_RELEASES_KEY, JSON.stringify([...next.values()]));
      } catch {
        // Same as above.
      }
      return next;
    });
  }, [releaseChanges]);

  // Lets the calendar mark a release we already track in the catalog, and lets
  // the store mirror hand a game back to its curated page when we have one.
  const curatedByName = useMemo(
    () => new Map(gamesData.map((game) => [game.title.toLowerCase(), game])),
    [],
  );
  const catalogTitles = useMemo(() => new Set(curatedByName.keys()), [curatedByName]);

  const set = useCallback(
    (key, value) => setFilters((previous) => ({ ...previous, [key]: value })),
    [],
  );

  // Filters live in the URL so a filtered view can be linked or bookmarked.
  useEffect(() => {
    writeFiltersToUrl(filters);
    try {
      localStorage.setItem('region', filters.region);
    } catch {
      // A browser refusing storage just means the region resets next visit.
    }
  }, [filters]);

  // The strip is wider than a phone, so a collection reached by any route
  // other than tapping its own chip would otherwise leave that chip off screen.
  useEffect(() => {
    const active = collectionsRef.current?.querySelector('[data-active]');
    active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [filters.collection]);

  useEffect(() => {
    const element = barRef.current;
    if (!element) return undefined;
    const publish = () => {
      document.documentElement.style.setProperty(
        '--bar-height',
        `${Math.round(element.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onPopState = () => setFilters(readFiltersFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const toggleFavouriteCreator = useCallback((handle) => {
    setFavouriteCreators((previous) => {
      const next = new Set(previous);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      try {
        localStorage.setItem(FAVOURITE_CREATORS_KEY, JSON.stringify([...next]));
      } catch {
        // Storage is a convenience; the in-memory set still works.
      }
      return next;
    });
  }, []);

  const toggleOwned = useCallback((id) => {
    setLibrary((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(LIBRARY_KEY, JSON.stringify([...next]));
      } catch {
        // Storage is a convenience; the in-memory set still works.
      }
      return next;
    });
  }, []);

  /** "Not for me": the game drops out of every list until you unhide it. */
  const hideGame = useCallback((id) => {
    setHidden((previous) => {
      const next = new Set(previous);
      next.add(id);
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      } catch {
        // Storage is a convenience; the in-memory set still works.
      }
      return next;
    });
  }, []);

  const unhideAll = useCallback(() => {
    setHidden(new Set());
    try {
      localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // Nothing to do: the in-memory set is already cleared.
    }
  }, []);

  const toggleWishlist = useCallback((id) => {
    setWishlist((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(WISHLIST_KEY, JSON.stringify([...next]));
      } catch {
        // Storage is a convenience here; the in-memory set still works.
      }
      return next;
    });
  }, []);

  /**
   * Keeps the row itself, not just its id.
   *
   * The wishlist draws from the catalog and a store game is not in it, so
   * hearting one has to keep enough of the row to draw a card from later.
   * The cache is additive and capped; what actually shows is whatever it
   * holds that is still hearted or owned, so un-hearting needs no bookkeeping.
   */
  const rememberStoreRow = useCallback((row) => {
    setStoreRowCache((previous) => {
      if (previous.some((entry) => entry.id === row.id)) return previous;
      const next = [...previous, row].slice(-MAX_SAVED_STORE);
      try {
        localStorage.setItem(SAVED_STORE_KEY, JSON.stringify(next));
      } catch {
        // Without storage the row lasts for this visit only.
      }
      return next;
    });
  }, []);

  /**
   * Hearting or owning a store game.
   *
   * A store row that is also in the curated catalog is saved under the
   * curated id, never its own: otherwise the same game could sit in the
   * wishlist twice, once with a write-up and once without. Everything else
   * caches its row first so the wishlist has something to draw.
   */
  const toggleStoreSaved = useCallback(
    (row, twin, kind) => {
      const toggle = kind === 'owned' ? toggleOwned : toggleWishlist;
      if (twin) {
        toggle(twin.id);
        return;
      }
      rememberStoreRow(row);
      toggle(storeKey(row));
    },
    [rememberStoreRow, toggleOwned, toggleWishlist],
  );

  const storeSaved = useMemo(
    () => ({ wishlist, library, hidden, toggle: toggleStoreSaved, hide: hideGame }),
    [wishlist, library, hidden, toggleStoreSaved, hideGame],
  );

  /**
   * Opening a game from any list.
   *
   * A curated game opens its write-up. Anything carrying a mirror row opens
   * the store view instead, which is the one that knows how to fetch detail
   * for a concept id. Without this a store game saved to the wishlist simply
   * did nothing when tapped, because the write-up is looked up in games.json
   * and a store id is not in there.
   */
  const openGame = useCallback((game) => {
    if (game.raw) setActiveStoreGame(game.raw);
    else setActiveGameId(game.id);
  }, []);

  /**
   * Hearting or owning from any list.
   *
   * A non-curated game has to leave its row behind as well as its id, or the
   * wishlist would hold something it cannot draw.
   */
  const saveGame = useCallback(
    (game, kind) => {
      if (game.raw) rememberStoreRow(game.raw);
      (kind === 'owned' ? toggleOwned : toggleWishlist)(game.id);
    },
    [rememberStoreRow, toggleOwned, toggleWishlist],
  );

  /**
   * The same thing from a bare mirror row, which is what the store view holds.
   *
   * Every path that saves a non-curated game has to come through one of these
   * two. The store view used to toggle the id directly and keep no row, so a
   * game hearted from inside it went into a wishlist that then showed nothing
   * at all.
   */
  const saveStoreRow = useCallback(
    (row, kind) => {
      rememberStoreRow(row);
      (kind === 'owned' ? toggleOwned : toggleWishlist)(storeKey(row));
    },
    [rememberStoreRow, toggleOwned, toggleWishlist],
  );

  const toggleDealAlert = useCallback((id) => {
    setDealAlerts((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(DEAL_ALERTS_KEY, JSON.stringify([...next]));
      } catch {
        // Storage is a convenience here; the in-memory set still works.
      }
      return next;
    });
  }, []);

  /** Watching a store game for deals keeps its row for the same reason. */
  const watchStoreRow = useCallback(
    (row) => {
      rememberStoreRow(row);
      toggleDealAlert(storeKey(row));
    },
    [rememberStoreRow, toggleDealAlert],
  );

  // Recomputed only when the library, wishlist or PS5 toggle changes; it never
  // touches live data, so it stays instant while prices are still loading.
  // With nothing owned or wishlisted yet there is no taste to work from, so
  // the collection falls back to a quality ranking rather than sitting empty
  // — an empty collection reads as broken, not as "add a game first".
  const profile = useMemo(() => buildProfile(gamesData, library, wishlist), [library, wishlist]);
  const geniusIsPersonalized = profile != null;
  const geniusPicks = useMemo(() => {
    const exclude = new Set([...library, ...wishlist, ...hidden]);
    return profile
      ? recommend(gamesData, profile, { exclude, limit: 48, includePs5: filters.includePs5 })
      : starterPicks(gamesData, { exclude, limit: 48, includePs5: filters.includePs5 });
  }, [profile, library, wishlist, hidden, filters.includePs5]);

  const geniusReasons = useMemo(
    () => new Map(geniusPicks.map((pick) => [pick.game.id, pick.reason])),
    [geniusPicks],
  );

  // Lay down the baseline price for anything newly wishlisted, once its live
  // price arrives. Written once per game and never revised, so the comparison
  // stays anchored to the day you added it.
  useEffect(() => {
    if (wishlist.size === 0) return;
    let added = false;
    const next = { ...wishlistPrices };
    for (const game of gamesData) {
      if (!wishlist.has(game.id) || next[game.id]) continue;
      const price = byTitle.get(game.title)?.price;
      if (!price || typeof price.final !== 'number') continue;
      next[game.id] = {
        final: price.final,
        formatted: price.finalFormatted,
        at: new Date().toISOString().slice(0, 10),
      };
      added = true;
    }
    if (!added) return;
    // eslint-disable-next-line react/set-state-in-effect
    setWishlistPrices(next);
    try {
      localStorage.setItem(WISHLIST_PRICES_KEY, JSON.stringify(next));
    } catch {
      // Storage is a convenience; the comparison just resets next visit.
    }
  }, [wishlist, byTitle, wishlistPrices]);

  /** Wishlisted games that are cheaper now than when they went on the list. */
  const wishlistDrops = useMemo(() => {
    const drops = [];
    for (const game of gamesData) {
      if (!wishlist.has(game.id)) continue;
      const price = byTitle.get(game.title)?.price;
      const baseline = wishlistPrices[game.id];
      if (!price || !baseline || typeof price.final !== 'number') continue;
      if (price.final < baseline.final) {
        drops.push({
          game,
          price,
          baseline,
          savedCents: baseline.final - price.final,
        });
      }
    }
    return drops.sort((a, b) => b.savedCents - a.savedCents);
  }, [wishlist, byTitle, wishlistPrices]);

  const savingsById = useMemo(
    () => new Map(wishlistDrops.map((drop) => [drop.game.id, drop.savedCents])),
    [wishlistDrops],
  );

  // The wishlist can only be mailed about if the server knows it exists, so
  // this is the one thing the app keeps off the phone, and only once asked.
  const savedStoreGames = useMemo(
    () =>
      storeRowCache
        .map(storeRowAsGame)
        .filter(
          (game) => wishlist.has(game.id) || library.has(game.id) || dealAlerts.has(game.id),
        ),
    [storeRowCache, wishlist, library, dealAlerts],
  );

  /**
   * The catalog, plus every store game that has been saved.
   *
   * Below this line nothing tells the two apart: same filters, same sorts,
   * same cards. A store row simply carries fewer facts, so the hand-made
   * filters pass over it on their own rather than having to be told to.
   */
  const catalog = useMemo(
    () => (savedStoreGames.length > 0 ? [...gamesData, ...savedStoreGames] : gamesData),
    [savedStoreGames],
  );

  const alerts = useAlerts(wishlist, dealAlerts, filters.region, savedStoreGames);

  // Keeps typing responsive while React re-filters in the background.
  const deferredQuery = useDeferredValue(filters.q);

  // Relevance for the current query, or null when nothing is being searched.
  // Title matches decide the result on their own; the genre/tag pass only runs
  // when no title matched at all, so "roguelike" finds roguelikes without
  // letting tags dilute a search for a name.

  /**
   * Upcoming and just-released games, in the catalog's shape.
   *
   * Unlike the store mirror this is small enough to hold in full, so it needs
   * no server paging and no special render path: it is simply the pool the
   * "Coming soon" collection filters, and every sort, chip and card works on
   * it unchanged.
   */
  const upcomingGames = useMemo(() => {
    const rows = [...(upcoming.data?.games ?? []), ...(upcoming.data?.recent ?? [])];
    return rows
      .filter((row) => row?.id && row?.title)
      .map((row) => storeRowAsGame(upcomingAsStoreRow(row), 'upcoming'));
  }, [upcoming.data]);

  /**
   * Searching looks in the whole store as well as the catalog.
   *
   * Typing a game's name and being told it is "not here, try the wider
   * store" is the clearest way the two halves gave themselves away as two
   * halves. The mirror is searched server side alongside the local catalog,
   * and the results arrive as ordinary games.
   *
   * The collection that already is the store does its own searching, and the
   * calendar is its own pool, so neither needs this.
   */
  const searchingWidely =
    deferredQuery.trim().length > 1 &&
    filters.collection !== 'all' &&
    filters.collection !== 'soon';

  const storeSearch = useStoreSearch({
    active: searchingWidely,
    q: searchingWidely ? deferredQuery.trim() : '',
    genre: '',
    sort: 'relevance',
  });

  const storeMatches = useMemo(() => {
    if (!searchingWidely) return [];
    // A game that is in the catalog, or already saved from the store, is
    // itself: the richer copy wins and the duplicate is dropped.
    const known = new Set(gamesData.map((game) => fold(game.title)));
    const saved = new Set(savedStoreGames.map((game) => game.id));
    return (storeSearch.games ?? [])
      .filter((row) => row?.name && !known.has(fold(row.name)) && !saved.has(`store:${row.id}`))
      .map((row) => storeRowAsGame(row));
  }, [searchingWidely, storeSearch.games, savedStoreGames]);

  const pool = useMemo(() => {
    if (filters.collection === 'soon') return upcomingGames;
    return storeMatches.length > 0 ? [...catalog, ...storeMatches] : catalog;
  }, [filters.collection, upcomingGames, catalog, storeMatches]);

  /**
   * The PS5 toggle is a fact about the curated catalog, which is built around
   * PS4 games that have an upgrade path. Almost everything releasing now is
   * PS5 only, so applying it to upcoming releases emptied the collection:
   * a hundred and thirty-seven games showed as fifteen, and every one of the
   * genuinely unreleased ones was among the hidden.
   *
   * Typing a game's name is the same kind of explicit request as saving one.
   * Searching "Wishing Well Simulator" and being told nothing matches, when
   * the only reason is that it happens to be PS5 only, is the browse default
   * answering a question nobody asked it.
   */
  const ignorePs5Filter = filters.collection === 'soon' || deferredQuery.trim().length > 1;

  const searchScores = useMemo(() => {
    const query = parseQuery(deferredQuery);
    if (!query.folded) return null;

    const titles = new Map();
    for (const game of pool) {
      const row = SEARCH_ROWS.get(game.id) ?? game.searchRow;
      const score = scoreMatch(row.title, query);
      if (score > 0) titles.set(game.id, score);
    }
    if (titles.size > 0) return titles;

    const meta = new Map();
    for (const game of pool) {
      const row = SEARCH_ROWS.get(game.id) ?? game.searchRow;
      const score = scoreMatch(row.meta, query);
      if (score > 0) meta.set(game.id, score);
    }
    return meta;
  }, [deferredQuery, pool]);

  /**
   * Curated games the mirror does not have, for a search inside All.
   *
   * The mirror is built by walking concept ids, and a good part of the PS4
   * back catalogue does not have a concept page to walk: Outer Wilds, No
   * Man's Sky, Firewatch and Stardew Valley are all in the catalog here with
   * product-path store links, and all four return nothing from the mirror.
   * 107 of the 306 written-up games are missing from it, 101 of them PS4.
   *
   * Making All store-backed therefore broke searching for them from the
   * default view, which is as basic a thing as this app does. They are put
   * back in front of the store results, which is also the right order: a game
   * with a full write-up is a better answer than a store row.
   */
  const curatedOnlyMatches = useMemo(() => {
    if (filters.collection !== 'all') return [];
    const query = deferredQuery.trim();
    if (query.length < 2 || !searchScores) return [];
    return catalog
      .filter((game) => searchScores.has(game.id) && !hidden.has(game.id))
      .sort((a, b) => (searchScores.get(b.id) ?? 0) - (searchScores.get(a.id) ?? 0))
      .slice(0, 24)
      .map((game) => ({ ...game, storeLive: byTitle.get(game.title) ?? game.storeLive }));
  }, [filters.collection, deferredQuery, searchScores, catalog, hidden, byTitle]);

  const filteredGames = useMemo(() => {
    const collection = COLLECTIONS.find((entry) => entry.value === filters.collection);

    const isGenius = filters.collection === 'genius';
    const geniusRank = isGenius
      ? new Map(geniusPicks.map((pick, index) => [pick.game.id, index]))
      : null;

    const matches = pool.filter((game) => {
      if (hidden.has(game.id)) return false;
      // Hiding PS5 only titles is a browse default, and saving something is
      // not browsing. Without this last clause, hearting an upcoming game
      // (almost all of which are PS5 only) put it in a wishlist that then
      // refused to show it.
      if (
        !ignorePs5Filter &&
        !filters.includePs5 &&
        game.platform === 'PS5' &&
        !wishlist.has(game.id) &&
        !library.has(game.id)
      ) {
        return false;
      }
      if (isGenius && !geniusRank.has(game.id)) return false;
      if (collection?.tag && !game.tags.includes(collection.tag)) return false;
      if (filters.collection === 'plus' && !byTitle.get(game.title)?.price?.plus?.included)
        return false;
      if (filters.collection === 'deals' && !(byTitle.get(game.title)?.price?.discountPercent > 0))
        return false;
      if (searchScores && !searchScores.has(game.id)) return false;
      if (filters.genre !== 'All' && game.genre !== filters.genre) return false;
      if (filters.protagonist !== 'All' && game.protagonist !== filters.protagonist) return false;
      if (filters.artStyle !== 'All' && game.artStyle !== filters.artStyle) return false;
      if (filters.upgrade !== 'All' && game.ps5Upgrade !== filters.upgrade) return false;
      if (filters.kidFriendly && !isKidFriendly(game.ageRating)) return false;
      // Unrated is unknown, not innocent: the same rule the kid filter uses.
      if (filters.noPurchases && (!game.ageRating || hasInGamePurchases(game.ageRating)))
        return false;
      if (filters.owned === 'owned' && !library.has(game.id)) return false;
      if (filters.owned === 'unowned' && library.has(game.id)) return false;
      if (filters.wishlist && !wishlist.has(game.id)) return false;
      if (filters.sale && !(byTitle.get(game.title)?.price?.discountPercent > 0)) return false;
      if (filters.atFloor) {
        const entry = byTitle.get(game.title);
        // No record is not the same as not at the floor, but it cannot be
        // shown as one either, so an unproven game is excluded rather than
        // claimed. The chip says "proven" for exactly that reason.
        if (!priceStanding(entry?.price, entry?.history)?.atLow) return false;
      }
      return true;
    });

    // While a search is running, closeness to what was typed is the order
    // that makes sense; an explicit sort still overrides it.
    if (searchScores && filters.sort === 'catalog') {
      return [...matches].sort(
        (a, b) =>
          searchScores.get(b.id) - searchScores.get(a.id) || a.title.localeCompare(b.title),
      );
    }

    const liveFor = (game) => byTitle.get(game.title);

    // The deals view ranks itself: deepest discount first, then biggest saving
    // in absolute terms, unless the reader picked an explicit sort.
    if (filters.collection === 'deals' && filters.sort === 'catalog') {
      return [...matches].sort((a, b) => {
        const priceA = liveFor(a)?.price;
        const priceB = liveFor(b)?.price;
        const cut = (priceB?.discountPercent ?? 0) - (priceA?.discountPercent ?? 0);
        if (cut !== 0) return cut;
        const savedA = (priceA?.initial ?? 0) - (priceA?.final ?? 0);
        const savedB = (priceB?.initial ?? 0) - (priceB?.final ?? 0);
        return savedB - savedA;
      });
    }

    // The picks arrive ranked, so catalog order means "keep the ranking".
    if (isGenius && filters.sort === 'catalog') {
      return [...matches].sort((a, b) => geniusRank.get(a.id) - geniusRank.get(b.id));
    }

    if (filters.sort === 'catalog') return matches;

    const liveOf = liveFor;
    const priceOf = (game) => liveOf(game)?.price?.final ?? Number.POSITIVE_INFINITY;
    const discountOf = (game) => liveOf(game)?.price?.discountPercent ?? -1;
    // "Best time to buy" ranks the lowest drop-likelihood first: the games
    // least likely to get cheaper are the ones worth buying today.
    const buyScoreOf = (game) => liveOf(game)?.prediction?.score ?? Number.POSITIVE_INFINITY;

    return [...matches].sort((a, b) => {
      if (filters.sort === 'title') return a.title.localeCompare(b.title);
      if (filters.sort === 'price') return priceOf(a) - priceOf(b);
      if (filters.sort === 'buy') return buyScoreOf(a) - buyScoreOf(b);
      return discountOf(b) - discountOf(a);
    });
  }, [pool, ignorePs5Filter, searchScores, filters, wishlist, library, hidden, byTitle, geniusPicks]);

  // Cards are added as you reach them rather than all at once; a different
  // filter, sort or collection is a different list, so it starts over.
  const { limit: shownLimit, attachEnd, hasMore } = usePagedList(
    filteredGames.length,
    `${filters.collection}|${filters.sort}|${filters.view}|${filteredGames.length}`,
  );
  const shownGames = useMemo(
    () => filteredGames.slice(0, shownLimit),
    [filteredGames, shownLimit],
  );

  // Scanning a list of discounts, the useful number is not how many are
  // discounted but how many are as cheap as this record has ever seen them.
  const atFloorCount = useMemo(() => {
    let count = 0;
    for (const game of filteredGames) {
      const live = byTitle.get(game.title);
      if (priceStanding(live?.price, live?.history)?.atLow) count += 1;
    }
    return count;
  }, [filteredGames, byTitle]);

  const visiblePool = useMemo(
    () => pool.filter((game) => ignorePs5Filter || filters.includePs5 || game.platform !== 'PS5'),
    [pool, ignorePs5Filter, filters.includePs5],
  );

  // Chip counts have to keep describing the catalog whatever is being
  // browsed, or switching to Coming soon would read every other chip as zero.
  const catalogPool = useMemo(
    () => catalog.filter((game) => filters.includePs5 || game.platform !== 'PS5'),
    [catalog, filters.includePs5],
  );

  const saleCount = useMemo(
    () => catalogPool.filter((game) => byTitle.get(game.title)?.price?.discountPercent > 0).length,
    [catalogPool, byTitle],
  );

  /**
   * Written-up games a Plus tier covers, read from their live price.
   *
   * These and the store's own scan answer the same question from different
   * ends, and neither covers the other: the price read only runs for the
   * written-up catalog, and the scan only reaches games that are in the
   * mirror. So the collection shows both, with these first.
   */
  const curatedPlusGames = useMemo(() => {
    const covered = catalogPool.filter(
      (game) => byTitle.get(game.title)?.price?.plus?.included,
    );
    // Typing in this collection has to narrow it. Without this the written-up
    // half ignored the query entirely: searching "Dredge" inside PS Plus
    // still listed Horizon Forbidden West and every other covered game,
    // while the store half filtered correctly, which reads as the search
    // being broken rather than as two lists with different rules.
    const narrowed =
      deferredQuery.trim().length > 1 && searchScores
        ? covered.filter((game) => searchScores.has(game.id))
        : covered;
    // The store panel reads live data off the game, so it has to travel with
    // it; without this the card shows a loading bar where the price and the
    // PS Plus badge belong.
    return narrowed.map((game) => ({ ...game, storeLive: byTitle.get(game.title) }));
  }, [catalogPool, byTitle, deferredQuery, searchScores]);
  const plusCount = curatedPlusGames.length;

  // Over the whole pool, not the filtered results: a chip that counted its own
  // output would read zero the moment you switched it on.
  const atFloorTotal = useMemo(
    () =>
      visiblePool.filter((game) => {
        const entry = byTitle.get(game.title);
        return priceStanding(entry?.price, entry?.history)?.atLow;
      }).length,
    [visiblePool, byTitle],
  );

  const kidFriendlyCount = useMemo(
    () => catalogPool.filter((game) => isKidFriendly(game.ageRating)).length,
    [catalogPool],
  );

  const noPurchasesCount = useMemo(
    () =>
      catalogPool.filter((game) => game.ageRating && !hasInGamePurchases(game.ageRating)).length,
    [catalogPool],
  );

  const collectionCounts = useMemo(() => {
    // A lookup rather than another rung on a ternary ladder: there are now
    // five collections that count something of their own and the nesting had
    // stopped being readable.
    const special = {
      all: storeSize,
      curated: catalogPool.length,
      soon: upcomingGames.length,
      deals: saleCount,
      // Both ends of the same question. The overlap is small while the scan
      // is early, and a chip that undercounts is worse than one that is a
      // little generous about a game appearing on both lists.
      plus: plusCount + storePlus,
      genius: geniusPicks.length,
    };
    const counts = {};
    for (const entry of COLLECTIONS) {
      counts[entry.value] =
        entry.value in special
          ? (special[entry.value] ?? null)
          : entry.tag
            ? catalogPool.filter((game) => game.tags.includes(entry.tag)).length
            : catalogPool.length;
    }
    return counts;
  }, [catalogPool, saleCount, plusCount, storePlus, geniusPicks, storeSize, upcomingGames]);

  const activeGame = activeGameId ? gamesData.find((game) => game.id === activeGameId) : null;

  const clearFilters = () =>
    setFilters((previous) => ({
      ...DEFAULT_FILTERS,
      region: previous.region,
      sort: previous.sort,
      collection: previous.collection,
      includePs5: previous.includePs5,
    }));

  // Removable chips so a collapsed bar still shows what is being filtered.
  const activeChips = useMemo(() => {
    const chips = [];
    const add = (key, label, clear) => chips.push({ key, label, clear });
    if (filters.q) add('q', `"${filters.q}"`, () => set('q', ''));
    if (filters.genre !== 'All') add('genre', filters.genre, () => set('genre', 'All'));
    if (filters.protagonist !== 'All')
      add('protagonist', filters.protagonist, () => set('protagonist', 'All'));
    if (filters.artStyle !== 'All') add('art', filters.artStyle, () => set('artStyle', 'All'));
    if (filters.upgrade !== 'All') add('upgrade', filters.upgrade, () => set('upgrade', 'All'));
    if (filters.sale) add('sale', 'On sale', () => set('sale', false));
    if (filters.atFloor) add('floor', 'At its lowest', () => set('atFloor', false));
    if (filters.kidFriendly) add('kids', 'Kid friendly', () => set('kidFriendly', false));
    if (filters.noPurchases)
      add('nomtx', 'No in-game purchases', () => set('noPurchases', false));
    if (filters.wishlist) add('wishlist', 'Wishlist', () => set('wishlist', false));
    if (filters.owned !== 'any')
      add('owned', filters.owned === 'owned' ? 'In my library' : 'Not owned', () =>
        set('owned', 'any'),
      );
    return chips;
  }, [filters, set]);

  const activeFilterCount = activeChips.length;

  // The feed scrolls inside its own container, so the window listener never
  // fires there. Keeping the bar compact also keeps the slide height stable.
  const compact = scrolled || filters.view === 'feed';

  const filtersActive =
    Boolean(filters.q) ||
    filters.sale ||
    filters.atFloor ||
    filters.wishlist ||
    filters.kidFriendly ||
    filters.owned !== 'any' ||
    activeFilterCount > 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-50">
      {/* Control bar. Collapses to a single compact row as soon as you scroll
          down, and springs back the moment you scroll up. */}
      <header
        ref={barRef}
        style={{ paddingTop: 'calc(var(--inset-top) + var(--bar-pad))' }}
        className={`gutter sticky top-0 z-20 transition-[padding] duration-300 ease-swift ${
          filters.view === 'feed'
            ? 'feed-header absolute inset-x-0 border-b-0 bg-transparent'
            : 'border-b border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 backdrop-blur'
        } ${compact ? '[--bar-pad:0.5rem] pb-2' : '[--bar-pad:0.75rem] pb-3 sm:pb-4 sm:[--bar-pad:1rem]'}`}
      >
        <div className="mx-auto max-w-7xl">
          {/* Always-visible row: identity, search, filters, view switch. */}
          <div className="flex items-center gap-2">
            <h1
              className={`hidden shrink-0 font-bold tracking-tight text-slate-800 dark:text-slate-100 transition-all duration-300 ease-swift sm:block ${
                compact ? 'text-base' : 'text-lg sm:text-2xl'
              }`}
            >
              PS<span className="text-indigo-600 dark:text-indigo-300">4→5</span>
              <span className="hidden sm:inline"> Catalog</span>
            </h1>

            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search titles"
                placeholder="Search games"
                enterKeyHint="search"
                className="w-full rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 py-2 pl-8 pr-3 text-base outline-none transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 sm:py-1.5 sm:text-sm"
                value={filters.q}
                onChange={(event) => set('q', event.target.value)}
              />
            </div>

            <button
              type="button"
              onClick={() => setSheetOpen((open) => !open)}
              aria-expanded={sheetOpen}
              aria-label="Filters"
              className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-all duration-200 ease-spring active:scale-95 sm:h-9 ${
                sheetOpen || activeFilterCount > 0
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="tabular-nums">{activeFilterCount}</span>
              )}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-300 ease-spring ${
                  sheetOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => setTonightOpen(true)}
              aria-label="Pick something to play"
              title="What should I play?"
              className="pointer-only inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:text-amber-300 transition-all duration-200 ease-spring hover:rotate-12 hover:bg-amber-200 active:scale-90 disabled:opacity-40"
            >
              <Dices className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() =>
                setBriefing({
                  open: true,
                  tab: releaseChanges.length > 0 ? 'upcoming' : briefing.tab,
                })
              }
              aria-label={
                releaseChanges.length > 0
                  ? `News and upcoming releases, ${releaseChanges.length} update${releaseChanges.length === 1 ? '' : 's'}`
                  : 'News and upcoming releases'
              }
              title="News & upcoming"
              className="relative pointer-only inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:text-sky-300 transition-all duration-200 ease-spring hover:bg-sky-200 active:scale-90"
            >
              <Newspaper className="h-4 w-4" />
              {releaseChanges.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {releaseChanges.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => set('view', filters.view === 'feed' ? 'grid' : 'feed')}
              aria-label={filters.view === 'feed' ? 'Switch to grid' : 'Switch to feed'}
              title={filters.view === 'feed' ? 'Grid view' : 'Feed view'}
              className="pointer-only inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all duration-200 ease-spring hover:bg-slate-200 active:scale-90"
            >
              {filters.view === 'feed' ? (
                <LayoutGrid className="h-4 w-4" />
              ) : (
                <Rows3 className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Collection strip: one compact scrollable row, hidden once collapsed. */}
          <div
            className={`overflow-hidden transition-all duration-300 ease-swift ${
              compact && !sheetOpen ? 'max-h-0 opacity-0' : 'mt-2 max-h-16 opacity-100'
            }`}
          >
            <nav
              ref={collectionsRef}
              aria-label="Collections"
              className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5"
            >
              {COLLECTIONS.map((entry, index) => {
                const active = filters.collection === entry.value;
                return (
                  <Fragment key={entry.value}>
                    {/* The moods are a different question from the places, so
                        the strip shows the seam rather than running eleven
                        chips together as one undifferentiated row. */}
                    {entry.mood && !COLLECTIONS[index - 1]?.mood && (
                      <span
                        aria-hidden="true"
                        className="my-1.5 w-px shrink-0 bg-slate-200 dark:bg-slate-700"
                      />
                    )}
                    <button
                      type="button"
                      data-active={active ? 'true' : undefined}
                      onClick={() => set('collection', entry.value)}
                      aria-current={active ? 'true' : undefined}
                      className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 sm:h-7 ${
                        active
                          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                      }`}
                    >
                      {entry.value === 'deals' && <BadgePercent className="h-3.5 w-3.5" />}
                      {entry.value === 'genius' && <Sparkles className="h-3.5 w-3.5" />}
                      {entry.label}
                      {/* Only the open collection shows its size. Eleven
                          counts spent 240px of a 390px screen telling you ten
                          numbers you had not asked for, and the one you did
                          want is for the list you are actually looking at. */}
                      {active && collectionCounts[entry.value] != null && (
                        <span className="tabular-nums text-white/60 dark:text-slate-900/50">
                          {collectionCounts[entry.value]}
                        </span>
                      )}
                    </button>
                  </Fragment>
                );
              })}
            </nav>
          </div>

          {/* Filter sheet: everything else lives here instead of on screen. */}
          {sheetOpen && (
            <div className="mt-3 animate-sheet-down space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-sm">
              <SheetGroup label="Refine">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Select
                  label="All Genres"
                  value={filters.genre}
                  options={GENRES}
                  onChange={(value) => set('genre', value)}
                />
                <Select
                  label="All Protagonists"
                  value={filters.protagonist}
                  options={PROTAGONISTS}
                  onChange={(value) => set('protagonist', value)}
                />
                <Select
                  label="All Art Styles"
                  value={filters.artStyle}
                  options={ART_STYLES}
                  onChange={(value) => set('artStyle', value)}
                />
                <Select
                  label="All Upgrade Types"
                  value={filters.upgrade}
                  options={UPGRADES}
                  onChange={(value) =>
                    setFilters((previous) => ({
                      ...previous,
                      upgrade: value,
                      includePs5: value === 'PS5 Only' ? true : previous.includePs5,
                    }))
                  }
                />
                <Select
                  label="Sort"
                  value={filters.sort}
                  options={SORTS}
                  onChange={(value) => set('sort', value)}
                />
                <Select
                  label="Region"
                  value={filters.region}
                  options={REGIONS}
                  onChange={(value) => set('region', value)}
                />
              </div>

              </SheetGroup>

              <SheetGroup label="Show only">
              <div className="flex flex-wrap items-center gap-1.5">
                <TogglePill
                  active={filters.sale}
                  onClick={() => set('sale', !filters.sale)}
                  icon={BadgePercent}
                  label="On sale"
                  count={saleCount}
                  tone="bg-rose-600"
                />
                <TogglePill
                  active={filters.atFloor}
                  onClick={() => set('atFloor', !filters.atFloor)}
                  icon={TrendingDown}
                  label="At its lowest"
                  count={atFloorTotal}
                  tone="bg-emerald-600"
                />
                <TogglePill
                  active={filters.kidFriendly}
                  onClick={() => set('kidFriendly', !filters.kidFriendly)}
                  icon={Baby}
                  label="Kid friendly"
                  count={kidFriendlyCount}
                  tone="bg-emerald-600"
                />
                <TogglePill
                  active={filters.noPurchases}
                  onClick={() => set('noPurchases', !filters.noPurchases)}
                  icon={Wallet}
                  label="No in-game purchases"
                  count={noPurchasesCount}
                  tone="bg-sky-600"
                />
                <TogglePill
                  active={filters.wishlist}
                  onClick={() => set('wishlist', !filters.wishlist)}
                  icon={Heart}
                  label="Wishlist"
                  count={wishlist.size}
                  tone="bg-rose-600"
                />
                {/* One pill for one question. Owned and not-owned were two
                    controls spending two slots of a wrapping row on a single
                    three-state answer, and they could never both be on. */}
                <TogglePill
                  active={filters.owned !== 'any'}
                  onClick={() =>
                    set(
                      'owned',
                      filters.owned === 'any'
                        ? 'owned'
                        : filters.owned === 'owned'
                          ? 'unowned'
                          : 'any',
                    )
                  }
                  icon={filters.owned === 'unowned' ? Sparkles : CircleCheck}
                  label={
                    filters.owned === 'owned'
                      ? 'I own it'
                      : filters.owned === 'unowned'
                        ? 'Not owned'
                        : 'Owned?'
                  }
                  ariaLabel={
                    filters.owned === 'owned'
                      ? 'Showing games you own. Tap for games you do not own.'
                      : filters.owned === 'unowned'
                        ? 'Showing games you do not own. Tap to stop filtering by library.'
                        : 'Not filtering by library. Tap for games you own.'
                  }
                  count={filters.owned === 'owned' ? library.size : undefined}
                  tone={filters.owned === 'unowned' ? 'bg-slate-700' : 'bg-emerald-600'}
                />
                {/* The pill's own on state says whether it is on, so the word
                    "on" next to it was a label for the label. */}
                <TogglePill
                  active={filters.includePs5}
                  onClick={() => set('includePs5', !filters.includePs5)}
                  icon={Gamepad2}
                  label="PS5-only"
                  tone="bg-violet-600"
                />

              </div>
              </SheetGroup>

              <div className="grid gap-3 sm:grid-cols-2">
                <SheetGroup label="Appearance">
                  <ThemePicker value={theme} onChange={setTheme} />
                </SheetGroup>

                <SheetGroup label="Live data">
                  <div className="flex items-center justify-between gap-3">
                    <LiveStatus
                      status={status}
                      progress={progress}
                      updatedAt={updatedAt}
                      onRefresh={refresh}
                    />
                    {filtersActive && (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </SheetGroup>
              </div>
            </div>
          )}

          {/* Active filters stay visible as removable chips once collapsed. */}
          {compact && !sheetOpen && filtersActive && (
            <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.clear}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 transition-transform duration-200 ease-spring active:scale-95"
                >
                  {chip.label}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {filters.view === 'feed' ? (
        /* Feed: one game per screen, snapped, scrolled with a flick. */
        <main
          className="feed-scroll no-scrollbar h-[calc(100dvh-var(--bar-height))] overflow-y-auto"
          aria-label="Game feed"
        >
          {/* The collection chip has to mean the same thing in both views.
              Whole store used to fall through to the curated list here. */}
          {filters.collection === 'all' || filters.collection === 'plus' ? (
            <StoreFeed
              query={deferredQuery.trim()}
              curatedFirst={filters.collection === 'plus' ? curatedPlusGames : curatedOnlyMatches}
              plusOnly={filters.collection === 'plus'}
              familyOnly={filters.kidFriendly}
              noPurchases={filters.noPurchases}
              curatedReason={
                filters.collection === 'plus'
                  ? 'In your catalog, covered by Plus'
                  : 'Written up here; the store mirror has no page for it'
              }
              curatedByName={curatedByName}
              saved={storeSaved}
              muted={feedMuted}
              onToggleMuted={toggleFeedMuted}
              onOpenCurated={setActiveGameId}
              onOpenStore={setActiveStoreGame}
            />
          ) : (
            shownGames.map((game) => (
            <FeedSlide
              key={game.id}
              game={game}
              live={byTitle.get(game.title) ?? game.storeLive}
              wishlisted={wishlist.has(game.id)}
              reason={filters.collection === 'genius' ? geniusReasons.get(game.id) : undefined}
              muted={feedMuted}
              onToggleMuted={toggleFeedMuted}
              onToggleWishlist={() => saveGame(game, 'wishlist')}
              onOpen={() => openGame(game)}
            />
          ))
          )}
          {filters.collection !== 'all' && filters.collection !== 'plus' && hasMore && (
            <div ref={attachEnd} aria-hidden="true" className="h-px" />
          )}
          {filters.collection !== 'all' && filters.collection !== 'plus' && filteredGames.length === 0 && (
            <EmptyState
              filters={filters}
              wishlist={wishlist}
              library={library}
              status={status}
              onClear={clearFilters}
              onSearchStore={() => set('collection', 'all')}
            />
          )}
        </main>
      ) : (
        <main className="gutter pb-nav mx-auto max-w-7xl pt-3">
          {filters.collection === 'all' || filters.collection === 'plus' ? (
            <StorePanel
              query={deferredQuery.trim()}
              curatedFirst={filters.collection === 'plus' ? curatedPlusGames : curatedOnlyMatches}
              plusOnly={filters.collection === 'plus'}
              familyOnly={filters.kidFriendly}
              noPurchases={filters.noPurchases}
              curatedReason={
                filters.collection === 'plus'
                  ? 'In your catalog, covered by Plus'
                  : 'Written up here; the store mirror has no page for it'
              }
              curatedByName={curatedByName}
              saved={storeSaved}
              onOpenCurated={setActiveGameId}
              onOpenStore={setActiveStoreGame}
              // Out of the PS Plus filter as well as into the search. A
              // monthly game is claimed and kept, not part of the catalog,
              // so looking for one inside a list of catalog games finds
              // nothing: tapping "Hunt: Showdown 1896" there returned an
              // empty screen, which reads as the search being broken rather
              // than as the two meanings of "on PS Plus" being different.
              onSearch={(name) =>
                setFilters((previous) => ({ ...previous, q: name, collection: 'all' }))
              }
            />
          ) : (
            <>
          <p className="mb-3 text-xs font-medium text-slate-400 dark:text-slate-500">
            {/* While the store is being searched too, the denominator is
                whatever the search happened to pull back, which is not a
                number that means anything. The count of matches is. */}
            {storeMatches.length > 0
              ? `${filteredGames.length} ${filteredGames.length === 1 ? 'match' : 'matches'}, catalog and store`
              : `${filteredGames.length} of ${visiblePool.length} games`}
            {atFloorCount > 0 && (
              <span className="font-semibold text-emerald-600 dark:text-emerald-300">
                {' '}
                · {atFloorCount} at {atFloorCount === 1 ? 'its' : 'their'} lowest yet
              </span>
            )}
            {COLLECTION_BLURBS[filters.collection] &&
              ` · ${COLLECTION_BLURBS[filters.collection]}`}
          </p>

          {wishlistDrops.length > 0 && !filters.wishlist && (
            <button
              type="button"
              onClick={() => set('wishlist', true)}
              className="mb-3 flex w-full items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 px-3 py-2.5 text-left text-sm font-medium text-rose-800 dark:text-rose-200 ring-1 ring-inset ring-rose-200 dark:ring-rose-800 transition-transform duration-200 ease-spring active:scale-[0.99]"
            >
              <Heart className="h-4 w-4 shrink-0 fill-current" />
              <span className="flex-1">
                {wishlistDrops.length === 1
                  ? `${wishlistDrops[0].game.title} is ${formatSaving(wishlistDrops[0].savedCents)} cheaper than when you added it`
                  : `${wishlistDrops.length} on your wishlist are cheaper than when you added them`}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0" />
            </button>
          )}

          {/* The one place the offer makes sense: you have things you want, and
              they are the things an email would be about. */}
          {(wishlist.size > 0 || dealAlerts.size > 0) && (
            <button
              type="button"
              onClick={() => setAlertsOpen(true)}
              className={`mb-3 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium ring-1 ring-inset transition-transform duration-200 ease-spring active:scale-[0.99] ${
                alerts.pushEnabled || alerts.emailConfirmed
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-800'
                  : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 ring-indigo-200 dark:ring-indigo-800'
              }`}
            >
              {alerts.pushEnabled || alerts.emailConfirmed ? (
                <Check className="h-4 w-4 shrink-0" />
              ) : (
                <Bell className="h-4 w-4 shrink-0" />
              )}
              <span className="flex-1">
                {alerts.pushEnabled || alerts.emailConfirmed
                  ? `Watching ${alerts.watching === 1 ? '1 game' : `${alerts.watching} games`} for price drops`
                  : alerts.token && alerts.email
                    ? 'Confirm your email to start getting drop alerts'
                    : `Tell me when ${alerts.watchable.length === 1 ? 'it goes' : 'these go'} on sale`}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0" />
            </button>
          )}

          {filters.collection === 'genius' && !geniusIsPersonalized && (
            <p className="mb-3 inline-flex items-start gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 px-3 py-2 text-sm leading-relaxed text-indigo-700 dark:text-indigo-300">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong className="font-semibold">Starter picks</strong>, highly rated across the
                catalog. Tick the check on a game you own, or heart one you want, and these turn
                into picks based on your own taste.
              </span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {shownGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                live={byTitle.get(game.title) ?? game.storeLive}
                wishlisted={wishlist.has(game.id)}
                owned={library.has(game.id)}
                reason={filters.collection === 'genius' ? geniusReasons.get(game.id) : undefined}
                saving={savingsById.get(game.id)}
                onToggleWishlist={() => saveGame(game, 'wishlist')}
                onOpen={() => openGame(game)}
              />
            ))}
          </div>

          {hasMore && <div ref={attachEnd} aria-hidden="true" className="h-8" />}

          {hidden.size > 0 && (
            <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
              {hidden.size} hidden.{' '}
              <button
                type="button"
                onClick={unhideAll}
                className="font-medium text-indigo-600 dark:text-indigo-300 hover:underline"
              >
                Show them again
              </button>
            </p>
          )}

          {filteredGames.length === 0 && (
            <EmptyState
              filters={filters}
              wishlist={wishlist}
              library={library}
              status={status}
              onClear={clearFilters}
              onSearchStore={() => set('collection', 'all')}
            />
          )}

          {/* The curated 298 will not have everything; the mirror will. */}
          {deferredQuery.trim().length > 1 && (
            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => set('collection', 'all')}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-300 hover:underline"
              >
                <Search className="h-4 w-4" />
                Look for &ldquo;{deferredQuery.trim()}&rdquo; in the whole store
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          )}
            </>
          )}
        </main>
      )}

      {activeGame && (
        <GameModal
          key={activeGame.id}
          game={activeGame}
          live={byTitle.get(activeGame.title)}
          pool={visiblePool}
          byTitle={byTitle}
          onOpen={setActiveGameId}
          favouriteCreators={favouriteCreators}
          onToggleFavouriteCreator={toggleFavouriteCreator}
          wishlisted={wishlist.has(activeGame.id)}
          owned={library.has(activeGame.id)}
          reason={geniusReasons.get(activeGame.id)}
          onHide={() => {
            hideGame(activeGame.id);
            setActiveGameId(null);
          }}
          dealWatched={dealAlerts.has(activeGame.id)}
          alertsArmed={alerts.pushEnabled || alerts.emailConfirmed}
          onToggleDealAlert={() => toggleDealAlert(activeGame.id)}
          onOpenAlerts={() => setAlertsOpen(true)}
          onToggleWishlist={() => toggleWishlist(activeGame.id)}
          onToggleOwned={() => toggleOwned(activeGame.id)}
          onClose={() => setActiveGameId(null)}
        />
      )}

      {alertsOpen && <AlertsSheet alerts={alerts} onClose={() => setAlertsOpen(false)} />}

      {tonightOpen && (
        <TonightSheet
          catalog={gamesData}
          library={library}
          hidden={hidden}
          onOpenGame={(id) => {
            setTonightOpen(false);
            setActiveGameId(id);
          }}
          onClose={() => setTonightOpen(false)}
        />
      )}

      {activeStoreGame && (
        <StoreGameModal
          key={activeStoreGame.id}
          game={activeStoreGame}
          region={filters.region}
          wishlisted={wishlist.has(storeKey(activeStoreGame))}
          owned={library.has(storeKey(activeStoreGame))}
          dealWatched={dealAlerts.has(storeKey(activeStoreGame))}
          alertsArmed={alerts.pushEnabled || alerts.emailConfirmed}
          onToggleDealAlert={() => watchStoreRow(activeStoreGame)}
          onOpenAlerts={() => setAlertsOpen(true)}
          onToggleWishlist={() => saveStoreRow(activeStoreGame, 'wishlist')}
          onToggleOwned={() => saveStoreRow(activeStoreGame, 'owned')}
          onClose={() => setActiveStoreGame(null)}
        />
      )}

      <BottomBar
        view={filters.view}
        onView={(view) => set('view', view)}
        onBriefing={(tab) =>
          setBriefing({
            open: true,
            tab: tab ?? (releaseChanges.length > 0 ? 'upcoming' : briefing.tab),
          })
        }
        onSurprise={() => setTonightOpen(true)}
        canSurprise
        updates={releaseChanges.length}
      />

      <BriefingDrawer
        open={briefing.open}
        tab={briefing.tab}
        onTab={(tab) => setBriefing((previous) => ({ ...previous, tab }))}
        onClose={() => {
          // Closing the panel is the acknowledgement: you have seen the change.
          if (briefing.tab === 'upcoming') clearReleaseChanges();
          setBriefing((previous) => ({ ...previous, open: false }));
        }}
        catalogTitles={catalogTitles}
        upcoming={upcoming}
        saved={savedReleases}
        onToggleSaved={toggleSavedRelease}
        updates={releaseChanges}
      />
    </div>
  );
}

function LiveStatus({ status, progress, updatedAt, onRefresh }) {
  if (status === 'loading') {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading live prices and art... {Math.round(progress * 100)}%
      </span>
    );
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-300 hover:underline"
      >
        <ImageIcon className="h-4 w-4" />
        Live data unavailable — retry
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onRefresh}
      className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 transition-colors hover:text-slate-800"
    >
      <RefreshCw className="h-4 w-4" />
      Prices updated{' '}
      {updatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </button>
  );
}
