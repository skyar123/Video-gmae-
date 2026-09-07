import {
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
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CirclePlay,
  Dices,
  ExternalLink,
  Gamepad2,
  Heart,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Loader2,
  Newspaper,
  RefreshCw,
  Rows3,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  Users,
  VolumeX,
  X,
} from 'lucide-react';
import { buildProfile, recommend } from './recommend.js';
import gamesData from './games.json';
import creatorsData from './creators.json';

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
const COLLECTIONS = [
  { value: 'all', label: 'All games', tag: null },
  { value: 'genius', label: 'Genius picks', tag: null },
  { value: 'deals', label: 'Best deals', tag: null },
  { value: 'graphics', label: 'Best graphics', tag: 'graphics' },
  { value: 'social', label: 'Online & social', tag: 'social' },
  { value: 'cozy', label: 'Cozy', tag: 'cozy' },
  { value: 'classic', label: 'Classics', tag: 'classic' },
  { value: 'queer', label: 'Queer stories', tag: 'queer' },
  { value: 'disability', label: 'Disability rep', tag: 'disability' },
  { value: 'store', label: 'Whole store', tag: null },
];

const COLLECTION_BLURBS = {
  genius:
    'Worked out from the games you own and want, with the reason for each pick.',
  deals: 'Everything discounted right now, deepest cut first. Updates with the storefront.',
  graphics: 'Technical showcases and standout art direction.',
  social: 'Online play, co-op and couch multiplayer.',
  cozy: 'Low-stress games with gentle pacing and no fail state to speak of.',
  classic: 'Older PlayStation games and remasters you can play on a PS4 or PS5 today.',
  queer: 'Games with queer characters or relationships that matter to the story, not background detail.',
  disability: 'Games with disabled or neurodivergent characters, or landmark accessibility work.',
  store:
    "Everything indexed from the PlayStation Store itself. No hand-written notes on these — store facts and PlayStation's own star rating only.",
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
  'Free PS5 Upgrade': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  'PS4 & PS5 Cross-Buy': 'bg-sky-50 text-sky-700 ring-sky-600/20',
  'Paid PS5 Upgrade': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  'Backwards Compatible': 'bg-slate-100 text-slate-600 ring-slate-500/20',
  'PS5 Only': 'bg-violet-50 text-violet-700 ring-violet-600/20',
  'PS Plus Classic': 'bg-teal-50 text-teal-700 ring-teal-600/20',
};

const VERDICT_STYLES = {
  'buy-now': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  wait: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  hold: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  'too-new': 'bg-sky-50 text-sky-700 ring-sky-600/20',
  unknown: 'bg-slate-100 text-slate-500 ring-slate-500/20',
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
  wishlist: false,
  sort: 'catalog',
  region: 'US',
  collection: 'all',
  kidFriendly: false,
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
    wishlist: params.get('wishlist') === '1',
    sort: value('sort', 'catalog'),
    region: (value('cc', localStorage.getItem('region') || 'US') || 'US').toUpperCase(),
    collection: value('view', 'all'),
    kidFriendly: params.get('kids') === '1',
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
  if (filters.wishlist) params.set('wishlist', '1');
  if (filters.sort !== 'catalog') params.set('sort', filters.sort);
  if (filters.region !== 'US') params.set('cc', filters.region);
  if (filters.collection !== 'all') params.set('view', filters.collection);
  if (filters.kidFriendly) params.set('kids', '1');
  if (filters.owned !== 'any') params.set('owned', filters.owned);
  if (filters.view === 'feed') params.set('mode', 'feed');
  if (filters.includePs5) params.set('ps5', '1');
  const query = params.toString();
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
}

const WISHLIST_KEY = 'wishlist';
const LIBRARY_KEY = 'library';
const HIDDEN_KEY = 'hidden';
const SAVED_RELEASES_KEY = 'savedReleases';

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

