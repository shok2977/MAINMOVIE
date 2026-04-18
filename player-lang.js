const STORAGE_KEY = "flakes_movies_data";

const API_BASE = "http://localhost:3001";

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

function renderEpisodesForFluid(movie, currentSeason, currentEpisode) {
  const container = document.getElementById("player-episodes");
  if (!container) return;
  container.innerHTML = "";

  if (movie.type !== "tv" && movie.type !== "anime") return;
  const seasons = movie.seasons || [];
  if (!Array.isArray(seasons) || seasons.length === 0) return;

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
        const url = new URL(window.location.href);
        url.searchParams.set("season", String(s.season_number));
        url.searchParams.set("episode", String(ep.episode_number));
        window.location.href = url.toString();
      });
      list.appendChild(chip);
    });
  });

  container.appendChild(list);
}

document.addEventListener("DOMContentLoaded", async () => {
  const movieKey = getQueryParam("key");
  const langIndexStr = getQueryParam("lang");
  const seasonParam = getQueryParam("season");
  const episodeParam = getQueryParam("episode");

  const titleEl = document.getElementById("alt-player-title");
  const langEl = document.getElementById("alt-player-language");
  const container = document.getElementById("fluid-player-container");

  if (!movieKey) {
    if (titleEl) titleEl.textContent = "Not found";
    if (langEl) langEl.textContent = "Missing movie.";
    return;
  }

  const data = await loadMovieDataPreferApi(movieKey);
  const movie = data.movies[movieKey];

  if (!movie) {
    if (titleEl) titleEl.textContent = "Not found";
    if (langEl) langEl.textContent = "This title is not in the library.";
    return;
  }

  if (titleEl) titleEl.textContent = movie.title || "Untitled";

  // SEO helpers (client-side): update title + meta description
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

  // Determine current season/episode (for TV/Anime downloads)
  let currentSeason = null;
  let currentEpisode = null;
  if (movie.type === "tv" || movie.type === "anime") {
    if (seasonParam && episodeParam) {
      currentSeason = parseInt(seasonParam, 10) || 1;
      currentEpisode = parseInt(episodeParam, 10) || 1;
    } else if (Array.isArray(movie.seasons) && movie.seasons.length) {
      const firstSeason = movie.seasons[0];
      currentSeason = firstSeason.season_number || 1;
      currentEpisode =
        (firstSeason.episodes &&
          firstSeason.episodes[0] &&
          firstSeason.episodes[0].episode_number) ||
        1;
    }
  }

  const languages = Array.isArray(movie.languages) ? movie.languages : [];
  const langIndex =
    langIndexStr !== null && langIndexStr !== undefined
      ? parseInt(langIndexStr, 10)
      : 0;
  const lang =
    !Number.isNaN(langIndex) && languages.length ? languages[langIndex] : null;

  let scriptToUse = "";

  // 1) Downloads TV/Anime per-episode
  if (
    movie.sourceKind === "download" &&
    (movie.type === "tv" || movie.type === "anime") &&
    currentSeason !== null &&
    currentEpisode !== null
  ) {
    if (langEl) {
      langEl.textContent = `Language: ${
        lang?.name || "Original"
      } · Season ${currentSeason} · Episode ${currentEpisode}`;
    }

    // Render language chips (for TV/Anime downloads)
    const playerLanguagesEl = document.getElementById("player-languages");
    if (playerLanguagesEl) {
      playerLanguagesEl.innerHTML = "";
      const label = document.createElement("span");
      label.className = "player-languages-label";
      label.textContent = "Languages:";
      playerLanguagesEl.appendChild(label);

      const list = document.createElement("div");
      list.className = "player-languages-list";

      // If no languages saved, fall back to a single "Original" chip.
      const langList = languages.length ? languages : [{ name: "Original" }];

      langList.forEach((l, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "player-language-chip" + (idx === langIndex ? " active" : "");
        btn.textContent = l?.name || `Language ${idx + 1}`;
        btn.addEventListener("click", () => {
          const url = new URL(window.location.href);
          url.searchParams.set("lang", String(idx));
          url.searchParams.set("season", String(currentSeason));
          url.searchParams.set("episode", String(currentEpisode));
          window.location.href = url.toString();
        });
        list.appendChild(btn);
      });

      playerLanguagesEl.appendChild(list);
    }

    const key = `s${currentSeason}_e${currentEpisode}`;
    const episodesByLang = movie.downloadEpisodesByLang || {};
    const entry = episodesByLang[String(langIndex)]?.[key];

    // Backward compatibility for old saved data
    const fallbackEntry = movie.downloadEpisodes
      ? movie.downloadEpisodes[key]
      : null;

    const finalEntry = entry || fallbackEntry;
    if (finalEntry && typeof finalEntry === "object" && finalEntry.script) {
      scriptToUse = finalEntry.script;
    } else if (typeof finalEntry === "string") {
      scriptToUse = finalEntry;
    }
  } else {
    // 2) Language-based scripts (movies or manual configs)
    if (lang) {
      if (langEl) langEl.textContent = `Language: ${lang.name || "Alternate"}`;
      scriptToUse = lang.script || "";
    } else {
      if (langEl) langEl.textContent = "Language configuration not found.";
    }
  }

  // For TV/Anime downloads, render the full episodes list alongside the player.
  if (
    movie.sourceKind === "download" &&
    (movie.type === "tv" || movie.type === "anime") &&
    currentSeason !== null &&
    currentEpisode !== null
  ) {
    renderEpisodesForFluid(movie, currentSeason, currentEpisode);
  }

  if (container && scriptToUse) {
    // Inject HTML for Fluid Player structure
    container.innerHTML = scriptToUse;

    const scriptNodes = Array.from(container.querySelectorAll("script"));
    const inlineScripts = [];
    const fluidExternalScripts = [];

    scriptNodes.forEach((oldScript) => {
      const src = oldScript.getAttribute("src");
      if (src) {
        if (src.includes("fluidplayer.com")) {
          fluidExternalScripts.push(src);
        }
        const newScript = document.createElement("script");
        newScript.src = src;
        document.body.appendChild(newScript);
      } else if (oldScript.textContent) {
        inlineScripts.push(oldScript.textContent);
      }
    });

    function runInlineScripts() {
      inlineScripts.forEach((code) => {
        try {
          new Function(code)();
        } catch (e) {
          console.error("Error running language script", e);
        }
      });
    }

    if (inlineScripts.length) {
      // If embed already includes Fluid Player script, wait for it to load, then run.
      if (fluidExternalScripts.length) {
        let loaded = 0;
        fluidExternalScripts.forEach((src) => {
          const s = document.createElement("script");
          s.src = src;
          s.onload = () => {
            loaded += 1;
            if (loaded === fluidExternalScripts.length) {
              runInlineScripts();
            }
          };
          document.body.appendChild(s);
        });
      } else if (window.fluidPlayer) {
        // Already present globally
        runInlineScripts();
      } else {
        // Fallback: load Fluid Player from CDN, then run
        const fpScript = document.createElement("script");
        fpScript.src = "https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js";
        fpScript.onload = runInlineScripts;
        document.body.appendChild(fpScript);
      }
    }
  }
});

