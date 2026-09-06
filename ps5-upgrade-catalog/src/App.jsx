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
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
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

const SORTS = [
  { value: 'catalog', label: 'Catalog order' },
  { value: 'discount', label: 'Biggest discount' },
  { value: 'price', label: 'Lowest price' },
  { value: 'title', label: 'Title A-Z' },
];

const UPGRADE_STYLES = {
  'Free PS5 Upgrade': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  'PS4 & PS5 Cross-Buy': 'bg-sky-50 text-sky-700 ring-sky-600/20',
  'Paid PS5 Upgrade': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  'Backwards Compatible': 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

/* ------------------------------------------------------------------ *
 * Live storefront data
 * ------------------------------------------------------------------ */

const CHUNK_SIZE = 15;
const CHUNK_COUNT = Math.ceil(gamesData.length / CHUNK_SIZE);

/**
 * Pulls artwork, screenshots, trailers and current sale prices from
 * /api/games, one fixed chunk at a time. Chunk URLs are identical for every
 * visitor, so the CDN can serve most of these without touching the upstream
 * storefront. Cards render immediately and fill in as chunks land.
 */
function useLiveData() {
  const [byTitle, setByTitle] = useState(() => new Map());
  const [chunksLoaded, setChunksLoaded] = useState(0);
  const [status, setStatus] = useState('loading');
  const [updatedAt, setUpdatedAt] = useState(null);
  const runId = useRef(0);

  const load = useCallback(async (force = false) => {
    const run = ++runId.current;
    // On mount the state already reads as loading; only a refresh has to reset.
    if (force) {
      setStatus('loading');
      setChunksLoaded(0);
    }
    let failed = 0;

    for (let chunk = 0; chunk < CHUNK_COUNT; chunk += 1) {
      if (runId.current !== run) return;
      try {
        const response = await fetch(`/api/games?chunk=${chunk}`, {
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
  }, []);

  useEffect(() => {
    // Fetching on mount is the point of this effect; the state it writes lands
    // asynchronously, once each chunk comes back.
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

/** Cover art, or a lettered gradient when the game has no storefront match. */
function CoverArt({ game, live, className = '' }) {
  const [failed, setFailed] = useState(false);
  const image = live?.heroImage;

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

function GameModal({ game, live, onClose }) {
  const [selected, setSelected] = useState(null);
  const closeRef = useRef(null);

  const videos = live?.videos ?? [];
  const screenshots = live?.screenshots ?? [];

  // Default view: the trailer's poster frame, falling back to key art.
  const view =
    selected ??
    (videos[0]
      ? { kind: 'video-poster', video: videos[0] }
      : { kind: 'cover' });

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
          <h2 id="game-modal-title" className="pr-10 text-2xl font-bold text-slate-900">
            {game.title}
          </h2>

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

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

function GameCard({ game, live, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
        <h2 className="mb-2 text-lg font-bold leading-tight text-slate-800">{game.title}</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
            {game.genre}
          </span>
          <UpgradeBadge value={game.ps5Upgrade} />
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('All');
  const [selectedProtagonist, setSelectedProtagonist] = useState('All');
  const [selectedArtStyle, setSelectedArtStyle] = useState('All');
  const [selectedUpgrade, setSelectedUpgrade] = useState('All');
  const [onSaleOnly, setOnSaleOnly] = useState(false);
  const [sort, setSort] = useState('catalog');
  const [activeGameId, setActiveGameId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { byTitle, status, updatedAt, progress, refresh } = useLiveData();

  // Keeps typing responsive while React re-filters in the background.
  const deferredQuery = useDeferredValue(searchQuery);

  const filteredGames = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();

    const matches = gamesData.filter((game) => {
      if (needle && !game.title.toLowerCase().includes(needle)) return false;
      if (selectedGenre !== 'All' && game.genre !== selectedGenre) return false;
      if (selectedProtagonist !== 'All' && game.protagonist !== selectedProtagonist) return false;
      if (selectedArtStyle !== 'All' && game.artStyle !== selectedArtStyle) return false;
      if (selectedUpgrade !== 'All' && game.ps5Upgrade !== selectedUpgrade) return false;
      if (onSaleOnly && !(byTitle.get(game.title)?.price?.discountPercent > 0)) return false;
      return true;
    });

    if (sort === 'catalog') return matches;

    const priceOf = (game) => byTitle.get(game.title)?.price?.final ?? Number.POSITIVE_INFINITY;
    const discountOf = (game) => byTitle.get(game.title)?.price?.discountPercent ?? -1;

    return [...matches].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      if (sort === 'price') return priceOf(a) - priceOf(b);
      return discountOf(b) - discountOf(a);
    });
  }, [
    deferredQuery,
    selectedGenre,
    selectedProtagonist,
    selectedArtStyle,
    selectedUpgrade,
    onSaleOnly,
    sort,
    byTitle,
  ]);

  const saleCount = useMemo(
    () => gamesData.filter((game) => byTitle.get(game.title)?.price?.discountPercent > 0).length,
    [byTitle],
  );

  const activeGame = activeGameId
    ? gamesData.find((game) => game.id === activeGameId)
    : null;

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedGenre('All');
    setSelectedProtagonist('All');
    setSelectedArtStyle('All');
    setSelectedUpgrade('All');
    setOnSaleOnly(false);
  };

  const activeFilterCount = [
    selectedGenre,
    selectedProtagonist,
    selectedArtStyle,
    selectedUpgrade,
  ].filter((value) => value !== 'All').length;

  const filtersActive = Boolean(searchQuery) || onSaleOnly || activeFilterCount > 0;

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
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
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
                value={selectedGenre}
                options={GENRES}
                onChange={setSelectedGenre}
              />
              <Select
                label="All Protagonists"
                value={selectedProtagonist}
                options={PROTAGONISTS}
                onChange={setSelectedProtagonist}
              />
              <Select
                label="All Art Styles"
                value={selectedArtStyle}
                options={ART_STYLES}
                onChange={setSelectedArtStyle}
              />
              <Select
                label="All Upgrade Types"
                value={selectedUpgrade}
                options={UPGRADES}
                onChange={setSelectedUpgrade}
              />
              <Select
                label="Sort"
                value={sort}
                options={SORTS}
                onChange={setSort}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setOnSaleOnly((value) => !value)}
              aria-pressed={onSaleOnly}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                onSaleOnly
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <BadgePercent className="h-4 w-4" />
              On sale now
              {saleCount > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    onSaleOnly ? 'bg-white/25' : 'bg-white'
                  }`}
                >
                  {saleCount}
                </span>
              )}
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
        <p className="mb-6 font-medium text-slate-500">
          Showing {filteredGames.length} of {gamesData.length} games
        </p>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredGames.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              live={byTitle.get(game.title)}
              onOpen={() => setActiveGameId(game.id)}
            />
          ))}
        </div>

        {filteredGames.length === 0 && (
          <div className="py-20 text-center text-slate-500">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <p className="text-lg">No games found matching those filters.</p>
            {onSaleOnly && status === 'loading' && (
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