function readHidden() {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
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

/**
 * Pulls artwork, screenshots, trailers, sale prices and drop predictions from
 * /api/games, one fixed chunk at a time. Chunk URLs are identical for every
 * visitor, so the CDN can serve most of these without touching the upstream
 * storefront. Cards render immediately and fill in as chunks land.
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

      for (let chunk = 0; chunk < CHUNK_COUNT; chunk += 1) {
        if (runId.current !== run) return;
        try {
          const response = await fetch(`/api/games?chunk=${chunk}&cc=${region}`, {
            cache: force ? 'reload' : 'default',
          });
          if (!response.ok) throw new Error(`request failed: ${response.status}`);
          const payload = await response.json();
          if (runId.current !== run) return;

          setByTitle((previous) => {
            const next = new Map(previous);
            for (const game of payload.games ?? []) next.set(game.title, game);
            return next;
          });
        } catch {
          failed += 1;
        }
        setChunksLoaded(chunk + 1);
      }

      if (runId.current !== run) return;
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
      <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
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
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  },
  mild: {
    label: 'Fine for most kids',
    short: 'Most kids',
    tone: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  },
  mature: {
    label: 'Mature content',
    short: 'Mature',
    tone: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  },
  unknown: {
    label: 'Not rated',
    short: 'Not rated',
    tone: 'bg-slate-100 text-slate-500 ring-slate-500/20',
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

function AgeBadge({ ageRating, size = 'sm' }) {
  const family = FAMILY_TIERS[ageRating?.family ?? 'unknown'] ?? FAMILY_TIERS.unknown;
  const pad = size === 'lg' ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-[11px]';
  const board = ageRating?.source
    ? `${ageRating.source} ${ageRating.rating}${ageRating.official ? '' : ' (auto-generated)'}`
    : 'No board rating found';
  return (
    <span
      title={`${family.label} — content based. Board rating: ${board}`}
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
      <p className="mt-4 text-sm text-slate-500">
        No age rating found for this title. Check the PS Store listing before handing it to a
        kid.
      </p>
    );
  }

  const ageTier = AGE_TIERS[ageRating.tier] ?? AGE_TIERS.unknown;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Kid friendly?
        </h3>
        <AgeBadge ageRating={ageRating} size="lg" />
        <span className="text-sm text-slate-500">
          Board says {ageTier.label}
          {ageRating.source && ` (${ageRating.source} ${ageRating.rating})`}
          {!ageRating.official && ', auto-generated'}
        </span>
      </div>

      {ageRating.concerns.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">
            What rules it out
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ageRating.concerns.map((concern) => (
              <span
                key={concern}
                className="rounded-md bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
              >
                {concern}
              </span>
            ))}
          </div>
        </div>
      )}

      {ageRating.descriptors.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Content descriptors
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ageRating.descriptors.map((descriptor) => (
              <span
                key={descriptor}
                className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
              >
                {descriptor}
              </span>
            ))}
          </div>
        </div>
      )}

      {ageRating.notes && <p className="mt-3 text-sm text-slate-600">{ageRating.notes}</p>}

      <p className="mt-3 text-xs text-slate-400">
        The verdict is judged on content, not the age number: gore, brutal violence and sexual
        content rule a game out, while mild violence, language and drink or drug references do
        not. A Mature-rated game with none of the former still reads as fine.
      </p>
    </div>
  );
}

/** Green for strong, amber for mixed, rose for poor. */
function scoreTone(value) {
  if (value >= 80) return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
  if (value >= 60) return 'bg-amber-50 text-amber-700 ring-amber-600/20';
  return 'bg-rose-50 text-rose-700 ring-rose-600/20';
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
          title={`${user.total.toLocaleString()} player reviews${user.label ? ` — ${user.label}` : ''}`}
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
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-sm text-slate-600">
          {items.map((item) => (
            <li key={item.label} className="flex items-baseline justify-between gap-3">
              <span>{item.label}</span>
              <span className="shrink-0 text-xs text-slate-400">{item.mentions}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-4">
      <div className="grid gap-6 sm:grid-cols-2">
        {column('What players praise', pros, 'text-emerald-700', ThumbsUp, 'No clear pattern.')}
        {column('What they complain about', cons, 'text-rose-700', ThumbsDown, 'No recurring complaints.')}
      </div>
      <p className="mt-4 text-xs text-slate-400">
        Themes counted across a sample of player reviews — the number is how many mentioned it.
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
    <div className="mt-4 rounded-xl border border-slate-200 p-4">
      {representation.map((entry) => (
        <div key={entry.kind} className="not-first:mt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">
            {REPRESENTATION_LABELS[entry.kind] ?? entry.kind}
          </p>
          <p className="mt-1 text-sm text-slate-600">{entry.note}</p>
        </div>
      ))}
      <p className="mt-3 text-xs text-slate-400">
        Noted by hand, and deliberately specific. If something here is wrong or a game is
        missing, it is worth correcting.
      </p>
    </div>
  );
}

/** Cover art, or a lettered gradient when the game has no storefront match. */
function CoverArt({ game, live, className = '' }) {
  const [failed, setFailed] = useState(false);
  // The catalog carries the storefront id, so art can render before the live
  // request lands.
  const image =
    live?.heroImage ??
    (game.steamAppId
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId}/header.jpg`
      : null);

  if (!image || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 ${className}`}
      >
        <span className="px-4 text-center text-lg font-black uppercase tracking-widest text-white/90">
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
function TrailerPlayer({ video, poster, muted = false, className }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !video?.hls) return undefined;

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
      controls={!muted}
      muted={muted}
      loop={muted}
      autoPlay
      playsInline
      className={className ?? 'h-full w-full bg-black object-contain'}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

const storeLink = (game) =>
  game.psnStorePath
    ? `https://store.playstation.com/en-us/${game.psnStorePath}`
    : `https://store.playstation.com/en-us/search/${encodeURIComponent(game.title)}`;
const trailerSearchLink = (title) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${title} gameplay PS5`,
  )}`;

function GameModal({
  game,
  live,
  pool,
  byTitle,
  wishlisted,
  owned,
  reason,
  onToggleOwned,
  favouriteCreators,
  onToggleFavouriteCreator,
  onToggleWishlist,
  onOpen,
  onClose,
}) {
  const [selected, setSelected] = useState(null);
  const [drag, setDrag] = useState(0);
  const closeRef = useRef(null);
  const sheetRef = useRef(null);

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

  // Ratings ship with the catalog; the nightly refresh overrides them.
  const ratings = live?.ratings ?? game.ratings;

  const videos = live?.videos ?? [];
  const screenshots = live?.screenshots ?? [];

  // Default view: the trailer's poster frame, falling back to key art.
  const view =
    selected ?? (videos[0] ? { kind: 'video-poster', video: videos[0] } : { kind: 'cover' });

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
        aria-labelledby="game-modal-title"
        ref={sheetRef}
        style={drag > 0 ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        // A sheet on a phone, a dialog on a desktop. The content scrolls inside
        // it rather than the backdrop scrolling behind it, which is what stops
        // iOS rubber-banding the page under an open modal.
        className="panel-scroll relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white pb-[var(--inset-bottom)] shadow-2xl animate-sheet-up sm:my-auto sm:max-h-[90dvh] sm:max-w-3xl sm:rounded-2xl sm:pb-0 sm:animate-pop-in"
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
            <CoverArt game={game} live={live} className="h-full w-full" />
          )}
        </div>

        {/* Media thumbnails */}
        {(videos.length > 0 || screenshots.length > 0) && (
          <div className="flex gap-2 overflow-x-auto border-b border-slate-100 bg-slate-50 px-4 py-3">
            {videos.map((video) => (
              <button
                key={video.id}
                type="button"
                onClick={() => setSelected({ kind: 'video', video })}
                title={video.name}
                className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md ring-1 ring-slate-200 transition-transform hover:scale-105"
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
                className="h-14 w-24 shrink-0 overflow-hidden rounded-md ring-1 ring-slate-200 transition-transform hover:scale-105"
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
            <h2 id="game-modal-title" className="text-2xl font-bold text-slate-900 sm:pr-6">
              {game.title}
            </h2>
            <div className="flex shrink-0 items-center gap-2 sm:gap-1">
              <WishlistButton wishlisted={wishlisted} onToggle={onToggleWishlist} withLabel />
              <OwnedButton owned={owned} onToggle={onToggleOwned} withLabel />
            </div>
          </div>

          {reason && (
            <p className="mt-3 inline-flex items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium leading-relaxed text-indigo-700">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Picked for you: {reason.charAt(0).toLowerCase() + reason.slice(1)}.</span>
            </p>
          )}

          <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4">
            {[
              ['Genre', game.genre],
              ['Protagonist', game.protagonist],
              ['Art Style', game.artStyle],
            ].map(([label, value]) => (
              <div key={label}>
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {label}
                </span>
                <span className="font-medium text-slate-800">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <UpgradeBadge value={game.ps5Upgrade} className="whitespace-nowrap" />
            <RatingChips ratings={ratings} size="lg" />
          </div>

          <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="leading-relaxed text-slate-700">{game.description}</p>
          </div>

          <RepresentationDetail representation={game.representation} />
          <AgeDetail ageRating={game.ageRating} />
          <ProsAndCons ratings={ratings} />
          <PricePanel game={game} live={live} />
          <PredictionPanel live={live} />

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
      </div>
    </div>
  );
}

/**
 * Live price. The figure comes from a PC storefront, which is the only one
 * that publishes prices openly, so it is labelled plainly rather than passed
 * off as the PlayStation Store price.
 */
function PricePanel({ game, live }) {
  if (!live) {
    return (
      <p className="mt-6 flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking the PlayStation Store...
      </p>
    );
  }

  if (!live.price) {
    return (
      <p className="mt-6 text-sm text-slate-500">
        No PlayStation Store price found for this title. Open the store listing to check.
      </p>
    );
  }

  const { price } = live;
  const saleEnds = price.saleEndsAt ? new Date(price.saleEndsAt) : null;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{price.finalFormatted}</span>
        {price.discountPercent > 0 && (
          <span className="text-sm text-slate-400 line-through">{price.initialFormatted}</span>
        )}
      </div>
      <DiscountBadge price={price} />
      <a
        href={storeLink(game)}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
      >
        PlayStation Store
        <ArrowUpRight className="h-3.5 w-3.5" />
      </a>
      {saleEnds && (
        <p className="w-full text-xs font-medium text-rose-600">
          Sale ends {saleEnds.toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </p>
      )}
    </div>
  );
}

/**
 * The drop predictor's reasoning, shown in full. The score is a heuristic, so
 * the panel always says what produced it rather than asking for trust.
 */
function PredictionPanel({ live }) {
  const prediction = live?.prediction;
  if (!prediction || prediction.verdict === 'unknown') return null;

  const history = live.history;
  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Price outlook
        </h3>
        <VerdictBadge prediction={prediction} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
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
        <span className="text-sm font-semibold text-slate-700">{prediction.score}%</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Estimated chance of a lower price in the next {prediction.horizonDays} days.
      </p>

      <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
        {prediction.reasons.map((reason) => (
          <li key={reason} className="flex gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
            {reason}
          </li>
        ))}
      </ul>

      {history?.points?.length > 1 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-500">
            Recorded since {history.since} · lowest {history.lowest.formatted} on{' '}
            {history.lowest.date}
          </p>
          <PriceSparkline points={history.points} />
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        A heuristic from release age, current discount, typical sale windows and the price
        history this site has recorded — not an announced sale. Confidence:{' '}
        {prediction.confidence}
        {prediction.confidence === 'low' && ', history is still being collected'}.
      </p>
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
          ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
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
          ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
          : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
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

function GameCard({
  game,
  live,
  wishlisted,
  owned,
  reason,
  onToggleWishlist,
  onToggleOwned,
  onHide,
  onOpen,
}) {
  const prediction = live?.prediction;
  const ratings = live?.ratings ?? game.ratings;
  const showVerdict = prediction && (prediction.verdict === 'buy-now' || prediction.verdict === 'wait');

  return (
    <div className="group relative flex h-full animate-rise-in flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-200 ease-spring hover:-translate-y-1 hover:shadow-lg focus-within:ring-2 focus-within:ring-indigo-500 active:scale-[0.98]">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col text-left focus:outline-none"
      >
        <div className="relative aspect-[460/215] w-full overflow-hidden bg-slate-100">
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
          <h2 className="mb-1.5 text-sm font-bold leading-tight text-slate-800 sm:pr-7 sm:text-base">
            {game.title}
          </h2>
          <div className="mb-1.5 flex flex-wrap gap-1">
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 sm:text-[11px]">
              {game.genre}
            </span>
            <UpgradeBadge value={game.ps5Upgrade} />
            {showVerdict && <VerdictBadge prediction={prediction} />}
          </div>
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
            {game.representation?.length > 0 && (
              <span
                title={game.representation.map((entry) => entry.note).join(' ')}
                className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-600/20"
              >
                <Sparkles className="h-3 w-3" />
                {game.representation.map((entry) => REPRESENTATION_LABELS[entry.kind]?.split(' ')[0]).join(' + ')}
              </span>
            )}
            <AgeBadge ageRating={game.ageRating} />
            <RatingChips ratings={ratings} />
          </div>
          {reason ? (
            <p className="line-clamp-3 text-[11px] font-medium leading-relaxed text-indigo-600 sm:text-xs">
              <Sparkles className="mr-1 inline h-3 w-3 align-[-1px]" />
              {reason}
            </p>
          ) : (
            <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-500 sm:text-xs">
              {game.description}
            </p>
          )}
          {live?.price && (
            <p className="mt-auto flex items-baseline gap-2 pt-3 text-sm">
              <span className="font-semibold text-slate-900">{live.price.finalFormatted}</span>
              {live.price.discountPercent > 0 && (
                <span className="text-slate-400 line-through">{live.price.initialFormatted}</span>
              )}
            </p>
          )}
        </div>
      </button>

      {/* Pointer: a hover rail tucked into the corner, out of the way until
          wanted. Touch: three full-height targets in a row, because a stack of
          36px buttons over the art is a mis-tap waiting to happen. */}
      <div className="pointer-only absolute right-1.5 top-1.5 flex flex-col items-end gap-0.5 rounded-xl bg-white/75 p-0.5 backdrop-blur-sm">
        <WishlistButton wishlisted={wishlisted} onToggle={onToggleWishlist} />
        <OwnedButton owned={owned} onToggle={onToggleOwned} />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onHide();
          }}
          aria-label={`Stop showing ${game.title}`}
          title="Not for me"
          className="inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-slate-300 opacity-0 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600 focus:opacity-100 group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="touch-only grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100">
        <button
          type="button"
          onClick={onToggleWishlist}
          aria-pressed={wishlisted}
          aria-label={wishlisted ? `Remove ${game.title} from wishlist` : `Add ${game.title} to wishlist`}
          className={`flex h-11 items-center justify-center transition-colors active:bg-slate-100 ${
            wishlisted ? 'bg-rose-50 text-rose-600' : 'text-slate-400'
          }`}
        >
          <Heart className={`h-[18px] w-[18px] ${wishlisted ? 'fill-current' : ''}`} />
        </button>
        <button
          type="button"
          onClick={onToggleOwned}
          aria-pressed={owned}
          aria-label={owned ? `Remove ${game.title} from library` : `Mark ${game.title} as owned`}
          className={`flex h-11 items-center justify-center transition-colors active:bg-slate-100 ${
            owned ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400'
          }`}
        >
          <CircleCheck className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onHide}
          aria-label={`Stop showing ${game.title}`}
          className="flex h-11 items-center justify-center text-slate-300 transition-colors active:bg-slate-100"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
}

function EmptyState({ filters, wishlist, library, status, onClear }) {
  if (filters.collection === 'genius' && library.size === 0 && wishlist.size === 0) {
    return (
      <div className="py-20 text-center text-slate-500">
        <Sparkles className="mx-auto mb-3 h-8 w-8 text-indigo-300" />
        <p className="text-lg text-slate-700">Nothing to work from yet.</p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed">
          Tick the check on a few games you already own, or heart the ones you want. Picks
          appear as soon as there is one, and get sharper with every game you add.
        </p>
      </div>
    );
  }

  return (
    <div className="py-20 text-center text-slate-500">
      <Sparkles className="mx-auto mb-3 h-8 w-8 text-slate-300" />
      <p className="text-lg">No games found matching those filters.</p>
      {filters.wishlist && wishlist.size === 0 && (
        <p className="mt-1 text-sm">Your wishlist is empty. Tap the heart on any card.</p>
      )}
      {!filters.includePs5 && (
        <p className="mt-1 text-sm">PS5-only titles are hidden. Turn them on to see more.</p>
      )}
      {filters.sale && status === 'loading' && (
        <p className="mt-1 text-sm">Still checking prices — more may appear.</p>
      )}
      <button
        type="button"
        onClick={onClear}
        className="mt-4 font-medium text-indigo-600 hover:underline"
      >
        Clear all filters
      </button>
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

  const covered = useMemo(() => {
    const entries = (game.coverage ?? [])
      .map((entry) => ({ ...entry, creator: creatorsByHandle[entry.handle] }))
      .filter((entry) => entry.creator);
    return entries.sort(
      (a, b) =>
        Number(favourites.has(b.handle)) - Number(favourites.has(a.handle)) || b.videos - a.videos,
    );
  }, [game, favourites]);

  const uncovered = useMemo(
    () => creatorsData.filter((creator) => !covered.some((entry) => entry.handle === creator.handle)),
    [covered],
  );

  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
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

      {covered.length > 0 ? (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {covered.length === 1 ? 'One creator has' : `${covered.length} creators have`} played
            this. Each link opens their actual video.
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
                      : 'text-slate-300 hover:text-slate-500'
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
                      <span className="text-sm font-medium text-slate-800 group-hover:text-indigo-600">
                        {entry.creator.name}
                      </span>
                      <span className="text-[11px] text-violet-600">{entry.creator.identity}</span>
                      <span className="text-[11px] text-slate-400">
                        {entry.videos === 1 ? '1 video' : `${entry.videos} videos`}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {entry.videoTitle}
                    </span>
                  </span>
                  <CirclePlay className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-rose-600" />
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mb-2 text-xs text-slate-500">
          None of the tracked creators has a video for this one.
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowAll((open) => !open)}
        className="mt-3 text-xs font-medium text-indigo-600 hover:underline"
      >
        {showAll ? 'Hide' : `Search the other ${uncovered.length} channels`}
      </button>

      {showAll && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {uncovered.map((creator) => (
            <li key={creator.handle}>
              <a
                href={creatorSearchLink(creator.handle, game.title)}
                target="_blank"
                rel="noopener noreferrer"
                title={`${creator.identity} — ${creator.note}`}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-200"
              >
                {creator.name}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Coverage comes from indexing every tracked creator's uploads and matching them to this
        title, so these are videos that exist rather than a guess. Channels with no match are
        searchable above in case they posted since.
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

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react/set-state-in-effect
    setState({ status: 'loading', items: [] });
    fetch(`/api/news?game=${encodeURIComponent(title)}`)
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
  }, [title]);

  if (state.status === 'loading') {
    return (
      <div className="mt-8 border-t border-slate-100 pt-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400">
          <Newspaper className="h-4 w-4" />
          In the news
        </h3>
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking the press...
        </p>
      </div>
    );
  }

  if (state.items.length === 0) return null;

  return (
    <div className="mt-8 border-t border-slate-100 pt-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400">
        <Newspaper className="h-4 w-4" />
        In the news
      </h3>
      <ul className="space-y-1.5">
        {state.items.map((item) => (
          <li key={item.link}>
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-baseline gap-2 rounded-lg px-2 py-1.5 -mx-2 transition-colors hover:bg-slate-50"
            >
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                {item.source}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-snug text-slate-700 group-hover:text-slate-900">
                {item.title}
              </span>
              <span className="shrink-0 text-[11px] text-slate-400">
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
    <div className="mt-6 border-t border-slate-100 pt-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
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
              className="group overflow-hidden rounded-lg border border-slate-200 text-left transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:shadow-md active:scale-95"
            >
              <div className="aspect-[460/215] w-full overflow-hidden bg-slate-100">
                <CoverArt game={other} live={live} className="h-full w-full" />
              </div>
              <div className="p-2">
                <p className="line-clamp-2 text-xs font-semibold leading-tight text-slate-700">
                  {other.title}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">{other.genre}</p>
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
 * One full-screen card in the feed. Snap points do the paging, so this only
 * has to look right and get out of the way — the art runs edge to edge and
 * the text sits over a gradient rather than in a panel.
 */
function FeedSlide({
  game,
  live,
  wishlisted,
  owned,
  reason,
  onToggleWishlist,
  onToggleOwned,
  onOpen,
}) {
  // The trailer plays only while this slide is the one on screen, muted, the
  // way a feed behaves. Anything off screen is torn down so a long scroll
  // never leaves a stack of decoding videos behind.
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

  // A wide screenshot fills the screen far better than the 460px capsule, so
  // use one as soon as the live data arrives and fall back until then.
  const background =
    live?.screenshots?.[0]?.full ??
    live?.heroImage ??
    (game.steamAppId
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.steamAppId}/header.jpg`
      : null);
  const ratings = live?.ratings ?? game.ratings;
  const price = live?.price;

  const trailer = live?.videos?.[0] ?? null;

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
      {centred && trailer && (
        <TrailerPlayer
          video={trailer}
          poster={background}
          muted
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

          {/* Action rail, thumb-reachable on a phone. */}
          <div className="flex shrink-0 flex-col items-center gap-3">
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
            <button
              type="button"
              onClick={onToggleOwned}
              aria-pressed={owned}
              aria-label={owned ? 'Remove from library' : 'Add to library'}
              className={`rounded-full p-3 backdrop-blur transition-transform duration-200 ease-spring active:scale-90 ${
                owned ? 'bg-emerald-600 text-white' : 'bg-white/15 text-white hover:bg-white/25'
              }`}
            >
              <CircleCheck className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Details for ${game.title}`}
              className="rounded-full bg-white/15 p-3 text-white backdrop-blur transition-transform duration-200 ease-spring hover:bg-white/25 active:scale-90"
            >
              <Info className="h-5 w-5" />
            </button>
            {trailer && (
              <span
                title="Trailer plays muted"
                className="rounded-full bg-white/15 p-3 text-white backdrop-blur"
              >
                <VolumeX className="h-5 w-5" />
              </span>
            )}
            <a
              href={storeLink(game)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${game.title} on the PS Store`}
              className="rounded-full bg-white/15 p-3 text-white backdrop-blur transition-transform duration-200 ease-spring hover:bg-white/25 active:scale-90"
            >
              <ExternalLink className="h-5 w-5" />
            </a>
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
    { key: 'news', label: 'News', icon: Newspaper, badge: updates },
    { key: 'surprise', label: 'Surprise', icon: Dices, disabled: !canSurprise },
  ];

  return (
    <nav
      aria-label="Sections"
      className="touch-only fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/90 pb-[var(--inset-bottom)] backdrop-blur"
    >
      <div className="flex">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            aria-current={item.active ? 'page' : undefined}
            onClick={() => {
              if (item.key === 'news') onBriefing();
              else if (item.key === 'surprise') onSurprise();
              else onView(item.key);
            }}
            className={`relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 transition-colors active:bg-slate-100 disabled:opacity-40 ${
              item.active ? 'text-indigo-600' : 'text-slate-500'
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
 * Store mirror
 * ------------------------------------------------------------------ */

/**
 * The long tail behind the curated catalog: everything the store itself lists,
 * as the store lists it. These cards deliberately look different from the
 * hand-picked ones — no kid-friendly verdict, no representation note, no
 * description — because nobody has read these games, only indexed them.
 */
function StoreCard({ game, curated, onOpenCurated }) {
  const body = (
    <>
      <div className="relative aspect-[460/215] w-full overflow-hidden bg-slate-100">
        {game.art ? (
          <img
            src={game.art}
            alt=""
            loading="lazy"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
            className="h-full w-full object-cover"
          />
        ) : null}
        {curated && (
          <span className="absolute left-2 top-2 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
            In your catalog
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3 className="mb-1.5 line-clamp-2 text-sm font-bold leading-tight text-slate-800">
          {game.name}
        </h3>

        <div className="mb-2 flex flex-wrap gap-1">
          {(game.genres ?? []).slice(0, 2).map((genre) => (
            <span
              key={genre}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"
            >
              {genre}
            </span>
          ))}
          {game.platforms?.length > 0 && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
              {game.platforms.join(' / ')}
            </span>
          )}
        </div>

        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
          {game.stars > 0 && (
            <span
              title={`${game.votes?.toLocaleString() ?? 0} PlayStation ratings`}
              className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700"
            >
              <Star className="h-3 w-3 fill-current" />
              {game.stars.toFixed(1)}
              <span className="font-normal text-amber-600/70">
                {(game.votes ?? 0) >= 1000
                  ? `${Math.round(game.votes / 1000)}k`
                  : (game.votes ?? 0)}
              </span>
            </span>
          )}
          {game.release && (
            <span className="text-slate-400">{game.release.slice(0, 4)}</span>
          )}
        </div>

        <p className="mt-auto truncate pt-2 text-xs text-slate-400">{game.publisher}</p>
        {game.price && (
          <p className="pt-1 text-sm font-semibold text-slate-900">{game.price}</p>
        )}
      </div>
    </>
  );

  const shell =
    'group flex h-full animate-rise-in flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition-all duration-200 ease-spring hover:-translate-y-1 hover:shadow-lg active:scale-[0.98]';

  // A game we have written about opens its own page; everything else goes to
  // the store, because there is nothing more of ours to show.
  return curated ? (
    <button type="button" onClick={() => onOpenCurated(curated.id)} className={shell}>
      {body}
    </button>
  ) : (
    <a
      href={`https://store.playstation.com/en-us/concept/${game.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={shell}
    >
      {body}
    </a>
  );
}

/** Query state for the mirror, kept out of the component that renders it. */
function useStoreSearch({ active, q, genre, sort }) {
  const [state, setState] = useState({ status: 'idle', games: [], total: 0, page: 0 });
  const request = useRef(0);

  useEffect(() => {
    if (!active) return undefined;
    const run = ++request.current;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (genre) params.set('genre', genre);
    if (sort) params.set('sort', sort);

    // eslint-disable-next-line react/set-state-in-effect
    setState((previous) => ({ ...previous, status: 'loading' }));
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
  }, [active, q, genre, sort]);

  const more = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (genre) params.set('genre', genre);
    if (sort) params.set('sort', sort);
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
  }, [q, genre, sort, state.page]);

  return { ...state, more };
}

/**
 * The "Whole store" view. Browsing sorts by PlayStation's own star rating,
 * weighted down until enough people have voted, so the top is genuinely
 * well-liked rather than one five-star review.
 */
function StorePanel({ query, curatedByName, onOpenCurated }) {
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

  const results = useStoreSearch({ active: true, q: query, genre, sort });

  return (
    <>
      <p className="mb-3 text-xs font-medium text-slate-400">
        {results.total.toLocaleString()} of {facets.size.toLocaleString()} games indexed ·{' '}
        {COLLECTION_BLURBS.store}
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
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="w-px shrink-0 self-stretch bg-slate-200" />
        <button
          type="button"
          onClick={() => setGenre('')}
          aria-pressed={genre === ''}
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
            genre === '' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {entry.genre}
            <span className={genre === entry.genre ? 'text-white/60' : 'text-slate-400'}>
              {entry.count}
            </span>
          </button>
        ))}
      </div>

      {results.status === 'loading' && results.games.length === 0 ? (
        <PanelMessage icon={Loader2} spin label="Searching the store index..." />
      ) : results.games.length === 0 ? (
        <PanelMessage
          icon={Search}
          label={
            results.status === 'error'
              ? 'The store index is not answering right now.'
              : 'Nothing in the index matches that.'
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {results.games.map((game) => (
              <StoreCard
                key={game.id}
                game={game}
                curated={curatedByName.get(game.name?.toLowerCase())}
                onOpenCurated={onOpenCurated}
              />
            ))}
          </div>

          {results.games.length < results.total && (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={results.more}
                className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-transform duration-200 ease-spring active:scale-95"
              >
                Show more
              </button>
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

const TONE_STYLES = {
  queer: 'bg-violet-100 text-violet-700',
  playstation: 'bg-indigo-100 text-indigo-700',
  general: 'bg-slate-100 text-slate-600',
};

function relativeTime(iso) {
  if (!iso) return '';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

const NEWS_TONES = [
  ['all', 'Everything'],
  ['playstation', 'PlayStation'],
  ['queer', 'Queer press'],
];

function NewsPanel({ items, status, onReload }) {
  const [tone, setTone] = useState('all');
  const shown = tone === 'all' ? items : items.filter((item) => item.tone === tone);

  if (status === 'loading' && items.length === 0) {
    return <PanelMessage icon={Loader2} spin label="Reading the feeds..." />;
  }
  if (items.length === 0) {
    return (
      <PanelMessage
        icon={Newspaper}
        label="No stories came back just now."
        action={{ label: 'Try again', onClick: onReload }}
      />
    );
  }

  return (
    <>
      <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
        {NEWS_TONES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTone(value)}
            aria-pressed={tone === value}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
              tone === value
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <PanelMessage icon={Newspaper} label="Nothing from that corner right now." />
      )}

      <ul className="space-y-2">
        {shown.map((item) => (
        <li key={item.link}>
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-3 rounded-xl border border-slate-200 bg-white p-2.5 transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm active:scale-[0.99]"
          >
            {item.image && (
              <img
                src={item.image}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
                className="h-16 w-24 shrink-0 rounded-lg bg-slate-100 object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold">
                <span className={`rounded px-1.5 py-0.5 ${TONE_STYLES[item.tone] ?? TONE_STYLES.general}`}>
                  {item.source}
                </span>
                {tone === 'queer' && item.note && (
                  <span className="truncate font-normal text-violet-500">{item.note}</span>
                )}
                <span className="shrink-0 text-slate-400">{relativeTime(item.publishedAt)}</span>
              </div>
              <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800">
                {item.title}
              </p>
              {item.summary && (
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500">
                  {item.summary}
                </p>
              )}
            </div>
          </a>
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
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100'
            }`}
          >
            {value === 'saved' && <Bell className="h-3.5 w-3.5" />}
            {label}
            <span className={when === value ? 'text-white/60' : 'text-slate-400'}>{count}</span>
          </button>
        ))}
      </div>

      {updates.length > 0 && when !== 'saved' && (
        <button
          type="button"
          onClick={() => setWhen('saved')}
          className="flex w-full items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-200 transition-transform duration-200 ease-spring active:scale-[0.99]"
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
          <h3 className="sticky top-0 z-10 -mx-1 mb-2 bg-slate-50/95 px-1 py-1 text-xs font-bold uppercase tracking-wider text-slate-400 backdrop-blur">
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
                <li key={game.id} className="rounded-xl border border-slate-200 bg-white">
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
                        className="relative h-14 w-14 shrink-0 self-center overflow-hidden rounded-lg bg-slate-100 disabled:cursor-default"
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
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800">
                        {game.title}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {game.publisher}
                        {game.genres?.length > 0 && ` · ${game.genres.join(', ')}`}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {update && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                            {UPDATE_TEXT[update.kind](update)}
                          </span>
                        )}
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                          {game.platforms?.join(' / ') || 'PS5'}
                        </span>
                        {away > 0 && away <= 30 && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                            {away <= 1 ? 'Tomorrow' : `in ${away} days`}
                          </span>
                        )}
                        {game.price && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                            {game.price}
                          </span>
                        )}
                        {inCatalog && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">
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
                          ? 'bg-amber-50 text-amber-600'
                          : 'text-slate-300 hover:bg-slate-100 hover:text-slate-600'
                      }`}
                    >
                      <Bell className={`h-4 w-4 ${saved.has(game.id) ? 'fill-current' : ''}`} />
                    </button>
                  </div>

                  {isPlaying && game.trailer && (
                    <div className="border-t border-slate-100 p-2.5 pt-2">
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
    <div className="py-16 text-center text-slate-500">
      <Icon className={`mx-auto mb-3 h-7 w-7 text-slate-300 ${spin ? 'animate-spin' : ''}`} />
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
  const news = useDeferredEndpoint('/api/news', open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = tab === 'upcoming' ? upcoming : news;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="News and releases">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-sm"
      />
      <aside className="relative flex h-full w-full max-w-md animate-slide-in flex-col border-l border-slate-200 bg-slate-50 pt-[var(--inset-top)] shadow-2xl">
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
          <div className="flex flex-1 gap-1">
            {[
              ['news', 'News', Newspaper],
              ['upcoming', 'Upcoming', CalendarDays],
            ].map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => onTab(value)}
                aria-pressed={tab === value}
                className={`inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-all duration-200 ease-spring active:scale-95 sm:h-9 ${
                  tab === value
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
            className="tap inline-flex items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:h-9 sm:min-h-0 sm:w-9 sm:min-w-0"
          >
            <RefreshCw className={`h-4 w-4 ${active.status === 'loading' ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="tap inline-flex items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:h-9 sm:min-h-0 sm:w-9 sm:min-w-0"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="no-scrollbar panel-scroll flex-1 overflow-y-auto p-3">
          {tab === 'news' ? (
            <NewsPanel
              items={news.data?.items ?? []}
              status={news.status}
              onReload={news.reload}
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

        <footer className="border-t border-slate-200 bg-white px-3 pb-[calc(0.5rem+var(--inset-bottom))] pt-2 text-[11px] text-slate-400">
          {tab === 'news'
            ? 'Headlines link straight to the publisher. Feeds refresh every 15 minutes.'
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
function TogglePill({ active, onClick, icon: Icon, label, count, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
        active ? `${tone} text-white` : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${active && label === 'Wishlist' ? 'fill-current' : ''}`} />
      {label}
      {count !== undefined && count !== 0 && (
        <span className={active ? 'text-white/60' : 'text-slate-400'}>{count}</span>
      )}
    </button>
  );
}

/** Options are plain strings, or {value, label} when the two differ. */
function Select({ label, value, options, onChange }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
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
  const [hidden, setHidden] = useState(readHidden);
  const [savedReleases, setSavedReleases] = useState(readSavedReleases);
  const [favouriteCreators, setFavouriteCreators] = useState(readFavouriteCreators);
  const [library, setLibrary] = useState(readLibrary);
  const [activeGameId, setActiveGameId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrolled = useScrollCollapse();

  const { byTitle, status, updatedAt, progress, refresh } = useLiveData(filters.region);
  const barRef = useRef(null);
  const collectionsRef = useRef(null);
  const [briefing, setBriefing] = useState({ open: false, tab: 'news' });

  // The calendar is fetched when the panel opens, and also when something is
  // being followed — that is the only way the header can say a date moved
  // before you go looking.
  const upcoming = useDeferredEndpoint(
    '/api/upcoming',
    (briefing.open && briefing.tab === 'upcoming') || savedReleases.size > 0,
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

  // Recomputed only when the library, wishlist or PS5 toggle changes; it never
  // touches live data, so it stays instant while prices are still loading.
  const geniusPicks = useMemo(() => {
    const profile = buildProfile(gamesData, library, wishlist);
    if (!profile) return [];
    const exclude = new Set([...library, ...wishlist, ...hidden]);
    return recommend(gamesData, profile, {
      exclude,
      limit: 48,
      includePs5: filters.includePs5,
    });
  }, [library, wishlist, hidden, filters.includePs5]);

  const geniusReasons = useMemo(
    () => new Map(geniusPicks.map((pick) => [pick.game.id, pick.reason])),
    [geniusPicks],
  );

  // Keeps typing responsive while React re-filters in the background.
  const deferredQuery = useDeferredValue(filters.q);

  const filteredGames = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();

    const collection = COLLECTIONS.find((entry) => entry.value === filters.collection);

    const isGenius = filters.collection === 'genius';
    const geniusRank = isGenius
      ? new Map(geniusPicks.map((pick, index) => [pick.game.id, index]))
      : null;

    const matches = gamesData.filter((game) => {
      if (hidden.has(game.id)) return false;
      if (!filters.includePs5 && game.platform === 'PS5') return false;
      if (isGenius && !geniusRank.has(game.id)) return false;
      if (collection?.tag && !game.tags.includes(collection.tag)) return false;
      if (filters.collection === 'deals' && !(byTitle.get(game.title)?.price?.discountPercent > 0))
        return false;
      if (needle && !game.title.toLowerCase().includes(needle)) return false;
      if (filters.genre !== 'All' && game.genre !== filters.genre) return false;
      if (filters.protagonist !== 'All' && game.protagonist !== filters.protagonist) return false;
      if (filters.artStyle !== 'All' && game.artStyle !== filters.artStyle) return false;
      if (filters.upgrade !== 'All' && game.ps5Upgrade !== filters.upgrade) return false;
      if (filters.kidFriendly && !FAMILY_TIER_VALUES.includes(game.ageRating?.family)) return false;
      if (filters.owned === 'owned' && !library.has(game.id)) return false;
      if (filters.owned === 'unowned' && library.has(game.id)) return false;
      if (filters.wishlist && !wishlist.has(game.id)) return false;
      if (filters.sale && !(byTitle.get(game.title)?.price?.discountPercent > 0)) return false;
      return true;
    });

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
  }, [deferredQuery, filters, wishlist, library, hidden, byTitle, geniusPicks]);

  const visiblePool = useMemo(
    () => gamesData.filter((game) => filters.includePs5 || game.platform !== 'PS5'),
    [filters.includePs5],
  );

  const saleCount = useMemo(
    () => visiblePool.filter((game) => byTitle.get(game.title)?.price?.discountPercent > 0).length,
    [visiblePool, byTitle],
  );

  const kidFriendlyCount = useMemo(
    () => visiblePool.filter((game) => FAMILY_TIER_VALUES.includes(game.ageRating?.family)).length,
    [visiblePool],
  );

  const collectionCounts = useMemo(() => {
    const counts = {};
    for (const entry of COLLECTIONS) {
      counts[entry.value] =
        // The mirror's size is only known once its facets load, so the chip
        // carries no number rather than a wrong one.
        entry.value === 'store'
          ? null
          : entry.value === 'deals'
            ? saleCount
            : entry.value === 'genius'
              ? geniusPicks.length
              : entry.tag
            ? visiblePool.filter((game) => game.tags.includes(entry.tag)).length
            : visiblePool.length;
    }
    return counts;
  }, [visiblePool, saleCount, geniusPicks]);

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
    if (filters.kidFriendly) add('kids', 'Kid friendly', () => set('kidFriendly', false));
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
    filters.wishlist ||
    filters.kidFriendly ||
    filters.owned !== 'any' ||
    activeFilterCount > 0;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Control bar. Collapses to a single compact row as soon as you scroll
          down, and springs back the moment you scroll up. */}
      <header
        ref={barRef}
        style={{ paddingTop: 'calc(var(--inset-top) + var(--bar-pad))' }}
        className={`gutter sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur transition-[padding] duration-300 ease-swift ${
          compact ? '[--bar-pad:0.5rem] pb-2' : '[--bar-pad:0.75rem] pb-3 sm:pb-4 sm:[--bar-pad:1rem]'
        }`}
      >
        <div className="mx-auto max-w-7xl">
          {/* Always-visible row: identity, search, filters, view switch. */}
          <div className="flex items-center gap-2">
            <h1
              className={`hidden shrink-0 font-bold tracking-tight text-slate-800 transition-all duration-300 ease-swift sm:block ${
                compact ? 'text-base' : 'text-lg sm:text-2xl'
              }`}
            >
              PS<span className="text-indigo-600">4→5</span>
              <span className="hidden sm:inline"> Catalog</span>
            </h1>

            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search titles"
                placeholder="Search games"
                enterKeyHint="search"
                className="w-full rounded-full border border-slate-300 bg-white py-2 pl-8 pr-3 text-base outline-none transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 sm:py-1.5 sm:text-sm"
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
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
              onClick={() => {
                if (filteredGames.length === 0) return;
                const pick = filteredGames[Math.floor(Math.random() * filteredGames.length)];
                setActiveGameId(pick.id);
              }}
              disabled={filteredGames.length === 0}
              aria-label="Surprise me with a random game"
              title="Surprise me"
              className="pointer-only inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 transition-all duration-200 ease-spring hover:rotate-12 hover:bg-amber-200 active:scale-90 disabled:opacity-40"
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
              className="relative pointer-only inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 transition-all duration-200 ease-spring hover:bg-sky-200 active:scale-90"
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
              className="pointer-only inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-all duration-200 ease-spring hover:bg-slate-200 active:scale-90"
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
              {COLLECTIONS.map((entry) => {
                const active = filters.collection === entry.value;
                return (
                  <button
                    key={entry.value}
                    type="button"
                    data-active={active ? 'true' : undefined}
                    onClick={() => set('collection', entry.value)}
                    aria-current={active ? 'true' : undefined}
                    className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 sm:h-7 ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {entry.value === 'deals' && <BadgePercent className="h-3.5 w-3.5" />}
                    {entry.value === 'genius' && <Sparkles className="h-3.5 w-3.5" />}
                    {entry.label}
                    {collectionCounts[entry.value] != null && (
                      <span
                        className={`tabular-nums ${active ? 'text-white/60' : 'text-slate-400'}`}
                      >
                        {collectionCounts[entry.value]}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Filter sheet: everything else lives here instead of on screen. */}
          {sheetOpen && (
            <div className="mt-3 animate-sheet-down rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
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

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <TogglePill
                  active={filters.sale}
                  onClick={() => set('sale', !filters.sale)}
                  icon={BadgePercent}
                  label="On sale"
                  count={saleCount}
                  tone="bg-rose-600"
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
                  active={filters.wishlist}
                  onClick={() => set('wishlist', !filters.wishlist)}
                  icon={Heart}
                  label="Wishlist"
                  count={wishlist.size}
                  tone="bg-rose-600"
                />
                <TogglePill
                  active={filters.owned === 'owned'}
                  onClick={() => set('owned', filters.owned === 'owned' ? 'any' : 'owned')}
                  icon={CircleCheck}
                  label="I own it"
                  count={library.size}
                  tone="bg-emerald-600"
                />
                <TogglePill
                  active={filters.owned === 'unowned'}
                  onClick={() => set('owned', filters.owned === 'unowned' ? 'any' : 'unowned')}
                  icon={Sparkles}
                  label="Not owned"
                  tone="bg-slate-700"
                />
                <TogglePill
                  active={filters.includePs5}
                  onClick={() => set('includePs5', !filters.includePs5)}
                  icon={Gamepad2}
                  label="PS5-only"
                  count={filters.includePs5 ? 'on' : 'off'}
                  tone="bg-violet-600"
                />

                <div className="ml-auto flex items-center gap-3">
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
                      className="text-xs font-medium text-slate-500 hover:text-slate-800"
                    >
                      Clear
                    </button>
                  )}
                </div>
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
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-transform duration-200 ease-spring active:scale-95"
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
          {filteredGames.map((game) => (
            <FeedSlide
              key={game.id}
              game={game}
              live={byTitle.get(game.title)}
              wishlisted={wishlist.has(game.id)}
              owned={library.has(game.id)}
              reason={filters.collection === 'genius' ? geniusReasons.get(game.id) : undefined}
              onToggleWishlist={() => toggleWishlist(game.id)}
              onToggleOwned={() => toggleOwned(game.id)}
              onOpen={() => setActiveGameId(game.id)}
            />
          ))}
          {filteredGames.length === 0 && (
            <EmptyState
              filters={filters}
              wishlist={wishlist}
              library={library}
              status={status}
              onClear={clearFilters}
            />
          )}
        </main>
      ) : (
        <main className="gutter pb-nav mx-auto max-w-7xl pt-3">
          {filters.collection === 'store' ? (
            <StorePanel
              query={deferredQuery.trim()}
              curatedByName={curatedByName}
              onOpenCurated={setActiveGameId}
            />
          ) : (
            <>
          <p className="mb-3 text-xs font-medium text-slate-400">
            {filteredGames.length} of {visiblePool.length} games
            {COLLECTION_BLURBS[filters.collection] &&
              ` · ${COLLECTION_BLURBS[filters.collection]}`}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {filteredGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                live={byTitle.get(game.title)}
                wishlisted={wishlist.has(game.id)}
                owned={library.has(game.id)}
                reason={filters.collection === 'genius' ? geniusReasons.get(game.id) : undefined}
                onToggleWishlist={() => toggleWishlist(game.id)}
                onToggleOwned={() => toggleOwned(game.id)}
                onHide={() => hideGame(game.id)}
                onOpen={() => setActiveGameId(game.id)}
              />
            ))}
          </div>

          {hidden.size > 0 && (
            <p className="mt-6 text-center text-xs text-slate-400">
              {hidden.size} hidden.{' '}
              <button
                type="button"
                onClick={unhideAll}
                className="font-medium text-indigo-600 hover:underline"
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
            />
          )}

          {/* The curated 298 will not have everything; the mirror will. */}
          {deferredQuery.trim().length > 1 && (
            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => set('collection', 'store')}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline"
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
          onToggleWishlist={() => toggleWishlist(activeGame.id)}
          onToggleOwned={() => toggleOwned(activeGame.id)}
          onClose={() => setActiveGameId(null)}
        />
      )}

      <BottomBar
        view={filters.view}
        onView={(view) => set('view', view)}
        onBriefing={() =>
          setBriefing({
            open: true,
            tab: releaseChanges.length > 0 ? 'upcoming' : briefing.tab,
          })
        }
        onSurprise={() => {
          if (filteredGames.length === 0) return;
          setActiveGameId(filteredGames[Math.floor(Math.random() * filteredGames.length)].id);
        }}
        canSurprise={filteredGames.length > 0}
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
      <span className="inline-flex items-center gap-2 text-sm text-slate-500">
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
        className="inline-flex items-center gap-2 text-sm font-medium text-amber-600 hover:underline"
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
      className="inline-flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-slate-800"
    >
      <RefreshCw className="h-4 w-4" />
      Prices updated{' '}
      {updatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </button>
  );
}
