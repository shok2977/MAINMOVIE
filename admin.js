const ADMIN_ID = "Adityasharma123";
const ADMIN_PASSWORD = "Aditya@sharma2977";
const TMDB_API_KEY = "e84730516a1d5987f96fd63d46d2f119";

const API_BASE = "http://localhost:3001";
let cachedData = { movies: {}, lists: {}, banners: [], listOrder: [] };
const LOCAL_STORAGE_KEY = "flakes_movies_data";

async function refreshData() {
  const res = await fetch(`${API_BASE}/api/data`);
  if (!res.ok) throw new Error("Failed to load data from API");
  cachedData = await res.json();
  // Normalize shape
  cachedData.movies = cachedData.movies || {};
  cachedData.lists = cachedData.lists || {};
  cachedData.banners = cachedData.banners || [];
  cachedData.listOrder = Array.isArray(cachedData.listOrder)
    ? cachedData.listOrder
    : [];
  return cachedData;
}

function loadMovieData() {
  return cachedData;
}

/** Same as home page: these names are auto-generated for Random rows, not real DB lists. */
function isReservedRandomListName(name) {
  const t = String(name || "").trim();
  if (/^Random$/i.test(t)) return true;
  if (/^Random\s+\d+$/i.test(t)) return true;
  return false;
}

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

async function upsertMovie(movie) {
  const res = await fetch(`${API_BASE}/api/movie`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(movie),
  });
  if (!res.ok) throw new Error("Failed to upsert movie");
  return await res.json();
}

