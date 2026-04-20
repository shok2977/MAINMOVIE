// UTILITIES FOR MOVIE STORAGE

const API_BASE = "http://localhost:3001";

async function fetchAllData() {
  const res = await fetch(`${API_BASE}/api/data`);
  if (!res.ok) throw new Error("Failed to load data");
  return await res.json();
}

// Fallback for current setup (admin still writes to localStorage).
// Once admin/player migrate fully, MongoDB will be the only source.
const STORAGE_KEY = "flakes_movies_data";
function loadMovieDataLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { movies: {}, lists: {}, banners: [] };
    const parsed = JSON.parse(raw);
    return {
      movies: parsed.movies || {},
      lists: parsed.lists || {},
      banners: parsed.banners || [],
      listOrder: Array.isArray(parsed.listOrder) ? parsed.listOrder : [],
    };
  } catch (_) {
    return { movies: {}, lists: {}, banners: [] };
  }
}

async function fetchAllDataPreferApi() {
  try {
    const data = await fetchAllData();
    if (
      data &&
      data.movies &&
      Object.keys(data.movies).length > 0 &&
      data.lists
    ) {
      return data;
    }
    return loadMovieDataLocal();
  } catch (_) {
    return loadMovieDataLocal();
  }
}

function getMovieIdKey(tmdbId, type) {
  return `${type}-${tmdbId}`;
}

