const STORAGE_KEY = "flakes_movies_data";

// Default = Google demo tag only so local testing shows a real preroll. Production: put YOUR
// Ad Manager / GAM / third-party VAST URL here — the player does not whitelist domains; IMA loads
// whatever tag you give. If the server returns empty VAST (no <Ad>), you get no ad on ANY tag.
// Optional test override: player.html?key=...&adtag=ENCODED_FULL_TAG_URL
const VAST_TAG_URL_BASE =
  "https://pubads.g.doubleclick.net/gampad/ads?sz=400x300&iu=/124319096/external/single_ad_samples&ciu_szs=300x250&impl=s&gdfp_req=1&env=vp&output=vast&unviewed_position_start=1&cust_params=deployment%3Ddevsite&correlator=";

const API_BASE = "http://localhost:3001";

function getEffectiveVastTagBase() {
  const raw = getQueryParam("adtag");
  if (raw && String(raw).trim()) {
    try {
      return decodeURIComponent(String(raw).trim());
    } catch (_) {
      return String(raw).trim();
    }
  }
  return String(VAST_TAG_URL_BASE || "").trim();
}

function buildVastTagUrl() {
  const base = getEffectiveVastTagBase();
  if (!base) return "";
  const correlator = `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  if (base.includes("correlator=")) return base + correlator;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}correlator=${encodeURIComponent(correlator)}`;
}

async function fetchAllData() {
  const res = await fetch(`${API_BASE}/api/data`);
  if (!res.ok) throw new Error("Failed to load data");
  return await res.json();
}

async function loadMovieDataPreferApi(movieKey) {
  try {
    const data = await fetchAllData();
    if (data?.movies && data.movies[movieKey]) return data;
  } catch (_) {}
  return loadMovieData();
}

function loadMovieData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { movies: {}, lists: {} };
    const parsed = JSON.parse(raw);
    return { movies: parsed.movies || {}, lists: parsed.lists || {} };
  } catch (e) {
    return { movies: {}, lists: {} };
  }
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function buildVidsrcUrl(movie, season, episode, animeDub) {
  const id = movie.tmdbId;
  if (movie.type === "movie" || movie.type === "animeMovie") {
    return `https://vidsrc.icu/embed/movie/${id}`;
  }
  if (movie.type === "anime") {
    const ep = episode !== undefined ? episode : 1;
    const dub = animeDub || "sub";
    return `https://vidsrc.icu/embed/anime/${id}/${ep}/${dub}`;
  }
  if (movie.type === "tv") {
    const s = season !== undefined ? season : 1;
    const e = episode !== undefined ? episode : 1;
    return `https://vidsrc.icu/embed/tv/${id}/${s}/${e}`;
  }
  return `https://vidsrc.icu/embed/movie/${id}`;
}

const STREAMMAFIA_QUERY =
  "?autoplay=false&autonext=true&audio=true&title=true&download=false&setting=true&episodelist=true&watchparty=false&chromecast=true&pip=true&nextbutton=true&hidecontrols=false&primarycolor=f00000&secondarycolor=000000&iconcolor=43ff0f&iconsize=1&logowidth=100px&font=Roboto&fontcolor=ffffff&fontsize=20&opacity=0.50&glasscolor=000000&glassopacity=65&glassblur=20&subtitle=Off&subdelay=0&subtextsize=45&subtextcolor=ffffff&subcapitalize=false&subbold=false&subfont=Roboto&subbgenabled=false&subbgcolor=000000&subbgopacity=0&subbgblur=0";

function buildStreammafiaUrl(movie, season, episode) {
  const id = movie.tmdbId;
  if (movie.type === "movie" || movie.type === "animeMovie") {
    return `https://embed.streammafia.to/embed/movie/${id}${STREAMMAFIA_QUERY}`;
  }
  const s = season !== undefined ? season : 1;
  const e = episode !== undefined ? episode : 1;
  return `https://embed.streammafia.to/embed/tv/${id}/${s}/${e}${STREAMMAFIA_QUERY}`;
}

function computeAnimeLinearEpisode(seasons, seasonNum, episodeNum) {
  let linear = 0;
  for (const s of seasons || []) {
    if (s.season_number < seasonNum) {
      linear += (s.episodes || []).length;
    } else if (s.season_number === seasonNum) {
      linear += episodeNum;
      return linear;
    }
  }
  return 1;
}

function showContent(url) {
  const box = document.getElementById("player-box");
  if (!box) return;
  box.innerHTML = `<iframe src="${url}" allowfullscreen allow="autoplay; encrypted-media"></iframe>`;
}

// Short MP4 so Video.js + contrib-ads have real content; preroll runs before this plays.
const IMA_PLACEHOLDER_CONTENT =
  "https://storage.googleapis.com/gvabox/media/samples/stock.mp4";

