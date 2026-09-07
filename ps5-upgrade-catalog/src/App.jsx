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
  ChevronDown,
  CirclePlay,
  ExternalLink,
  Gamepad2,
  Heart,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Loader2,
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
  X,
} from 'lucide-react';
import gamesData from './games.json';

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
  { value: 'deals', label: 'Best deals', tag: null },
  { value: 'graphics', label: 'Best graphics', tag: 'graphics' },
  { value: 'social', label: 'Online & social', tag: 'social' },
  { value: 'cozy', label: 'Cozy', tag: 'cozy' },
  { value: 'queer', label: 'Queer stories', tag: 'queer' },
  { value: 'disability', label: 'Disability rep', tag: 'disability' },
];

const COLLECTION_BLURBS = {
  deals: 'Everything discounted right now, deepest cut first. Updates with the storefront.',
  graphics: 'Technical showcases and standout art direction.',
  social: 'Online play, co-op and couch multiplayer.',
  cozy: 'Low-stress games with gentle pacing and no fail state to speak of.',
  queer: 'Games with queer characters or relationships that matter to the story, not background detail.',
  disability: 'Games with disabled or neurodivergent characters, or landmark accessibility work.',
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
  if (filters.view === 'feed') params.set('mode', 'feed');
  if (filters.includePs5) params.set('ps5', '1');
  const query = params.toString();
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
}

