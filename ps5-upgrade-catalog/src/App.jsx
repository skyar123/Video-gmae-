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
  BadgePercent,
  CirclePlay,
  ExternalLink,
  Gamepad2,
  Heart,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
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
];

const COLLECTION_BLURBS = {
  deals: 'Everything discounted right now, deepest cut first. Updates with the storefront.',
  graphics: 'Technical showcases and standout art direction.',
  social: 'Online play, co-op and couch multiplayer.',
  cozy: 'Low-stress games with gentle pacing and no fail state to speak of.',
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

/* ------------------------------------------------------------------ *
 * Small presentational pieces
 * ------------------------------------------------------------------ */

function UpgradeBadge({ value, className = '' }) {
  return (
    <span
      className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${
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

const storeLink = (title) =>
  `https://store.playstation.com/en-us/search/${encodeURIComponent(title)}`;
const trailerSearchLink = (title) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${title} gameplay PS5`,
  )}`;

function GameModal({ game, live, wishlisted, onToggleWishlist, onClose }) {
  const [selected, setSelected] = useState(null);
  const closeRef = useRef(null);

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

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
            <div>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                PS5 Status
              </span>
              <UpgradeBadge value={game.ps5Upgrade} />
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="leading-relaxed text-slate-700">{game.description}</p>
          </div>

          <PricePanel live={live} />
          <PredictionPanel live={live} />

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              href={storeLink(game.title)}
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
function PricePanel({ live }) {
  if (!live) {
    return (
      <p className="mt-6 flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking current price...
      </p>
    );
  }

  if (!live.matched || !live.price) {
    return (
      <p className="mt-6 text-sm text-slate-500">
        No live price available for this title. Check the PS Store for regional pricing.
      </p>
    );
  }

  const { price } = live;
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
        href={live.storeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
      >
        Current PC price via Steam
        <ArrowUpRight className="h-3.5 w-3.5" />
      </a>
      <p className="w-full text-xs text-slate-400">
        Sony publishes no open price feed, so this tracks the PC storefront as a sale signal.
        PS Store pricing varies by region.
      </p>
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
  const showVerdict = prediction && (prediction.verdict === 'buy-now' || prediction.verdict === 'wait');

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-md focus-within:ring-2 focus-within:ring-indigo-500">
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

        <div className="flex flex-1 flex-col p-5">
          <h2 className="mb-2 pr-8 text-lg font-bold leading-tight text-slate-800">{game.title}</h2>
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
              {game.genre}
            </span>
            <UpgradeBadge value={game.ps5Upgrade} />
            {showVerdict && <VerdictBadge prediction={prediction} />}
          </div>
          <p className="line-clamp-3 text-sm text-slate-600">{game.description}</p>
          {live?.price && (
            <p className="mt-4 flex items-baseline gap-2 border-t border-slate-100 pt-3 text-sm">
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

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

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
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { byTitle, status, updatedAt, progress, refresh } = useLiveData(filters.region);

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

  const activeFilterCount = [
    filters.genre,
    filters.protagonist,
    filters.artStyle,
    filters.upgrade,
  ].filter((value) => value !== 'All').length;

  const filtersActive =
    Boolean(filters.q) || filters.sale || filters.wishlist || activeFilterCount > 0;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl">
              PS4 to PS5 Upgrade Catalog
            </h1>
            <LiveStatus
              status={status}
              progress={progress}
              updatedAt={updatedAt}
              onRefresh={refresh}
            />
          </div>

          <nav aria-label="Collections" className="mb-4 flex flex-wrap gap-2">
            {COLLECTIONS.map((entry) => {
              const active = filters.collection === entry.value;
              return (
                <button
                  key={entry.value}
                  type="button"
                  onClick={() => set('collection', entry.value)}
                  aria-current={active ? 'true' : undefined}
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {entry.value === 'deals' && <BadgePercent className="h-4 w-4" />}
                  {entry.label}
                  <span
                    className={`rounded-full px-1.5 text-xs ${
                      active ? 'bg-white/20' : 'bg-white'
                    }`}
                  >
                    {collectionCounts[entry.value]}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search titles"
                placeholder="Search titles..."
                className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-4 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                value={filters.q}
                onChange={(event) => set('q', event.target.value)}
              />
            </div>

            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-indigo-600 px-1.5 text-xs text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>

            <div
              className={`${
                filtersOpen ? 'grid' : 'hidden'
              } grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap`}
            >
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
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => set('sale', !filters.sale)}
              aria-pressed={filters.sale}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                filters.sale
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <BadgePercent className="h-4 w-4" />
              On sale now
              {saleCount > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    filters.sale ? 'bg-white/25' : 'bg-white'
                  }`}
                >
                  {saleCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => set('wishlist', !filters.wishlist)}
              aria-pressed={filters.wishlist}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                filters.wishlist
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Heart className={`h-4 w-4 ${filters.wishlist ? 'fill-current' : ''}`} />
              Wishlist
              {wishlist.size > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    filters.wishlist ? 'bg-white/25' : 'bg-white'
                  }`}
                >
                  {wishlist.size}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => set('includePs5', !filters.includePs5)}
              aria-pressed={filters.includePs5}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                filters.includePs5
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Gamepad2 className="h-4 w-4" />
              PS5-only titles
              <span
                className={`rounded-full px-1.5 text-xs ${
                  filters.includePs5 ? 'bg-white/25' : 'bg-white'
                }`}
              >
                {filters.includePs5 ? 'shown' : 'hidden'}
              </span>
            </button>

            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Clear filters
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        <div className="mb-6">
          <p className="font-medium text-slate-500">
            Showing {filteredGames.length} of {visiblePool.length} games
          </p>
          {COLLECTION_BLURBS[filters.collection] && (
            <p className="mt-1 text-sm text-slate-400">
              {COLLECTION_BLURBS[filters.collection]}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
              onClick={clearFilters}
              className="mt-4 font-medium text-indigo-600 hover:underline"
            >
              Clear all filters
            </button>
          </div>
        )}
      </main>

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
