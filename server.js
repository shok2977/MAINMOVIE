import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dns from "dns";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Serve the front-end files from the same folder as server.js
app.use(express.static(__dirname));

// WARNING: rotate this password in Atlas, never keep real creds in code for production.
const MONGO_URI =
  "mongodb+srv://Aditya:Aditya@cap.nwkww.mongodb.net/cap?retryWrites=true&w=majority";

// Some networks (or Node DNS) may fail SRV lookups unless we force the resolver.
// In your machine this matches nslookup's DNS server (127.0.2.2).
dns.setServers(["127.0.2.2"]);

await mongoose.connect(MONGO_URI);

const movieSchema = new mongoose.Schema({
  key: String,
  tmdbId: String,
  type: String,
  title: String,
  overview: String,
  posterUrl: String,
  seasons: Array,
  sourceKind: String,
  languages: Array,
  downloadEpisodes: Object,
  downloadEpisodesByLang: Object,
  createdAt: Number,
});

const listSchema = new mongoose.Schema({
  name: String,
  movieKeys: [String],
  sortOrder: { type: Number, default: 0 },
});

const bannerSchema = new mongoose.Schema({
  title: String,
  description: String,
  tmdbId: String,
  contentType: String,
  imageDataUrl: String,
  createdAt: Number,
});

const Movie = mongoose.model("Movie", movieSchema);
const List = mongoose.model("List", listSchema);
const Banner = mongoose.model("Banner", bannerSchema);

// ---- API ----

// All data for front-end (movies by key, lists by name, banners array)
app.get("/api/data", async (req, res) => {
  const [movies, listsFromDb, banners] = await Promise.all([
    Movie.find().lean(),
    List.find().lean(),
    Banner.find().lean(),
  ]);

  let lists = listsFromDb;

  const moviesByKey = {};
  movies.forEach((m) => {
    moviesByKey[m.key] = m;
  });

  const listsByName = {};
  lists.forEach((l) => {
    listsByName[l.name] = l.movieKeys || [];
  });

  // Backfill sortOrder for legacy documents (once per doc).
  const missingOrder = lists.filter(
    (l) => l.sortOrder == null || l.sortOrder === undefined
  );
  if (missingOrder.length) {
    const maxSo = lists.reduce(
      (m, l) => Math.max(m, Number(l.sortOrder) || 0),
      0
    );
    let next = maxSo + 1;
    missingOrder.sort((a, b) =>
      String(a.name).localeCompare(String(b.name))
    );
    for (const l of missingOrder) {
      await List.updateOne({ _id: l._id }, { $set: { sortOrder: next++ } });
    }
    lists = await List.find().lean();
  }

  lists.sort(
    (a, b) =>
      (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
      String(a.name).localeCompare(String(b.name))
  );
  const listOrder = lists.map((l) => l.name);

  res.json({ movies: moviesByKey, lists: listsByName, listOrder, banners });
});

// Fetch VAST tag and return a usable HTML5 mediafile (prefer mp4/progressive)
// This avoids player.vast-vpaid picking a format that may render as black.
app.get("/api/vast/media", async (req, res) => {
  const tag = req.query.tag;
  if (!tag || typeof tag !== "string") {
    res.status(400).json({ error: "tag query param is required" });
    return;
  }

  try {
    const r = await fetch(tag, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ZyroMoviesVastProxy",
      },
    });
    if (!r.ok) {
      res
        .status(502)
        .json({ error: "failed to fetch VAST tag", status: r.status });
      return;
    }

    const xml = await r.text();

    // Duration: prefer HH:MM:SS; fallback to MM:SS.
    const durationMatchH = xml.match(
      /<Duration>\s*(\d{1,2}):(\d{2}):(\d{2})\s*<\/Duration>/
    );
    const durationSeconds = durationMatchH
      ? Number(durationMatchH[1]) * 3600 +
        Number(durationMatchH[2]) * 60 +
        Number(durationMatchH[3])
      : (() => {
          const durationMatchM = xml.match(
            /<Duration>\s*(\d{1,2}):(\d{2})\s*<\/Duration>/
          );
          return durationMatchM
            ? Number(durationMatchM[1]) * 60 + Number(durationMatchM[2])
            : null;
        })();

    const escType = (t) => t.replace(/\//g, "\\/");

    // VAST MediaFile URLs usually live inside CDATA. Regex match can be fragile
    // across VAST variants, so we extract all <MediaFile> blocks for a given type
    // then pick the first progressive (delivery="progressive") else fallback first.
    const extractMediaFile = (wantedType) => {
      const typeEsc = escType(wantedType);

      const reMediaFile = new RegExp(
        `<MediaFile[^>]*type="${typeEsc}"[^>]*>[\\s\\S]*?<\\/MediaFile>`,
        "gi"
      );

      const progressiveFirst = [];
      const any = [];

      const blocks = xml.match(reMediaFile) || [];
      for (const block of blocks) {
        // Extract CDATA content if present
        const cdataMatch = block.match(
          /<!\[CDATA\[([\s\S]*?)\]\]>/i
        );
        const url = (cdataMatch ? cdataMatch[1] : "")
          .replace(/^\s+|\s+$/g, "");
        if (!url) continue;

        const isProgressive = /delivery="progressive"/i.test(block);
        const item = { type: wantedType, url };
        if (isProgressive) progressiveFirst.push(item);
        else any.push(item);
      }

      if (progressiveFirst.length) return progressiveFirst[0];
      if (any.length) return any[0];
      return null;
    };

    let media = extractMediaFile("video/mp4");
    if (!media) media = extractMediaFile("video/webm");

    res.json({
      durationSeconds,
      media,
    });
  } catch (e) {
    res.status(500).json({
      error: "VAST parsing failed",
      message: e?.message ?? String(e),
    });
  }
});

