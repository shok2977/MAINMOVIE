const STORAGE_KEY = "flakes_movies_data";
// VAST tag base. We append correlator at runtime to avoid empty correlator issues.
const VAST_TAG_URL_BASE =
  "https://pubads.g.doubleclick.net/gampad/ads?sz=640x480&iu=/124319096/external/single_ad_samples&ciu_szs=300x250&gdfp_req=1&env=vp&output=vast&unviewed_position_start=1&cust_params=deployment%3Ddevsite%26sample_ct%3Dlinear&correlator="; // Replace with your VAST tag URL

const API_BASE = "http://localhost:3001";

async function fetchVastMediaFromServer(vastTagUrl, debugLog) {
  try {
    const res = await fetch(
      `${API_BASE}/api/vast/media?tag=${encodeURIComponent(vastTagUrl)}`
    );
    if (!res.ok) {
      if (typeof debugLog === "function") {
        debugLog("VAST media fetch failed", { status: res.status, ok: res.ok });
      }
      return null;
    }
    return await res.json();
  } catch (_) {
    return null;
  }
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

function runAdThenContent(url) {
  const box = document.getElementById("player-box");
  if (!box) return;

  // contrib-ads preroll flow ko start karne ke liye video element ko "loadstart"
  // dekhne ki zarurat hoti hai. Humein real content iframe baad me replace karna hai,
  // isliye yahan ek dummy MP4 set karte hain.
  const DUMMY_VIDEO_URL = "https://vjs.zencdn.net/v/oceans.mp4";

  // Clear player box and insert video.js player
  box.innerHTML = `
    <video
      id="ad-player"
      class="video-js vjs-default-skin vjs-big-play-centered"
      controls
      width="100%"
      height="500"
    ></video>
  `;

  // Check if VAST tag is defined
  const hasVast =
    VAST_TAG_URL_BASE && VAST_TAG_URL_BASE !== "YOUR_VAST_TAG_URL";
  if (!hasVast) {
    showContent(url);
    return;
  }

  // Initialize video.js player with autoplay and muted (required for Chrome autoplay)
  const player = videojs("ad-player", {
    autoplay: true,
    muted: true,
    controls: true,
  });

  player.ready(async function () {
    let shownContent = false;
    let adStarted = false;
    let manualPlayback = false;

    // In-page debug overlay (console auto-clear ho sakta hai)
    const debugEl = document.createElement("div");
    debugEl.id = "vast-debug";
    debugEl.style.cssText =
      "position:absolute;bottom:0;left:0;right:0;max-height:40%;overflow:auto;background:rgba(0,0,0,.75);color:#fff;font-family:monospace;font-size:12px;padding:8px;z-index:99999;white-space:pre-wrap;";
    try {
      box.style.position = "relative";
      box.appendChild(debugEl);
    } catch (_) {}

    function debugLog(msg, extra) {
      const t = new Date().toISOString().replace("T", " ").replace("Z", "");
      const line =
        t + " " + msg + (extra !== undefined ? " " + JSON.stringify(extra) : "");
      try {
        // eslint-disable-next-line no-console
        console.log("VASTDBG:", msg, extra ?? "");
      } catch (_) {}
      try {
        debugEl.textContent = debugEl.textContent
          ? debugEl.textContent + "\n" + line
          : line;
      } catch (_) {}
    }

    // Attach event listeners BEFORE calling vastClient (avoid missing fast events)
    player.on("vast.adStart", () => {
      adStarted = true;
      debugLog("vast.adStart");
      try {
        const adUnit = player.vast && player.vast.adUnit;
        const src =
          adUnit && typeof adUnit.getSrc === "function" ? adUnit.getSrc() : null;
        debugLog("adUnit", {
          adUnitType: adUnit && adUnit.type,
          adSrcType: src ? typeof src : null,
        });
      } catch (_) {}
    });

    player.on("vast.adEnd", () => {
      debugLog("vast.adEnd");
      safeShowContent();
    });

    player.on("vast.adError", (e) => {
      debugLog("vast.adError", { error: e?.error ?? e });
      safeShowContent();
    });

    player.on("vast.adsCancel", () => {
      debugLog("vast.adsCancel");
      safeShowContent();
    });

    player.on("vast.contentStart", () => {
      debugLog("vast.contentStart");
    });

    // videojs-contrib-ads events (preroll flow)
    player.on("adstart", () => debugLog("contrib-ads adstart"));
    player.on("adend", () => debugLog("contrib-ads adend"));
    player.on("adserror", (e) => debugLog("contrib-ads adserror", e));
    player.on("adscanceled", (e) => debugLog("contrib-ads adscanceled", e));

    try {
      const vastTagUrl = `${VAST_TAG_URL_BASE}${Date.now()}${Math.floor(
        Math.random() * 1e9
      )}`;

      debugLog("VAST init", {
        vastTagUrl,
        vastClientType: typeof player.vastClient,
      });

      // Prefer server-side extracted mp4 for more reliable HTML5 playback.
      const manualMedia = await fetchVastMediaFromServer(vastTagUrl, debugLog);
      if (manualMedia?.media?.url) {
        manualPlayback = true;
        debugLog("Using server VAST media", manualMedia);
        player.src({
          src: manualMedia.media.url,
          type: manualMedia.media.type || "video/mp4",
        });
        try {
          await player.play();
        } catch (_) {
          // If browser blocks autoplay, user can press play.
        }

        const durMs =
          typeof manualMedia.durationSeconds === "number" &&
          manualMedia.durationSeconds > 0
            ? manualMedia.durationSeconds * 1000
            : 12000;

        // In case media doesn't fire "ended" correctly, fallback by duration.
        setTimeout(() => safeShowContent("manual ad timeout"), durMs + 500);
        player.one("ended", () => safeShowContent("manual ad ended"));
        return;
      }

      if (typeof player.vastClient !== "function") {
        debugLog("VAST plugin method missing; fallback to content.");
        showContent(url);
        return;
      }

      // Attach Google test VAST tag
      try {
        // Fallback source to provide a loadstart/content context.
        player.src({ src: DUMMY_VIDEO_URL, type: "video/mp4" });
      } catch (_) {}

      player.vastClient({
        adTagUrl: vastTagUrl,
        playAdAlways: true,
        adCancelTimeout: 12000,
        adsEnabled: true,
        // Flash fallback se black screen / invisible creatives ho sakte hain.
        // Aapke project me SWF file present nahi hai, isliye HTML5 force karte hain.
        preferredTech: "html5",
        verbosity: 3,
      });
    } catch (e) {
      debugLog("VAST init failed; fallback to content.", {
        error: e?.message ?? String(e),
      });
      // If VAST fails, load content immediately
      showContent(url);
      return;
    }

    function safeShowContent() {
      if (shownContent) return;
      shownContent = true;

      debugLog("safeShowContent", { adStarted });

      try {
        // Show content immediately; then cleanup player to avoid race conditions
        // while the ad tech is transitioning.
        showContent(url);
      } catch (_) {}

      try {
        player.pause();
        player.dispose();
      } catch (_) {}
    }

    // (duplicate handlers removed; see listeners above)

    // Safety timeout: agar VAST start nahi hua, load content after ~30s
    setTimeout(function () {
      // If already replaced with content, don't do anything.
      if (document.querySelector("#player-box iframe")) return;
      // Only fallback if VAST never started; don't cut off long ads (45s).
      if (!adStarted && !manualPlayback)
        safeShowContent("timeout(no vast.adStart)");
    }, 30000);
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
  const languagesEl = document.getElementById("player-languages");

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

  // Render language options (always show bar with "Original")
  const extraLanguages = Array.isArray(movie.languages) ? movie.languages : [];
  if (languagesEl) {
    languagesEl.innerHTML = "";

    const label = document.createElement("span");
    label.className = "player-languages-label";
    label.textContent = "Languages:";
    languagesEl.appendChild(label);

    const list = document.createElement("div");
    list.className = "player-languages-list";

    // Original language (default vidsrc)
    const originalBtn = document.createElement("button");
    originalBtn.className = "player-language-chip active";
    originalBtn.textContent = "Original";
    originalBtn.addEventListener("click", () => {
      // Stay on same page (default vidsrc)
      const url = new URL(window.location.href);
      url.searchParams.delete("lang");
      window.location.href = url.toString();
    });
    list.appendChild(originalBtn);

    // Extra languages defined by admin
    extraLanguages.forEach((lang, index) => {
      const btn = document.createElement("button");
      btn.className = "player-language-chip";
      btn.textContent = lang?.name || `Language ${index + 1}`;
      btn.addEventListener("click", () => {
        // Use relative URL so it works on file:// and http://
        const url = new URL("player-lang.html", window.location.href);
        url.searchParams.set("key", movieKey);
        url.searchParams.set("lang", String(index));
        window.location.href = url.toString();
      });
      list.appendChild(btn);
    });

    languagesEl.appendChild(list);
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
      if (movie.type === "anime") {
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

  // Initial playback for vidsrc sources only; downloads wait for episode click
  if (movie.sourceKind !== "download") {
    const url =
      movie.type === "movie"
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