/** Home page only: "Random" / "Random 2" … are built-in (not stored in DB). */
function isReservedRandomListName(name) {
  const t = String(name || "").trim();
  if (/^Random$/i.test(t)) return true;
  if (/^Random\s+\d+$/i.test(t)) return true;
  return false;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

const RANDOM_ROW_SIZE = 10;

function navigateToMoviePlayer(movie, movieKey) {
  if (
    movie.sourceKind === "download" &&
    (movie.type === "tv" || movie.type === "anime") &&
    Array.isArray(movie.seasons) &&
    movie.seasons.length
  ) {
    const firstSeason = movie.seasons[0];
    const firstEp =
      (firstSeason.episodes &&
        firstSeason.episodes[0] &&
        firstSeason.episodes[0].episode_number) ||
      1;
    const url = new URL("player-lang.html", window.location.href);
    url.searchParams.set("key", movieKey);
    url.searchParams.set("season", String(firstSeason.season_number));
    url.searchParams.set("episode", String(firstEp));
    url.searchParams.set("lang", "0");
    window.location.href = url.toString();
  } else {
    window.location.href = `player.html?key=${encodeURIComponent(movieKey)}`;
  }
}

function appendMovieListSection(root, data, listTitle, movieKeys) {
  if (!movieKeys.length) return;

  const container = document.createElement("div");
  container.className = "movie-list-container";

  const titleEl = document.createElement("h1");
  titleEl.className = "movie-list-title";
  titleEl.textContent = listTitle;
  container.appendChild(titleEl);

  const wrapper = document.createElement("div");
  wrapper.className = "movie-list-wrapper";

  const listEl = document.createElement("div");
  listEl.className = "movie-list";

  movieKeys.forEach((movieKey) => {
    const movie = data.movies[movieKey];
    if (!movie) return;

    const item = document.createElement("div");
    item.className = "movie-list-item";
    item.dataset.movieKey = movieKey;
    item.addEventListener("click", () => navigateToMoviePlayer(movie, movieKey));

    const img = document.createElement("img");
    img.className = "movie-list-item-img";
    img.src = movie.posterUrl || "img/1.jpeg";
    img.alt = movie.title || "";

    const title = document.createElement("span");
    title.className = "movie-list-item-title";
    title.textContent = movie.title || "Untitled";

    const desc = document.createElement("p");
    desc.className = "movie-list-item-desc";
    desc.textContent =
      movie.overview || "No description available for this title yet.";

    const btn = document.createElement("button");
    btn.className = "movie-list-item-button";
    btn.textContent = "Watch";

    item.appendChild(img);
    item.appendChild(title);
    item.appendChild(desc);
    item.appendChild(btn);
    listEl.appendChild(item);
  });

  wrapper.appendChild(listEl);
  container.appendChild(wrapper);
  root.appendChild(container);
}

// RENDER LISTS ON HOME PAGE (DYNAMIC)

function getOrderedCustomListNames(data) {
  const listsObj = data.lists || {};
  const custom = Object.keys(listsObj).filter(
    (n) => !isReservedRandomListName(n)
  );
  const apiOrder = Array.isArray(data.listOrder) ? data.listOrder : [];
  const ordered = [];
  apiOrder.forEach((n) => {
    if (custom.includes(n)) ordered.push(n);
  });
  custom
    .filter((n) => !ordered.includes(n))
    .sort((a, b) => a.localeCompare(b))
    .forEach((n) => ordered.push(n));
  return ordered;
}

async function renderDynamicLists() {
  const data = await fetchAllDataPreferApi();
  const root = document.getElementById("dynamic-lists-root");
  if (!root) return;

  root.innerHTML = "";

  const movies = data.movies || {};
  const allKeys = Object.keys(movies);

  const listNames = getOrderedCustomListNames(data);

  listNames.forEach((listName) => {
    let movieIds = (data.lists[listName] || []).filter((k) => movies[k]);
    movieIds = shuffleArray(movieIds);
    appendMovieListSection(root, data, listName, movieIds);
  });

  // Random rows always at bottom: every title; 10 per row; shuffled each load.
  if (allKeys.length) {
    const shuffledAll = shuffleArray(allKeys);
    const parts = chunkArray(shuffledAll, RANDOM_ROW_SIZE);
    parts.forEach((chunkKeys, i) => {
      const title = i === 0 ? "Random" : `Random ${i + 1}`;
      appendMovieListSection(root, data, title, chunkKeys);
    });
  }
}

// SEARCH

async function performSearch(query) {
  const trimmed = query.trim().toLowerCase();
  const resultsContainer = document.getElementById("search-results-container");
  const resultsList = document.getElementById("search-results");
  if (!resultsContainer || !resultsList) return;

  if (!trimmed) {
    resultsContainer.style.display = "none";
    resultsList.innerHTML = "";
    return;
  }

  const data = await fetchAllDataPreferApi();
  const allMovies = Object.entries(data.movies);
  const matches = allMovies.filter(([key, movie]) => {
    const title = (movie.title || "").toLowerCase();
    return title.includes(trimmed);
  });

  resultsList.innerHTML = "";

  if (matches.length === 0) {
    resultsContainer.style.display = "none";
    return;
  }

  matches.forEach(([movieKey, movie]) => {
    const item = document.createElement("div");
    item.className = "movie-list-item";
    item.dataset.movieKey = movieKey;
    item.addEventListener("click", () =>
      navigateToMoviePlayer(movie, movieKey)
    );

    const img = document.createElement("img");
    img.className = "movie-list-item-img";
    img.src = movie.posterUrl || "img/1.jpeg";
    img.alt = movie.title || "";

    const title = document.createElement("span");
    title.className = "movie-list-item-title";
    title.textContent = movie.title || "Untitled";

    const desc = document.createElement("p");
    desc.className = "movie-list-item-desc";
    desc.textContent =
      movie.overview || "No description available for this title yet.";

    const btn = document.createElement("button");
    btn.className = "movie-list-item-button";
    btn.textContent = "Watch";

    // Button inherits card click; no separate handler needed

    item.appendChild(img);
    item.appendChild(title);
    item.appendChild(desc);
    item.appendChild(btn);
    resultsList.appendChild(item);
  });

  resultsContainer.style.display = "block";
}

document.addEventListener("DOMContentLoaded", () => {
  renderDynamicLists().catch(console.error);

  // Render top banner slider (admin-managed)
  initBannerSlider();

  const searchInput = document.getElementById("search-input");
  const searchButton = document.getElementById("search-button");

  if (searchInput) {
    searchInput.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        performSearch(searchInput.value);
      }
    });
  }

  if (searchButton && searchInput) {
    searchButton.addEventListener("click", () => {
      performSearch(searchInput.value);
    });
  }
});