function runAdThenContent(url) {
  const box = document.getElementById("player-box");
  if (!box) return;

  box.innerHTML = `
    <video
      id="ad-player"
      class="video-js vjs-default-skin vjs-big-play-centered"
      controls
      playsinline
      width="100%"
      height="500"
    ></video>
  `;

  const vastBaseForCheck = getEffectiveVastTagBase();
  const hasVast =
    vastBaseForCheck && vastBaseForCheck !== "https://pubads.g.doubleclick.net/gampad/ads?sz=400x300&iu=/124319096/external/single_ad_samples&ciu_szs=300x250&impl=s&gdfp_req=1&env=vp&output=vast&unviewed_position_start=1&cust_params=deployment%3Ddevsite&correlator=";
  if (!hasVast) {
    showContent(url);
    return;
  }

  const vastTagUrl = buildVastTagUrl();
  if (!vastTagUrl) {
    showContent(url);
    return;
  }

  const imaPageUrl = (function () {
    try {
      const h = String(window.location.href || "");
      if (h && !h.startsWith("file:")) return h;
    } catch (_) {}
    return "http://localhost:3001/player.html";
  })();

  let shownContent = false;
  const player = videojs("ad-player", {
    controls: true,
    autoplay: true,
    muted: true,
    playsinline: true,
    preload: "auto",
    fluid: false,
    width: "100%",
    height: 500,
  });

  function safeShowContent(/* reason */) {
    if (shownContent) return;
    shownContent = true;
    try {
      player.dispose();
    } catch (_) {}
    try {
      showContent(url);
    } catch (_) {}
  }

  player.ready(function () {
    let imaPluginOk = true;
    if (typeof videojs !== "undefined" && typeof videojs.getPlugin === "function") {
      imaPluginOk = typeof videojs.getPlugin("ima") === "function";
    }
    if (typeof google === "undefined" || !google.ima || !imaPluginOk) {
      safeShowContent("ima-missing");
      return;
    }

    let allAdsCompletedBound = false;
    function bindAllAdsCompleted(ev) {
      if (allAdsCompletedBound) return;
      try {
        const ctrl = player.ima;
        const mgr =
          (ev && ev.adsManager) ||
          (ctrl && ctrl.getAdsManager && ctrl.getAdsManager());
        if (!mgr || !mgr.addEventListener) return;
        allAdsCompletedBound = true;
        mgr.addEventListener(
          google.ima.AdEvent.Type.ALL_ADS_COMPLETED,
          function () {
            safeShowContent("ALL_ADS_COMPLETED");
          }
        );
      } catch (_) {}
    }

    player.src({
      src: IMA_PLACEHOLDER_CONTENT,
      type: "video/mp4",
    });

    try {
      player.ima({
        id: "ad-player",
        adTagUrl: vastTagUrl,
        vpaidMode: google.ima.ImaSdkSettings.VpaidMode.ENABLED,
        adsRequest: {
          pageUrl: imaPageUrl,
        },
        contribAdsSettings: {
          timeout: 30000,
          prerollTimeout: 20000,
        },
      });
    } catch (_) {
      safeShowContent("ima-plugin");
      return;
    }

    player.on("ads-manager", function (ev) {
      bindAllAdsCompleted(ev);
    });
    player.one("ads-ad-started", function () {
      bindAllAdsCompleted();
    });

    player.on("adserror", function () {
      safeShowContent("adserror");
    });

    // IMA requires AdDisplayContainer.initialize() from a user gesture on many browsers
    // (esp. mobile). Capture phase runs before Video.js big-play-button so preroll can start.
    const el = player.el();
    const primeImaFromUser = function () {
      try {
        player.ima.initializeAdDisplayContainer();
      } catch (_) {}
    };
    el.addEventListener("click", primeImaFromUser, true);
    el.addEventListener("touchend", primeImaFromUser, {
      capture: true,
      passive: true,
    });
    el.addEventListener("keydown", primeImaFromUser, true);

    try {
      player.play().catch(function () {});
    } catch (_) {
      safeShowContent("ima-init");
    }

    setTimeout(function () {
      if (document.querySelector("#player-box iframe")) return;
      safeShowContent("timeout");
    }, 120000);
  });
}