const WISHLIST_KEY = 'wishlist';

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
const FAMILY_TIERS = {
  safe: { label: 'Great for kids', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  mild: { label: 'Fine for most kids', tone: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  mature: { label: 'Mature content', tone: 'bg-rose-50 text-rose-700 ring-rose-600/20' },
  unknown: { label: 'Not rated', tone: 'bg-slate-100 text-slate-500 ring-slate-500/20' },
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
      {family.label}
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
          <span className="font-normal opacity-70">critics</span>
        </span>
      )}
      {user != null && (
        <span
          title={`${user.total.toLocaleString()} player reviews${user.label ? ` — ${user.label}` : ''}`}
          className={`inline-flex items-center gap-1 rounded-md font-semibold ring-1 ring-inset ${pad} ${scoreTone(user.percentPositive)}`}
        >
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          {user.percentPositive}%
          <span className="font-normal opacity-70">players</span>
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
function TrailerPlayer({ video, poster }) {
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
      controls
      autoPlay
      playsInline
      className="h-full w-full bg-black object-contain"
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

function GameModal({ game, live, wishlisted, onToggleWishlist, onClose }) {
  const [selected, setSelected] = useState(null);
  const closeRef = useRef(null);

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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm animate-fade-in sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-modal-title"
        className="relative my-auto w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-pop-in"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 rounded-full bg-slate-900/60 p-2 text-white transition-colors hover:bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
          <div className="flex items-start justify-between gap-4">
            <h2 id="game-modal-title" className="pr-6 text-2xl font-bold text-slate-900">
              {game.title}
            </h2>
            <WishlistButton wishlisted={wishlisted} onToggle={onToggleWishlist} withLabel />
          </div>

          <div className="mt-5 grid grid-cols-3 gap-4">
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

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href={storeLink(game)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-indigo-700"
            >
              <ExternalLink className="h-4 w-4" />
              PS Store
            </a>
            <a
              href={trailerSearchLink(game.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-rose-700"
            >
              <CirclePlay className="h-4 w-4" />
              More gameplay
            </a>
          </div>
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
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
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

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

function GameCard({ game, live, wishlisted, onToggleWishlist, onOpen }) {
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
          {live?.price?.discountPercent > 0 && (
            <span className="absolute left-2 top-2">
              <DiscountBadge price={live.price} />
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-3 sm:p-4">
          <h2 className="mb-1.5 pr-7 text-sm font-bold leading-tight text-slate-800 sm:text-base">
            {game.title}
          </h2>
          <div className="mb-2 flex flex-wrap gap-1">
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">
              {game.genre}
            </span>
            <UpgradeBadge value={game.ps5Upgrade} />
            {showVerdict && <VerdictBadge prediction={prediction} />}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-1">
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
          <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">{game.description}</p>
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

      <div className="absolute right-2 top-2">
        <WishlistButton wishlisted={wishlisted} onToggle={onToggleWishlist} />
      </div>
    </div>
  );
}

function EmptyState({ filters, wishlist, status, onClear }) {
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
 * Feed view
 * ------------------------------------------------------------------ */

/**
 * One full-screen card in the feed. Snap points do the paging, so this only
 * has to look right and get out of the way — the art runs edge to edge and
 * the text sits over a gradient rather than in a panel.
 */
function FeedSlide({ game, live, wishlisted, onToggleWishlist, onOpen }) {
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

  return (
    <section className="feed-slide relative flex h-full w-full items-end overflow-hidden bg-slate-900">
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
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-slate-950/10" />

      <div className="relative w-full p-5 pb-24 sm:p-8 sm:pb-28">
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
              onClick={onOpen}
              aria-label={`Details for ${game.title}`}
              className="rounded-full bg-white/15 p-3 text-white backdrop-blur transition-transform duration-200 ease-spring hover:bg-white/25 active:scale-90"
            >
              <Info className="h-5 w-5" />
            </button>
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
  const [activeGameId, setActiveGameId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrolled = useScrollCollapse();

  const { byTitle, status, updatedAt, progress, refresh } = useLiveData(filters.region);
  const barRef = useRef(null);

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

  // Keeps typing responsive while React re-filters in the background.
  const deferredQuery = useDeferredValue(filters.q);

  const filteredGames = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();

    const collection = COLLECTIONS.find((entry) => entry.value === filters.collection);

    const matches = gamesData.filter((game) => {
      if (!filters.includePs5 && game.platform === 'PS5') return false;
      if (collection?.tag && !game.tags.includes(collection.tag)) return false;
      if (filters.collection === 'deals' && !(byTitle.get(game.title)?.price?.discountPercent > 0))
        return false;
      if (needle && !game.title.toLowerCase().includes(needle)) return false;
      if (filters.genre !== 'All' && game.genre !== filters.genre) return false;
      if (filters.protagonist !== 'All' && game.protagonist !== filters.protagonist) return false;
      if (filters.artStyle !== 'All' && game.artStyle !== filters.artStyle) return false;
      if (filters.upgrade !== 'All' && game.ps5Upgrade !== filters.upgrade) return false;
      if (filters.kidFriendly && !FAMILY_TIER_VALUES.includes(game.ageRating?.family)) return false;
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
  }, [deferredQuery, filters, wishlist, byTitle]);

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
        entry.value === 'deals'
          ? saleCount
          : entry.tag
            ? visiblePool.filter((game) => game.tags.includes(entry.tag)).length
            : visiblePool.length;
    }
    return counts;
  }, [visiblePool, saleCount]);

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
    activeFilterCount > 0;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Control bar. Collapses to a single compact row as soon as you scroll
          down, and springs back the moment you scroll up. */}
      <header
        ref={barRef}
        className={`sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur transition-[padding] duration-300 ease-swift ${
          compact ? 'px-3 py-2 sm:px-4' : 'px-3 py-3 sm:px-6 sm:py-4'
        }`}
      >
        <div className="mx-auto max-w-7xl">
          {/* Always-visible row: identity, search, filters, view switch. */}
          <div className="flex items-center gap-2">
            <h1
              className={`shrink-0 font-bold tracking-tight text-slate-800 transition-all duration-300 ease-swift ${
                compact ? 'w-0 overflow-hidden opacity-0 sm:w-auto sm:opacity-100' : ''
              } ${compact ? 'text-base' : 'text-lg sm:text-2xl'}`}
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
                placeholder={`Search ${gamesData.length} games...`}
                className="w-full rounded-full border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm outline-none transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                value={filters.q}
                onChange={(event) => set('q', event.target.value)}
              />
            </div>

            <button
              type="button"
              onClick={() => setSheetOpen((open) => !open)}
              aria-expanded={sheetOpen}
              aria-label="Filters"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-200 ease-spring active:scale-95 ${
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
              onClick={() => set('view', filters.view === 'feed' ? 'grid' : 'feed')}
              aria-label={filters.view === 'feed' ? 'Switch to grid' : 'Switch to feed'}
              title={filters.view === 'feed' ? 'Grid view' : 'Feed view'}
              className="shrink-0 rounded-full bg-slate-100 p-2 text-slate-600 transition-all duration-200 ease-spring hover:bg-slate-200 active:scale-90"
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
              aria-label="Collections"
              className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5"
            >
              {COLLECTIONS.map((entry) => {
                const active = filters.collection === entry.value;
                return (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() => set('collection', entry.value)}
                    aria-current={active ? 'true' : undefined}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all duration-200 ease-spring active:scale-95 ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {entry.value === 'deals' && <BadgePercent className="h-3.5 w-3.5" />}
                    {entry.label}
                    <span className={`tabular-nums ${active ? 'text-white/60' : 'text-slate-400'}`}>
                      {collectionCounts[entry.value]}
                    </span>
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
              onToggleWishlist={() => toggleWishlist(game.id)}
              onOpen={() => setActiveGameId(game.id)}
            />
          ))}
          {filteredGames.length === 0 && (
            <EmptyState
              filters={filters}
              wishlist={wishlist}
              status={status}
              onClear={clearFilters}
            />
          )}
        </main>
      ) : (
        <main className="mx-auto max-w-7xl px-3 pb-10 pt-3 sm:px-6">
          <p className="mb-3 text-xs font-medium text-slate-400">
            {filteredGames.length} of {visiblePool.length} games
            {COLLECTION_BLURBS[filters.collection] &&
              ` · ${COLLECTION_BLURBS[filters.collection]}`}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {filteredGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                live={byTitle.get(game.title)}
                wishlisted={wishlist.has(game.id)}
                onToggleWishlist={() => toggleWishlist(game.id)}
                onOpen={() => setActiveGameId(game.id)}
              />
            ))}
          </div>

          {filteredGames.length === 0 && (
            <EmptyState
              filters={filters}
              wishlist={wishlist}
              status={status}
              onClear={clearFilters}
            />
          )}
        </main>
      )}

      {activeGame && (
        <GameModal
          key={activeGame.id}
          game={activeGame}
          live={byTitle.get(activeGame.title)}
          wishlisted={wishlist.has(activeGame.id)}
          onToggleWishlist={() => toggleWishlist(activeGame.id)}
          onClose={() => setActiveGameId(null)}
        />
      )}
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