async function deleteMovie(key) {
  const res = await fetch(`${API_BASE}/api/movie/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete movie");
  return await res.json();
}

async function upsertList(name) {
  const res = await fetch(`${API_BASE}/api/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to upsert list");
  return await res.json();
}

async function assignMovieToList(name, key) {
  const res = await fetch(`${API_BASE}/api/list/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, key }),
  });
  if (!res.ok) throw new Error("Failed to assign movie to list");
  return await res.json();
}

async function reorderListsApi(order) {
  const res = await fetch(`${API_BASE}/api/lists/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
  if (!res.ok) throw new Error("Failed to save list order");
  return await res.json();
}

async function addBanner(payload) {
  const res = await fetch(`${API_BASE}/api/banner`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to add banner");
  return await res.json();
}

async function deleteBanner(id) {
  const res = await fetch(`${API_BASE}/api/banner/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete banner");
  return await res.json();
}

async function maybeMigrateLocalToApi() {
  // Only migrate when API is empty, so we don't duplicate data.
  const apiMoviesCount = Object.keys(cachedData.movies || {}).length;
  if (apiMoviesCount > 0) return;

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const localMovies = parsed.movies || {};
    const localLists = parsed.lists || {};
    const localBanners = Array.isArray(parsed.banners) ? parsed.banners : [];

    const movieKeys = Object.keys(localMovies);
    for (const k of movieKeys) {
      const m = localMovies[k];
      if (m && m.key) {
        await upsertMovie(m);
      }
    }

    const listNames = Object.keys(localLists);
    for (const name of listNames) {
      await upsertList(name);
      const keys = Array.isArray(localLists[name]) ? localLists[name] : [];
      for (const key of keys) {
        await assignMovieToList(name, key);
      }
    }

    for (const b of localBanners) {
      await addBanner({
        title: b.title || "",
        description: b.description || "",
        tmdbId: String(b.tmdbId || ""),
        contentType: b.contentType || "movie",
        imageDataUrl: b.imageDataUrl || "",
        createdAt: b.createdAt || Date.now(),
      });
    }

    await refreshData();
  } catch (e) {
    console.error("Local-to-API migration failed", e);
  }
}

function getMovieIdKey(tmdbId, type) {
  return `${type}-${tmdbId}`;
}

async function ensureDefaultListsInApi() {
  const defaults = ["Anime", "New Releases", "Hidden Gems", "Best", "Top 10"];
  const data = loadMovieData();
  await Promise.all(
    defaults.map(async (name) => {
      if (!data.lists || !data.lists[name]) {
        await upsertList(name);
      }
    })
  );
  await refreshData();
}

function setAuth(state) {
  if (state) sessionStorage.setItem("flakes_admin_auth", "1");
  else sessionStorage.removeItem("flakes_admin_auth");
}

function isAuthed() {
  return sessionStorage.getItem("flakes_admin_auth") === "1";
}

function switchSection(targetId) {
  document.querySelectorAll(".admin-section").forEach((s) => {
    s.classList.toggle("admin-section-active", s.id === targetId);
  });
  document.querySelectorAll(".admin-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-section") === targetId);
  });
}

function renderDashboard() {
  const data = loadMovieData();
  const totalTitlesEl = document.getElementById("stat-total-titles");
  const totalListsEl = document.getElementById("stat-total-lists");
  const recentListEl = document.getElementById("admin-recent-list");

  const movieKeys = Object.keys(data.movies);
  const listNames = Object.keys(data.lists).filter(
    (n) => !isReservedRandomListName(n)
  );

  if (totalTitlesEl) totalTitlesEl.textContent = movieKeys.length;
  if (totalListsEl) totalListsEl.textContent = listNames.length;

  if (!recentListEl) return;
  recentListEl.innerHTML = "";

  if (movieKeys.length === 0) {
    recentListEl.innerHTML =
      '<p class="admin-empty">No titles added yet. Add your first movie, anime or TV show.</p>';
    return;
  }

  const table = document.createElement("div");
  table.className = "admin-table-inner";
  const header = document.createElement("div");
  header.className = "admin-table-row admin-table-header";
  header.innerHTML = `
    <div>Title</div>
    <div>Type</div>
    <div>TMDB ID</div>
    <div>Seasons/Episodes</div>
    <div></div>
  `;
  table.appendChild(header);

  const recentKeys = movieKeys.slice(-10).reverse();
  recentKeys.forEach((key) => {
    const m = data.movies[key];
    let epInfo = "-";
    if ((m.type === "tv" || m.type === "anime") && m.seasons && m.seasons.length) {
      const total = m.seasons.reduce((s, x) => s + (x.episodes ? x.episodes.length : 0), 0);
      epInfo = `${m.seasons.length} S · ${total} E`;
    }
    const row = document.createElement("div");
    row.className = "admin-table-row";
    row.innerHTML = `
      <div>${m.title || "Untitled"}</div>
      <div>${m.type || "-"}</div>
      <div>${m.tmdbId || "-"}</div>
      <div>${epInfo}</div>
      <div>
        <button class="admin-secondary-btn admin-edit-btn" data-key="${key}">Edit</button>
        <button class="admin-delete-btn" data-key="${key}">Delete</button>
      </div>
    `;
    table.appendChild(row);
  });
  recentListEl.appendChild(table);
}

let currentEditMovieKey = null;
let currentDownloadEpisodesSeasons = null;
let currentDownloadEpisodesTmdb = null;

function episodeKey(seasonNumber, episodeNumber) {
  return `s${seasonNumber}_e${episodeNumber}`;
}

function buildLanguageRow(lang, options = {}) {
  const { showScript = true, langIndex, includeEpisodesPlaceholder = false } = options;
  const row = document.createElement("div");
  row.className = "admin-language-row";
  if (langIndex !== undefined && langIndex !== null) {
    row.dataset.langIndex = String(langIndex);
  }
  const safeName = lang?.name
    ? String(lang.name).replace(/"/g, "&quot;")
    : "";
  const scriptHtml = showScript
    ? `
      <textarea
        class="admin-input edit-lang-script"
        placeholder="Paste Fluid Player embed script for this language"
        rows="4"
      ></textarea>
    `
    : "";

  const episodesPlaceholderHtml = includeEpisodesPlaceholder
    ? `<div class="admin-language-episodes" data-lang-episodes="1"></div>`
    : "";

  row.innerHTML = `
    <div class="admin-language-fields">
      <input
        type="text"
        class="admin-input edit-lang-name"
        placeholder="Language name (e.g. Hindi)"
        value="${safeName}"
      />
      ${scriptHtml}
      ${episodesPlaceholderHtml}
    </div>
    <div class="admin-language-actions">
      <button type="button" class="admin-delete-btn edit-lang-remove">Remove</button>
    </div>
  `;

  if (showScript) {
    const textarea = row.querySelector(".edit-lang-script");
    if (textarea) textarea.value = lang?.script || "";
  }
  return row;
}

function openEditMovie(key) {
  const data = loadMovieData();
  const movie = data.movies[key];
  if (!movie) return;

  currentEditMovieKey = key;

  const titleEl = document.getElementById("edit-movie-title");
  const listEl = document.getElementById("edit-movie-languages");
  const editLangAddBtnEl = document.getElementById("edit-movie-add-language");
  // Treat as series (show per-episode Fluid code fields) if seasons exist.
  const isDownloadSeries =
    Array.isArray(movie.seasons) && movie.seasons.length;

  if (titleEl) {
    titleEl.textContent = movie.title || "Untitled";
  }
  if (listEl) {
    listEl.style.display = "";
    if (editLangAddBtnEl) editLangAddBtnEl.style.display = "";
    listEl.innerHTML = "";
    const langs = Array.isArray(movie.languages) ? movie.languages : [];
    if (!langs.length) {
      if (isDownloadSeries) {
        // Series downloads always need at least "Original" language.
        listEl.appendChild(
          buildLanguageRow(
            { name: "Original" },
            { showScript: false, langIndex: 0, includeEpisodesPlaceholder: true }
          )
        );
      } else {
        const info = document.createElement("p");
        info.className = "admin-help-text";
        info.textContent =
          'No extra languages yet. Click "Add language" to create one.';
        listEl.appendChild(info);
      }
    } else {
      langs.forEach((lang, langIndex) => {
        listEl.appendChild(
          buildLanguageRow(lang, {
            showScript: !isDownloadSeries,
            langIndex,
            includeEpisodesPlaceholder: isDownloadSeries,
          })
        );
      });
    }
  }

  // Render per-episode Fluid codes for downloads TV/Anime
  const episodesTitle = document.getElementById("edit-episodes-title");
  const episodesHelp = document.getElementById("edit-episodes-help");
  const episodesContainer = document.getElementById("edit-download-episodes");
  if (episodesTitle && episodesHelp && episodesContainer) {
    if (isDownloadSeries) {
      // For series downloads: hide the shared episodes section and render episodes under each language row.
      episodesTitle.style.display = "none";
      episodesHelp.style.display = "none";
      episodesContainer.style.display = "none";
      episodesContainer.innerHTML = "";

      rebuildDownloadEpisodesInputs(movie);
    } else {
      episodesTitle.style.display = "none";
      episodesHelp.style.display = "none";
      episodesContainer.innerHTML = "";
      episodesContainer.style.display = "none";
    }
  }

  switchSection("dashboard-section"); // ensure valid sections exist
  switchSection("edit-movie-section");
}

function renderLists() {
  const data = loadMovieData();
  const listsTable = document.getElementById("lists-table");
  const assignListSelect = document.getElementById("assign-list");
  if (!listsTable || !assignListSelect) return;

  listsTable.innerHTML = "";
  assignListSelect.innerHTML = "";

  const note = document.createElement("p");
  note.className = "admin-help-text";
  note.style.marginBottom = "12px";
  note.textContent =
    'Home page par "Random" / "Random 2" … hamesha sabse niche dikhti hain — saari titles wahan (10 per row, shuffle). Neeche se number set karein: 1 = sabse upar wali list (Random ke upar).';
  listsTable.appendChild(note);

  const listNames = getOrderedCustomListNames(data);
  if (listNames.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "No custom lists yet. Create some above.";
    listsTable.appendChild(empty);
    return;
  }

  const table = document.createElement("div");
  table.className = "admin-table-inner admin-lists-order-table";
  const header = document.createElement("div");
  header.className = "admin-table-row admin-table-header";
  header.innerHTML = `<div>Position #</div><div>List name</div><div>Titles</div>`;
  table.appendChild(header);

  listNames.forEach((name, idx) => {
    const count = (data.lists[name] || []).length;
    const row = document.createElement("div");
    row.className = "admin-table-row";

    const posCell = document.createElement("div");
    const posInput = document.createElement("input");
    posInput.type = "number";
    posInput.min = "1";
    posInput.max = "999";
    posInput.className = "admin-input admin-list-order-input";
    posInput.dataset.listName = name;
    posInput.value = String(idx + 1);
    posInput.title = "Home page order (1 = top, under banner)";
    posCell.appendChild(posInput);

    const nameCell = document.createElement("div");
    nameCell.textContent = name;

    const countCell = document.createElement("div");
    countCell.textContent = String(count);

    row.appendChild(posCell);
    row.appendChild(nameCell);
    row.appendChild(countCell);
    table.appendChild(row);

    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    assignListSelect.appendChild(opt);
  });
  listsTable.appendChild(table);

  const saveOrderBtn = document.createElement("button");
  saveOrderBtn.type = "button";
  saveOrderBtn.className = "admin-primary-btn";
  saveOrderBtn.style.marginTop = "14px";
  saveOrderBtn.textContent = "Save list positions (1, 2, 3…)";
  saveOrderBtn.addEventListener("click", async () => {
    const inputs = listsTable.querySelectorAll(".admin-list-order-input");
    const pairs = [];
    inputs.forEach((inp) => {
      const n = inp.dataset.listName;
      let pos = parseInt(inp.value, 10);
      if (!Number.isFinite(pos) || pos < 1) pos = 999;
      pairs.push({ name: n, pos });
    });
    pairs.sort(
      (a, b) => a.pos - b.pos || String(a.name).localeCompare(String(b.name))
    );
    const order = pairs.map((p) => p.name);
    try {
      await reorderListsApi(order);
      await refreshData();
      renderLists();
      alert("List order save ho gaya.");
    } catch (e) {
      console.error(e);
      alert("Order save nahi ho saka. Server chal raha hai?");
    }
  });
  listsTable.appendChild(saveOrderBtn);
}

function renderBanners() {
  const data = loadMovieData();
  const bannersListEl = document.getElementById("banners-list");
  if (!bannersListEl) return;

  const banners = Array.isArray(data.banners) ? data.banners : [];
  bannersListEl.innerHTML = "";

  if (!banners.length) {
    bannersListEl.innerHTML =
      '<p class="admin-empty">No banners added yet. Add your first banner above.</p>';
    return;
  }

  banners.forEach((b) => {
    const row = document.createElement("div");
    row.className = "admin-table-row";
    row.style.alignItems = "center";

    const imgCell = document.createElement("div");
    imgCell.style.display = "flex";
    imgCell.style.gap = "10px";
    imgCell.style.alignItems = "center";

    const img = document.createElement("img");
    img.src = b.imageDataUrl || "";
    img.alt = b.title || "Banner";
    img.style.width = "120px";
    img.style.height = "60px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "8px";

    const meta = document.createElement("div");
    meta.innerHTML = `
      <div style="font-weight: 700;">${b.title || ""}</div>
      <div style="color: #b3b3b3; font-size: 12px; margin-top: 2px;">
        ${b.contentType || ""} · TMDB ${b.tmdbId || ""}
      </div>
    `;
    imgCell.appendChild(img);
    imgCell.appendChild(meta);

    const descCell = document.createElement("div");
    descCell.style.fontSize = "12px";
    descCell.style.color = "#dcdcdc";
    descCell.textContent = (b.description || "").slice(0, 80);

    const actionCell = document.createElement("div");
    actionCell.style.display = "flex";
    actionCell.style.justifyContent = "flex-end";

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "admin-delete-btn";
    delBtn.textContent = "Delete";
    delBtn.dataset.bannerId = b.id || b._id;
    actionCell.appendChild(delBtn);

    row.appendChild(imgCell);
    row.appendChild(descCell);
    row.appendChild(document.createElement("div"));
    row.appendChild(document.createElement("div"));
    row.appendChild(actionCell);

    bannersListEl.appendChild(row);
  });
}

async function fetchTmdbDetails(tmdbId, type) {
  const base = "https://api.themoviedb.org/3";
  const path =
    type === "movie" || type === "animeMovie"
      ? `/movie/${tmdbId}`
      : `/tv/${tmdbId}`;
  const url = `${base}${path}?api_key=${TMDB_API_KEY}&language=en-US`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB request failed (status ${res.status})`);
  const data = await res.json();
  return {
    title: data.title || data.name || "",
    overview: data.overview || "",
    posterUrl: data.poster_path
      ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
      : "",
  };
}

async function fetchTmdbTvSeasons(tmdbId) {
  const base = "https://api.themoviedb.org/3";
  const tvRes = await fetch(
    `${base}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`
  );
  if (!tvRes.ok) return [];
  const tv = await tvRes.json();
  const numSeasons = Math.min(tv.number_of_seasons || 0, 20);
  const seasons = [];

  for (let s = 1; s <= numSeasons; s++) {
    try {
      const seasonRes = await fetch(
        `${base}/tv/${tmdbId}/season/${s}?api_key=${TMDB_API_KEY}&language=en-US`
      );
      if (!seasonRes.ok) continue;
      const seasonData = await seasonRes.json();
      const episodes = (seasonData.episodes || []).map((ep) => ({
        episode_number: ep.episode_number,
        name: ep.name || `Episode ${ep.episode_number}`,
      }));
      seasons.push({ season_number: s, episodes });
    } catch (_) {}
  }
  return seasons;
}

document.addEventListener("DOMContentLoaded", async () => {
  const loginCard = document.getElementById("admin-login-card");
  const panel = document.getElementById("admin-panel");
  const loginForm = document.getElementById("admin-login-form");
  const loginError = document.getElementById("admin-login-error");
  const logoutBtn = document.getElementById("admin-logout-btn");
  const createListForm = document.getElementById("create-list-form");
  const addTitleForm = document.getElementById("add-title-form");
  const addTitleError = document.getElementById("add-title-error");
  const addTitleSuccess = document.getElementById("add-title-success");
  const sourceKindSelect = document.getElementById("source-kind");
  const downloadFields = document.getElementById("download-fields");
  const downloadMovieOnlyFields = document.getElementById(
    "download-movie-only-fields"
  );
  const contentTypeSelect = document.getElementById("content-type");
  const tmdbInput = document.getElementById("tmdb-id");
  const editLangAddBtn = document.getElementById("edit-movie-add-language");
  const editLangSaveBtn = document.getElementById("edit-movie-save");
  const editLangCancelBtn = document.getElementById("edit-movie-cancel");

  if (isAuthed()) {
    if (loginCard) loginCard.style.display = "none";
    if (panel) panel.style.display = "flex";
    await refreshData();
    await maybeMigrateLocalToApi();
    await ensureDefaultListsInApi();
    renderDashboard();
    renderLists();
    renderBanners();
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = (document.getElementById("admin-username")?.value || "").trim();
      const pass = document.getElementById("admin-password")?.value || "";
      if (id === ADMIN_ID && pass === ADMIN_PASSWORD) {
        setAuth(true);
        if (loginError) loginError.textContent = "";
        if (loginCard) loginCard.style.display = "none";
        if (panel) panel.style.display = "flex";
        await refreshData();
      await maybeMigrateLocalToApi();
        await ensureDefaultListsInApi();
        renderDashboard();
        renderLists();
        renderBanners();
      } else if (loginError) {
        loginError.textContent = "Invalid ID or password.";
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      setAuth(false);
      window.location.reload();
    });
  }

  document.querySelectorAll(".admin-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-section");
      if (t) switchSection(t);
    });
  });

  if (createListForm) {
    createListForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("new-list-name");
      const name = input?.value?.trim();
      if (!name) return;
      if (isReservedRandomListName(name)) {
        alert(
          'Yeh naam reserved hai. "Random" lists home page par automatic banti hain — koi aur naam use karein.'
        );
        return;
      }
      await upsertList(name);
      if (input) input.value = "";
      await refreshData();
      renderLists();
    });
  }

  // Add Banner (drag & drop upload)
  const bannerForm = document.getElementById("add-banner-form");
  const bannerDropzone = document.getElementById("banner-dropzone");
  const bannerFileInput = document.getElementById("banner-image-file");
  const bannerPreviewWrap = document.getElementById(
    "banner-image-preview-wrap"
  );
  const bannerPreviewImg = document.getElementById("banner-image-preview");
  const bannerTitleInput = document.getElementById("banner-title");
  const bannerDescInput = document.getElementById("banner-description");
  const bannerTmdbInput = document.getElementById("banner-tmdb-id");
  const bannerContentTypeSelect = document.getElementById(
    "banner-content-type"
  );
  const bannerErrorEl = document.getElementById("add-banner-error");
  const bannersListEl = document.getElementById("banners-list");

  let currentBannerImageDataUrl = "";

  const readFileAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });

  async function setBannerFile(file) {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    currentBannerImageDataUrl = String(dataUrl || "");
    if (bannerPreviewImg) bannerPreviewImg.src = currentBannerImageDataUrl;
    if (bannerPreviewWrap) bannerPreviewWrap.style.display = "block";
  }

  if (bannerDropzone && bannerFileInput) {
    bannerDropzone.addEventListener("click", () => bannerFileInput.click());
    bannerDropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      bannerDropzone.style.borderColor = "#4dbf00";
    });
    bannerDropzone.addEventListener("dragleave", () => {
      bannerDropzone.style.borderColor = "";
    });
    bannerDropzone.addEventListener("drop", async (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        await setBannerFile(file);
      } catch (err) {
        console.error(err);
        if (bannerErrorEl)
          bannerErrorEl.textContent = "Failed to read image file.";
      }
    });
  }

  if (bannerFileInput) {
    bannerFileInput.addEventListener("change", async () => {
      const file = bannerFileInput.files?.[0];
      if (!file) return;
      try {
        await setBannerFile(file);
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (bannerForm) {
    bannerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (bannerErrorEl) bannerErrorEl.textContent = "";

      const title = bannerTitleInput?.value?.trim();
      const description = bannerDescInput?.value?.trim();
      const tmdbIdRaw = bannerTmdbInput?.value;
      const tmdbId = tmdbIdRaw !== undefined && tmdbIdRaw !== null ? String(tmdbIdRaw).trim() : "";
      const contentType = bannerContentTypeSelect?.value;

      if (!currentBannerImageDataUrl) {
        if (bannerErrorEl) bannerErrorEl.textContent = "Please upload a banner image.";
        return;
      }
      if (!title) {
        if (bannerErrorEl) bannerErrorEl.textContent = "Banner title is required.";
        return;
      }
      if (!tmdbId) {
        if (bannerErrorEl) bannerErrorEl.textContent = "TMDB ID is required.";
        return;
      }
      if (!contentType) {
        if (bannerErrorEl) bannerErrorEl.textContent = "Content type is required.";
        return;
      }

      await addBanner({
        title,
        description: description || "",
        tmdbId,
        contentType,
        imageDataUrl: currentBannerImageDataUrl,
        createdAt: Date.now(),
      });
      await refreshData();
      renderBanners();

      // Reset form (keep image in case admin wants to add many quickly)
      if (bannerTitleInput) bannerTitleInput.value = "";
      if (bannerDescInput) bannerDescInput.value = "";
      if (bannerTmdbInput) bannerTmdbInput.value = "";
      if (bannerContentTypeSelect) bannerContentTypeSelect.value = "movie";
    });
  }

  if (bannersListEl) {
    bannersListEl.addEventListener("click", async (e) => {
      const target = e.target;
      if (!target) return;
      if (target.classList?.contains("admin-delete-btn")) {
        const bannerId = target.dataset.bannerId;
        if (!bannerId) return;
        await deleteBanner(bannerId);
        await refreshData();
        renderBanners();
      }
    });
  }

  const recentListEl = document.getElementById("admin-recent-list");
  if (recentListEl) {
    recentListEl.addEventListener("click", async (e) => {
      const target = e.target;
      if (!target) return;
      const btn = target.closest ? target.closest("button") : null;
      const key = btn ? btn.getAttribute("data-key") : null;

      if (btn && btn.classList?.contains("admin-delete-btn")) {
        const key = btn.getAttribute("data-key");
        if (!key) return;
        await deleteMovie(key);
        await refreshData();
        renderDashboard();
        renderLists();
      } else if (btn && btn.classList?.contains("admin-edit-btn")) {
        if (!key) return;
        try {
          openEditMovie(key);
        } catch (err) {
          console.error("Failed to open edit panel for key:", key, err);
        }
      }
    });
  }

  if (addTitleForm) {
    addTitleForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      addTitleError.textContent = "";
      addTitleSuccess.textContent = "";

      const tmdbId = (document.getElementById("tmdb-id")?.value || "").trim();
      const type = document.getElementById("content-type")?.value || "movie";
      const listName = document.getElementById("assign-list")?.value || "";
      const sourceKind =
        document.getElementById("source-kind")?.value || "vidsrc";
      const downloadScript =
        document.getElementById("download-fluid-script")?.value || "";

      if (!tmdbId || !listName) {
        addTitleError.textContent = "TMDB ID and list are required.";
        return;
      }
      if (
        sourceKind === "download" &&
        (type === "movie" || type === "animeMovie") &&
        !downloadScript.trim()
      ) {
        addTitleError.textContent =
          "For downloads, Fluid Player code is required for movies.";
        return;
      }

      let meta;
      let seasons = [];
      try {
        meta = await fetchTmdbDetails(tmdbId, type);
        if (type === "tv" || type === "anime") {
          seasons = await fetchTmdbTvSeasons(tmdbId);
        }
      } catch (err) {
        console.error(err);
        addTitleError.textContent = err?.message || "Failed to load TMDB data.";
        meta = { title: "", overview: "", posterUrl: "" };
      }

      const key = getMovieIdKey(tmdbId, type);

      const movieRecord = {
        key,
        tmdbId,
        type,
        title: meta.title,
        overview: meta.overview,
        posterUrl: meta.posterUrl,
        seasons: seasons.length ? seasons : null,
        sourceKind,
        createdAt: Date.now(),
      };

      if (sourceKind === "download") {
        if (type === "tv" || type === "anime") {
          // Per-episode codes from UI
          const epContainer = document.getElementById(
            "download-episodes-container"
          );
          const epMap = {};
          if (epContainer) {
            const rows = Array.from(
              epContainer.querySelectorAll(".admin-episode-row")
            );
            rows.forEach((row) => {
              const keyAttr = row.dataset.epKey;
              const ta = row.querySelector(".download-episode-script");
              const code = ta?.value?.trim();
              if (keyAttr && code) {
                epMap[keyAttr] = { script: code };
              }
            });
          }
          // For TV/Anime downloads we support multiple languages later in Edit.
          // During Add we treat this as "Original" (langIndex = 0).
          movieRecord.languages = [{ name: "Original" }];
          movieRecord.downloadEpisodesByLang = { "0": epMap };
          // Backward compatibility
          movieRecord.downloadEpisodes = epMap;
        } else {
          // Movie / Anime movie: single Fluid code via languages
          movieRecord.languages = [
            {
              name: "Original",
              script: downloadScript.trim(),
            },
          ];
        }
      }

      // Save to MongoDB (via API)
      await upsertList(listName);
      await upsertMovie(movieRecord);
      await assignMovieToList(listName, key);
      await refreshData();
      renderDashboard();
      renderLists();

      const tmdbInput = document.getElementById("tmdb-id");
      if (tmdbInput) tmdbInput.value = "";
      const scriptInput = document.getElementById("download-fluid-script");
      if (scriptInput) scriptInput.value = "";
      addTitleSuccess.textContent = "Title saved successfully.";
    });
  }

  function rebuildDownloadEpisodesInputs(movie, onlyLangIndex = null) {
    const listEl = document.getElementById("edit-movie-languages");
    if (!listEl) return;

    // Preserve current values before rebuilding
    const preserved = {};
    const existingEpisodeRows = Array.from(
      listEl.querySelectorAll(".admin-episode-row")
    );
    existingEpisodeRows.forEach((row) => {
      const langIndex = row.dataset.langIndex;
      const epKey = row.dataset.epKey;
      const ta = row.querySelector(".edit-episode-script");
      const code = ta?.value?.trim();
      if (!langIndex || !epKey) return;
      if (!preserved[langIndex]) preserved[langIndex] = {};
      if (code) preserved[langIndex][epKey] = { script: code };
    });

    const downloadEpisodesByLang =
      movie.downloadEpisodesByLang &&
      Object.keys(movie.downloadEpisodesByLang).length
        ? movie.downloadEpisodesByLang
        : movie.downloadEpisodes
          ? { "0": movie.downloadEpisodes }
          : {};

    // Render episodes under each language row (directly below language)
    const languageRows = Array.from(listEl.querySelectorAll(".admin-language-row"));
    languageRows.forEach((langRow, idx) => {
      langRow.dataset.langIndex = String(idx);
      const langIndex = String(idx);

      if (onlyLangIndex !== null && String(langIndex) !== String(onlyLangIndex)) {
        return;
      }

      const episodesWrapper = langRow.querySelector(".admin-language-episodes");
      if (!episodesWrapper) return;
      episodesWrapper.innerHTML = "";

      const frag = document.createDocumentFragment();

      (movie.seasons || []).forEach((s) => {
        const seasonHeader = document.createElement("h4");
        seasonHeader.textContent = `Season ${s.season_number}`;
        frag.appendChild(seasonHeader);

        (s.episodes || []).forEach((ep) => {
          const key = episodeKey(s.season_number, ep.episode_number);
          const row = document.createElement("div");
          row.className = "admin-episode-row";
          row.dataset.epKey = key;
          row.dataset.langIndex = langIndex;

          const existingForLang = downloadEpisodesByLang[langIndex] || {};
          const preservedScript =
            preserved[langIndex]?.[key]?.script || "";
          const baseScript =
            existingForLang[key]?.script || existingForLang[key] || "";
          const existingScript = preservedScript || baseScript;

          row.innerHTML = `
            <label class="admin-label admin-episode-label">S${s.season_number} · E${ep.episode_number} - ${
              ep.name || ""
            }</label>
            <textarea
              class="admin-input admin-episode-input edit-episode-script"
              rows="3"
              placeholder="Fluid Player code for this episode (optional)"
            >${existingScript}</textarea>
          `;
          frag.appendChild(row);
        });
      });

      episodesWrapper.appendChild(frag);
    });
  }

  if (editLangAddBtn) {
    editLangAddBtn.addEventListener("click", () => {
      if (!currentEditMovieKey) return;
      const data = loadMovieData();
      const movie = data.movies[currentEditMovieKey];
      if (!movie) return;

      const isDownloadSeries =
        Array.isArray(movie.seasons) &&
        movie.seasons.length &&
        (movie.downloadEpisodesByLang ||
          (movie.downloadEpisodes !== undefined &&
            movie.downloadEpisodes !== null));

      const listEl = document.getElementById("edit-movie-languages");
      if (!listEl) return;
      // Remove placeholder help text if present
      listEl.querySelectorAll(".admin-help-text").forEach((n) => n.remove());
      const newLangIndex = listEl.querySelectorAll(".admin-language-row").length;
      listEl.appendChild(
        buildLanguageRow(
          { name: "", script: "" },
          {
            showScript: !isDownloadSeries,
            langIndex: newLangIndex,
            includeEpisodesPlaceholder: isDownloadSeries,
          }
        )
      );

      if (isDownloadSeries) {
        rebuildDownloadEpisodesInputs(movie, String(newLangIndex));
      }
    });
  }

  if (editLangSaveBtn) {
    editLangSaveBtn.addEventListener("click", async () => {
      if (!currentEditMovieKey) return;
      const data = loadMovieData();
      const movie = data.movies[currentEditMovieKey];
      if (!movie) return;

      const isDownloadSeries =
        Array.isArray(movie.seasons) && movie.seasons.length;

      const listEl = document.getElementById("edit-movie-languages");
      if (!listEl) return;

      const languageRows = Array.from(
        listEl.querySelectorAll(".admin-language-row")
      );
      const languages = [];
      languageRows.forEach((row, idx) => {
        const nameInput = row.querySelector(".edit-lang-name");
        const scriptInput = row.querySelector(".edit-lang-script");
        const name =
          nameInput?.value?.trim() || `Language ${idx + 1}`;
        const script = scriptInput?.value?.trim() || "";
        languages.push(isDownloadSeries ? { name } : { name, script });
      });
      movie.languages = languages;

      // Save per-episode Fluid codes for downloads TV/Anime (per language)
      if (isDownloadSeries) {
        const downloadEpisodesByLang = {};
        const rowsEp = Array.from(
          listEl.querySelectorAll(".admin-episode-row")
        );
        rowsEp.forEach((row) => {
          const langIndex = row.dataset.langIndex;
          const keyAttr = row.dataset.epKey;
          const ta = row.querySelector(".edit-episode-script");
          const code = ta?.value?.trim();
          if (!langIndex || !keyAttr || !code) return;
          if (!downloadEpisodesByLang[langIndex]) {
            downloadEpisodesByLang[langIndex] = {};
          }
          downloadEpisodesByLang[langIndex][keyAttr] = { script: code };
        });

        movie.downloadEpisodesByLang = downloadEpisodesByLang;

        // Backward compatibility: keep old single-language format for lang 0
        if (downloadEpisodesByLang["0"]) {
          movie.downloadEpisodes = downloadEpisodesByLang["0"];
        } else {
          movie.downloadEpisodes = {};
        }
      }

      await upsertMovie(movie);
      await refreshData();
      renderDashboard();
      renderLists();
      currentEditMovieKey = null;
      switchSection("dashboard-section");
    });
  }

  if (editLangCancelBtn) {
    editLangCancelBtn.addEventListener("click", () => {
      currentEditMovieKey = null;
      switchSection("dashboard-section");
    });
  }

  const editLangContainer = document.getElementById("edit-movie-languages");
  if (editLangContainer) {
    editLangContainer.addEventListener("click", (e) => {
      const target = e.target;
      if (target?.classList?.contains("edit-lang-remove")) {
        if (!currentEditMovieKey) return;
        const data = loadMovieData();
        const movie = data.movies[currentEditMovieKey];

        const row = target.closest(".admin-language-row");
        if (row) row.remove();

        const isDownloadSeries =
          movie &&
          Array.isArray(movie.seasons) &&
          movie.seasons.length &&
          (movie.downloadEpisodesByLang ||
            (movie.downloadEpisodes !== undefined &&
              movie.downloadEpisodes !== null));
        if (isDownloadSeries) {
          rebuildDownloadEpisodesInputs(movie);
        }
      }
    });
  }

  if (sourceKindSelect && downloadFields) {
    const updateDownloadVisibility = () => {
      const sourceVal = sourceKindSelect.value;
      const typeVal = contentTypeSelect?.value || "movie";
      // Show/hide overall download block based on source
      downloadFields.style.display = sourceVal === "download" ? "block" : "none";

      if (downloadMovieOnlyFields) {
        // If type is TV/Anime, permanently remove the big box so it can never show for series.
        if (typeVal === "tv" || typeVal === "anime") {
          downloadMovieOnlyFields.remove();
        } else {
          // Movie / anime movie: show big box only when downloads is selected
          downloadMovieOnlyFields.style.display =
            sourceVal === "download" ? "block" : "none";
        }
      }
    };
    sourceKindSelect.addEventListener("change", () => {
      updateDownloadVisibility();
    });
    if (contentTypeSelect) {
      contentTypeSelect.addEventListener("change", () => {
        updateDownloadVisibility();
      });
    }
    updateDownloadVisibility();
  }

  async function maybeLoadDownloadEpisodes() {
    if (!sourceKindSelect || !downloadFields) return;
    const sourceVal = sourceKindSelect.value;
    const tmdbVal = tmdbInput?.value?.trim();
    const epContainer = document.getElementById("download-episodes-container");
    if (
      sourceVal !== "download" ||
      !tmdbVal ||
      !epContainer
    ) {
      if (epContainer) epContainer.innerHTML = "";
      return;
    }

    // Avoid refetch if same TMDB id
    if (
      currentDownloadEpisodesTmdb === tmdbVal &&
      Array.isArray(currentDownloadEpisodesSeasons) &&
      currentDownloadEpisodesSeasons.length
    ) {
      // Already rendered once; don't rebuild here
      return;
    }

    try {
      const seasons = await fetchTmdbTvSeasons(tmdbVal);
      currentDownloadEpisodesTmdb = tmdbVal;
      currentDownloadEpisodesSeasons = seasons;
      epContainer.innerHTML = "";

      if (Array.isArray(seasons) && seasons.length > 0) {
        // This TMDB id clearly has seasons/episodes => treat as series.
        // Remove big movie-only Fluid field so only per-episode fields remain.
        if (downloadMovieOnlyFields) {
          downloadMovieOnlyFields.remove();
        }
        seasons.forEach((s) => {
          const seasonHeader = document.createElement("h4");
          seasonHeader.textContent = `Season ${s.season_number}`;
          epContainer.appendChild(seasonHeader);
          (s.episodes || []).forEach((ep) => {
            const key = episodeKey(s.season_number, ep.episode_number);
            const row = document.createElement("div");
            row.className = "admin-episode-row";
            row.dataset.epKey = key;
            row.innerHTML = `
              <label class="admin-label admin-episode-label">S${s.season_number} · E${ep.episode_number} - ${
              ep.name || ""
            }</label>
              <textarea class="admin-input admin-episode-input download-episode-script" rows="3"
                placeholder="Fluid Player code for this episode (optional)"></textarea>
            `;
            epContainer.appendChild(row);
          });
        });
      } else {
        // No seasons => treat as movie, clear episode list and show big movie field.
        epContainer.innerHTML = "";
        if (downloadMovieOnlyFields && sourceVal === "download") {
          downloadMovieOnlyFields.style.display = "block";
        }
      }
    } catch (_) {
      // ignore UI errors
    }
  }

  if (sourceKindSelect) {
    sourceKindSelect.addEventListener("change", () => {
      maybeLoadDownloadEpisodes();
    });
  }
  if (contentTypeSelect) {
    contentTypeSelect.addEventListener("change", () => {
      currentDownloadEpisodesTmdb = null;
      currentDownloadEpisodesSeasons = null;
      maybeLoadDownloadEpisodes();
    });
  }
  if (tmdbInput) {
    tmdbInput.addEventListener("blur", () => {
      currentDownloadEpisodesTmdb = null;
      currentDownloadEpisodesSeasons = null;
      maybeLoadDownloadEpisodes();
    });
  }
});