function renderEpisodes(movie, onSelect, currentSeason, currentEpisode) {
  const container = document.getElementById("player-episodes");
  if (!container) return;
  container.innerHTML = "";

  if (movie.type !== "tv" && movie.type !== "anime") return;
  const seasons = movie.seasons || [];
  if (seasons.length === 0) return;

  const title = document.createElement("div");
  title.className = "player-episodes-title";
  title.textContent = "Episodes";
  container.appendChild(title);

  const list = document.createElement("div");
  list.className = "player-episodes-list";

  seasons.forEach((s) => {
    const eps = s.episodes || [];
    eps.forEach((ep) => {
      const chip = document.createElement("button");
      chip.className = "player-episode-chip";
      const isActive =
        currentSeason === s.season_number &&
        currentEpisode === ep.episode_number;
      if (isActive) chip.classList.add("active");
      chip.textContent = `S${s.season_number} · E${ep.episode_number}`;
      chip.dataset.season = String(s.season_number);
      chip.dataset.episode = String(ep.episode_number);
      chip.addEventListener("click", () => {
        onSelect(s.season_number, ep.episode_number);
      });
      list.appendChild(chip);
    });
  });

  container.appendChild(list);
}

document.addEventListener("DOMContentLoaded", async () => {
  const movieKey = getQueryParam("key");
  const titleEl = document.getElementById("player-title");
  const overviewEl = document.getElementById("player-overview");

  if (!movieKey) {
    if (titleEl) titleEl.textContent = "Not found";
    if (overviewEl) overviewEl.textContent = "No title selected.";
    return;
  }

  const data = await loadMovieDataPreferApi(movieKey);
  const movie = data.movies[movieKey];

  if (!movie) {
    if (titleEl) titleEl.textContent = "Not found";
    if (overviewEl) overviewEl.textContent = "This title is not in the library.";
    return;
  }

  if (titleEl) titleEl.textContent = movie.title || "Untitled";
  if (overviewEl) overviewEl.textContent = movie.overview || "";

  // SEO helpers (client-side): update title + meta description on the fly.
  try {
    const movieTitle = movie.title || "Untitled";
    document.title = `${movieTitle} | ZyroMovies`;

    const metaDesc =
      document.querySelector('meta[name="description"]') ||
      (() => {
        const m = document.createElement("meta");
        m.setAttribute("name", "description");
        document.head.appendChild(m);
        return m;
      })();
    metaDesc.setAttribute("content", movie.overview || movieTitle);
  } catch (_) {}

  // If this title is a download/Fluid source and is a movie/animeMovie,
  // send user directly to Fluid player page (single code).
  if (
    movie.sourceKind === "download" &&
    (movie.type === "movie" || movie.type === "animeMovie")
  ) {
    const url = new URL("player-lang.html", window.location.href);
    url.searchParams.set("key", movieKey);
    url.searchParams.set("lang", "0");
    window.location.href = url.toString();
    return;
  }

  let selectedSeason = 1;
  let selectedEpisode = 1;

  if (movie.type === "tv" && movie.seasons && movie.seasons.length) {
    const first = movie.seasons[0];
    selectedSeason = first.season_number;
    selectedEpisode = (first.episodes && first.episodes[0]?.episode_number) || 1;
  }
  if (movie.type === "anime" && movie.seasons && movie.seasons.length) {
    const first = movie.seasons[0];
    selectedSeason = first.season_number;
    selectedEpisode = (first.episodes && first.episodes[0]?.episode_number) || 1;
  }
  const playEpisode = (season, episode) => {
    selectedSeason = season;
    selectedEpisode = episode;
    renderEpisodes(movie, playEpisode, season, episode);
    // For downloads TV/Anime, go to Fluid player per-episode page
    if (movie.sourceKind === "download") {
      const url = new URL("player-lang.html", window.location.href);
      url.searchParams.set("key", movieKey);
      url.searchParams.set("season", String(season));
      url.searchParams.set("episode", String(episode));
      window.location.href = url.toString();
    } else {
      let url;
      if (movie.sourceKind === "streammafia") {
        url = buildStreammafiaUrl(movie, season, episode);
      } else if (movie.type === "anime") {
        const linearEp = computeAnimeLinearEpisode(
          movie.seasons,
          season,
          episode
        );
        url = buildVidsrcUrl(movie, null, linearEp, "sub");
      } else {
        url = buildVidsrcUrl(movie, season, episode);
      }
      runAdThenContent(url);
    }
  };

  renderEpisodes(movie, playEpisode, selectedSeason, selectedEpisode);

  // Initial playback for embedded sources; downloads wait for episode click
  if (movie.sourceKind !== "download") {
    const url =
      movie.sourceKind === "streammafia"
        ? buildStreammafiaUrl(movie, selectedSeason, selectedEpisode)
        : movie.type === "movie"
          ? buildVidsrcUrl(movie)
          : movie.type === "anime"
            ? buildVidsrcUrl(
                movie,
                null,
                computeAnimeLinearEpisode(
                  movie.seasons,
                  selectedSeason,
                  selectedEpisode
                ),
                "sub"
              )
            : buildVidsrcUrl(movie, selectedSeason, selectedEpisode);

    runAdThenContent(url);
  }
});