async function initBannerSlider() {
  const root = document.getElementById("banner-slider-root");
  if (!root) return;

  const data = await fetchAllDataPreferApi();
  const banners = Array.isArray(data.banners) ? data.banners : [];
  if (!banners.length) {
    root.style.display = "none";
    return;
  }

  root.style.display = "block";
  root.innerHTML = "";

  let currentIndex = 0;
  let timerId = null;

  const slideHost = document.createElement("div");
  slideHost.className = "banner-slide-host";
  root.appendChild(slideHost);

  const dotsHost = document.createElement("div");
  dotsHost.className = "banner-dots";
  root.appendChild(dotsHost);

  const controls = document.createElement("div");
  controls.className = "banner-controls";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "banner-control-btn";
  prevBtn.textContent = "‹";
  prevBtn.addEventListener("click", () => {
    stopTimer();
    goTo(currentIndex - 1);
    startTimer();
  });
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "banner-control-btn";
  nextBtn.textContent = "›";
  nextBtn.addEventListener("click", () => {
    stopTimer();
    goTo(currentIndex + 1);
    startTimer();
  });
  controls.appendChild(prevBtn);
  controls.appendChild(nextBtn);
  root.appendChild(controls);

  const buildSlide = (banner) => {
    const slide = document.createElement("div");
    slide.className = "banner-slide";

    const img = document.createElement("img");
    img.className = "banner-slide-img";
    img.src = banner.imageDataUrl || "";
    img.alt = banner.title || "Banner";
    slide.appendChild(img);

    const overlay = document.createElement("div");
    overlay.className = "banner-slide-overlay";

    const title = document.createElement("div");
    title.className = "banner-slide-title";
    title.textContent = banner.title || "";
    overlay.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "banner-slide-desc";
    desc.textContent = banner.description || "";
    overlay.appendChild(desc);

    slide.appendChild(overlay);
    slide.addEventListener("click", () => goToBannerTarget(banner));
    return slide;
  };

  const goTo = (idx) => {
    if (!banners.length) return;
    currentIndex = (idx + banners.length) % banners.length;
    slideHost.innerHTML = "";
    slideHost.appendChild(buildSlide(banners[currentIndex]));

    dotsHost.innerHTML = "";
    banners.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.className = "banner-dot" + (i === currentIndex ? " active" : "");
      dot.type = "button";
      dot.addEventListener("click", () => {
        stopTimer();
        goTo(i);
        startTimer();
      });
      dotsHost.appendChild(dot);
    });
  };

  const stopTimer = () => {
    if (timerId) clearInterval(timerId);
    timerId = null;
  };

  const startTimer = () => {
    stopTimer();
    timerId = setInterval(() => {
      goTo(currentIndex + 1);
    }, 5000);
  };

  goTo(0);
  startTimer();
}

async function goToBannerTarget(banner) {
  const data = await fetchAllDataPreferApi();
  const movies = data.movies || {};
  const tmdbId = String(banner.tmdbId || "");
  if (!tmdbId) return;

  // If content type is provided, jump directly to the matching movie key.
  if (banner.contentType) {
    const targetKey = `${banner.contentType}-${tmdbId}`;
    if (movies[targetKey]) {
      redirectToMoviePlayer(movies[targetKey], targetKey);
      return;
    }
  }

  // Fallback: find first match by tmdbId.
  let foundKey = null;
  let foundMovie = null;
  const keys = Object.keys(movies);
  for (const key of keys) {
    const m = movies[key];
    if (!m) continue;
    if (String(m.tmdbId) === tmdbId) {
      foundKey = key;
      foundMovie = m;
      break;
    }
  }

  if (foundKey && foundMovie) {
    redirectToMoviePlayer(foundMovie, foundKey);
  }
}

function redirectToMoviePlayer(movie, movieKey) {
  navigateToMoviePlayer(movie, movieKey);
}