// Create / update movie (used by admin Add + Edit)
app.post("/api/movie", async (req, res) => {
  const movie = await Movie.findOneAndUpdate(
    { key: req.body.key },
    req.body,
    { upsert: true, new: true }
  );
  res.json(movie);
});

// Delete movie
app.delete("/api/movie/:key", async (req, res) => {
  const key = req.params.key;
  await Movie.deleteOne({ key });
  await List.updateMany({}, { $pull: { movieKeys: key } });
  res.json({ ok: true });
});

// Create list (if not exists)
app.post("/api/list", async (req, res) => {
  const { name } = req.body;
  const existing = await List.findOne({ name });
  if (existing) {
    res.json(existing);
    return;
  }
  const maxAgg = await List.aggregate([
    { $group: { _id: null, m: { $max: "$sortOrder" } } },
  ]);
  const nextOrder = (maxAgg[0]?.m ?? 0) + 1;
  const list = await List.create({
    name,
    movieKeys: [],
    sortOrder: nextOrder,
  });
  res.json(list);
});

// Set display order for lists on home page (1 = top). Random rows are always last (client-side).
app.post("/api/lists/reorder", async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) {
    res.status(400).json({ error: "order must be an array of list names" });
    return;
  }
  await Promise.all(
    order.map((listName, i) =>
      List.updateOne({ name: listName }, { $set: { sortOrder: i + 1 } })
    )
  );
  res.json({ ok: true });
});

// Assign movie to list
app.post("/api/list/assign", async (req, res) => {
  const { name, key } = req.body;
  const list = await List.findOneAndUpdate(
    { name },
    { $addToSet: { movieKeys: key } },
    { upsert: true, new: true }
  );
  res.json(list);
});

// Add banner
app.post("/api/banner", async (req, res) => {
  const banner = await Banner.create(req.body);
  res.json(banner);
});

// Delete banner
app.delete("/api/banner/:id", async (req, res) => {
  await Banner.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

const PORT = 3001;

// Open the website when someone visits root.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("API running on http://localhost:" + PORT);
});

