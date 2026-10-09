import express from "express";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(here, ".env"))) process.loadEnvFile(path.join(here, ".env"));

const { openDb } = await import("./src/db.js");
const { splitSentences, tokenize } = await import("./src/text.js");
const { schedule, newCardState, GRADES } = await import("./src/srs.js");
const { analyzeSentence, readPicture, checkConfig, AnalysisError, MODES } = await import("./src/analyze.js");
const { streaks } = await import("./src/streak.js");
const { TRAINER_LETTERS } = await import("./public/letters.js");
const library = await import("./src/library.js");
const voice = await import("./src/voice.js");
const documents = await import("./src/documents.js");

const MAX_TEXT_CHARS = 20_000;
const MAX_DOCUMENT_CHARS = 600_000; // a few hundred pages
const DAY = 86_400_000;
const GOAL_CHOICES = [5, 10, 20, 30];
const DEFAULT_GOAL = 10;

const db = openDb(process.env.DB_PATH || path.join(here, "data", "app.db"));
const dataDir = path.dirname(process.env.DB_PATH || path.join(here, "data", "app.db"));
const picturesDir = path.join(dataDir, "pictures");
const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(here, "public")));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const hashOf = (mode, sentence) => createHash("sha256").update(`${mode}\n${sentence}`).digest("hex");

function cachedAnalysis(mode, sentence) {
  const row = db.prepare("SELECT json FROM analyses WHERE hash = ?").get(hashOf(mode, sentence));
  return row ? JSON.parse(row.json) : null;
}

const sentencesOf = (text) => splitSentences(text.body, { byLine: Boolean(text.by_line) });

function saveAnalysis(mode, sentence, analysis) {
  db.prepare("INSERT OR REPLACE INTO analyses (hash, json, created_at) VALUES (?, ?, ?)").run(
    hashOf(mode, sentence),
    JSON.stringify(analysis),
    Date.now(),
  );
}

function getText(id) {
  const text = db.prepare("SELECT * FROM texts WHERE id = ?").get(Number(id));
  if (!text) throw new HttpError(404, "That text no longer exists.");
  return text;
}

// ---- Daily goal and streak --------------------------------------------------

// Days are counted in the learner's timezone, which the browser sends along
// with every request (minutes behind UTC, as Date#getTimezoneOffset gives it).
function tzOf(req) {
  const minutes = Number(req.get("X-TZ-Offset"));
  return Number.isFinite(minutes) && Math.abs(minutes) <= 900 ? minutes : new Date().getTimezoneOffset();
}
const dayOf = (timestamp, tz) => Math.floor((timestamp - tz * 60_000) / DAY);
const startOfDay = (day, tz) => day * DAY + tz * 60_000;

function getGoal() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'dailyGoal'").get();
  return row ? Number(row.value) : DEFAULT_GOAL;
}

// Records today as a goal day once enough answers are in. True only on the
// answer that gets there.
function markGoal(req) {
  const tz = tzOf(req);
  const today = dayOf(Date.now(), tz);
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM activity WHERE at >= ?").get(startOfDay(today, tz));
  if (n < getGoal()) return false;
  return db.prepare("INSERT OR IGNORE INTO goal_days (day) VALUES (?)").run(today).changes === 1;
}

function logActivity(req, kind) {
  db.prepare("INSERT INTO activity (kind, at) VALUES (?, ?)").run(kind, Date.now());
  return markGoal(req);
}

function progress(req, justReached = false) {
  const tz = tzOf(req);
  const today = dayOf(Date.now(), tz);
  const firstDay = today - 6;
  const counts = Array(7).fill(0);
  for (const { at } of db.prepare("SELECT at FROM activity WHERE at >= ?").all(startOfDay(firstDay, tz))) {
    const slot = dayOf(at, tz) - firstDay;
    if (slot >= 0 && slot < 7) counts[slot]++;
  }
  const met = new Set(db.prepare("SELECT day FROM goal_days").all().map((row) => row.day));
  return {
    goal: getGoal(),
    today: counts[6],
    justReached,
    ...streaks(met, today),
    week: counts.map((count, i) => ({ count, met: met.has(firstDay + i) })), // oldest first, today last
  };
}

app.put("/api/goal", (req, res) => {
  const goal = Number(req.body?.goal);
  if (!GOAL_CHOICES.includes(goal)) throw new HttpError(400, "Choose one of the listed goals.");
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('dailyGoal', ?)").run(String(goal));
  res.json(progress(req, markGoal(req)));
});

// ---- Alphabet trainer -------------------------------------------------------

app.get("/api/letters", (req, res) => {
  const strengths = {};
  for (const row of db.prepare("SELECT letter, strength FROM letter_progress").all()) strengths[row.letter] = row.strength;
  res.json(strengths);
});

app.post("/api/letters/answer", (req, res) => {
  const letter = req.body?.letter;
  if (!TRAINER_LETTERS.includes(letter)) throw new HttpError(400, "Unknown letter.");
  const correct = req.body?.correct === true;
  const current = db.prepare("SELECT strength FROM letter_progress WHERE letter = ?").get(letter)?.strength ?? 0;
  const strength = correct ? Math.min(5, current + 1) : Math.floor(current / 2);
  db.prepare(
    `INSERT INTO letter_progress (letter, strength, correct, wrong) VALUES (?, ?, ?, ?)
     ON CONFLICT (letter) DO UPDATE SET
       strength = excluded.strength,
       correct = correct + excluded.correct,
       wrong = wrong + excluded.wrong`,
  ).run(letter, strength, correct ? 1 : 0, correct ? 0 : 1);
  res.json({ strength, progress: progress(req, logActivity(req, "letter")) });
});

// ---- Texts ----------------------------------------------------------------

app.get("/api/texts", (req, res) => {
  res.json(db.prepare("SELECT id, title, mode, ref, created_at FROM texts ORDER BY created_at DESC").all());
});

app.post("/api/texts", (req, res) => {
  const body = String(req.body?.body ?? "").trim();
  const mode = req.body?.mode;
  if (!body) throw new HttpError(400, "Paste some Arabic text first.");
  if (!/\p{Script=Arabic}/u.test(body)) throw new HttpError(400, "That text has no Arabic letters in it.");
  if (!(mode in MODES)) throw new HttpError(400, "Choose which kind of Arabic this is.");
  if (body.length > MAX_TEXT_CHARS) {
    throw new HttpError(400, `That text is too long (${body.length} characters). Split it into parts of up to ${MAX_TEXT_CHARS}.`);
  }
  const firstLine = body.split(/\r?\n/)[0];
  const title = String(req.body?.title ?? "").trim() || (firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine);
  const { lastInsertRowid } = db
    .prepare("INSERT INTO texts (title, mode, body, created_at) VALUES (?, ?, ?, ?)")
    .run(title, mode, body, Date.now());
  res.status(201).json({ id: Number(lastInsertRowid) });
});

// A dropped file (PDF, Word, text, or a picture of a page): its text is pulled
// out and becomes a text to read. Nothing is sent to any AI here; translating
// stays a separate step. Scans can take minutes, so the work runs as a job the
// page asks about until it is done.
const documentJobs = new Map(); // id -> { state, stage, page, pages, textId, error }
let nextJobId = 1;

app.post("/api/documents", express.raw({ type: () => true, limit: "40mb" }), (req, res) => {
  const mode = req.query.mode;
  if (!(mode in MODES)) throw new HttpError(400, "Choose which kind of Arabic this is.");
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, "The file is empty.");

  const name = String(req.query.name || "document");
  const picture = documents.isPicture(name);
  const withAi = picture && req.query.read === "ai";
  const id = String(nextJobId++);
  const job = { state: "working", stage: withAi ? "ai" : "reading", page: 0, pages: 0 };
  documentJobs.set(id, job);

  const read = async () => {
    const jpeg = picture ? await documents.preparePicture(req.body) : null;
    const document = withAi
      // A picture can be read by the person's own AI, which is far more accurate than the built-in recogniser.
      ? documents.tidyDocument(name, await readPicture({ jpeg, config: getAi() }), "picture, read by your AI")
      : await documents.readDocument(name, req.body, {
          cacheDir: path.join(dataDir, "ocr"),
          onProgress: (progress) => Object.assign(job, progress),
        });
    if (document.body.length > MAX_DOCUMENT_CHARS) {
      throw new HttpError(413, `This document is too long to open in one piece (${document.body.length.toLocaleString()} characters; the limit is ${MAX_DOCUMENT_CHARS.toLocaleString()}). Split it into parts.`);
    }
    const title = String(req.query.title || "").trim() || document.title;
    const textId = Number(
      db.prepare("INSERT INTO texts (title, mode, body, created_at, source) VALUES (?, ?, ?, ?, ?)").run(title, mode, document.body, Date.now(), document.source)
        .lastInsertRowid,
    );
    if (jpeg) {
      // The picture is kept so the text can be checked against it.
      mkdirSync(picturesDir, { recursive: true });
      writeFileSync(path.join(picturesDir, `${textId}.jpg`), jpeg);
      db.prepare("UPDATE texts SET picture = ? WHERE id = ?").run(`${textId}.jpg`, textId);
    }
    return textId;
  };

  read()
    .then((textId) => Object.assign(job, { state: "done", textId }))
    .catch((err) => {
      const expected = [HttpError, documents.DocumentError, AnalysisError].some((kind) => err instanceof kind);
      if (!expected) console.error(err);
      Object.assign(job, { state: "failed", error: expected ? err.message : "Something went wrong while reading the file." });
    })
    // Finished jobs are forgotten after a while.
    .finally(() => setTimeout(() => documentJobs.delete(id), 10 * 60_000).unref());
  res.status(202).json({ job: id });
});

app.get("/api/documents/jobs/:id", (req, res) => {
  const job = documentJobs.get(req.params.id);
  if (!job) throw new HttpError(404, "That file is no longer being read. Try dropping it again.");
  res.json(job);
});

app.get("/api/texts/:id", async (req, res) => {
  const text = getText(req.params.id);
  const sentences = sentencesOf(text).map((sentence) => ({
    text: sentence,
    tokens: tokenize(sentence),
    analysis: cachedAnalysis(text.mode, sentence),
  }));

  let surah = null;
  if (text.ref?.startsWith("quran:")) {
    const number = Number(text.ref.split(":")[1]);
    // The surah list is cached from when the surah was opened, so this works offline.
    const info = (await library.listSurahs(db).catch(() => [])).find((s) => s.number === number);
    if (info) surah = { ...info, basmala: !library.BASMALA_FREE.includes(number) };
  }
  res.json({
    id: text.id,
    title: text.title,
    mode: text.mode,
    ref: text.ref,
    translation: text.translation,
    source: text.source,
    picture: Boolean(text.picture),
    surah,
    sentences,
  });
});

app.get("/api/texts/:id/picture", (req, res) => {
  const text = getText(req.params.id);
  if (!text.picture) throw new HttpError(404, "This text has no picture.");
  res.sendFile(path.join(picturesDir, path.basename(text.picture)));
});

app.delete("/api/texts/:id", (req, res) => {
  const picture = db.prepare("SELECT picture FROM texts WHERE id = ?").get(Number(req.params.id))?.picture;
  if (picture) rmSync(path.join(picturesDir, path.basename(picture)), { force: true });
  db.prepare("DELETE FROM texts WHERE id = ?").run(Number(req.params.id));
  res.status(204).end();
});

// ---- Library: Quran and hadith ----------------------------------------------

function saveLibraryText({ title, mode, ref, byLine, body, translation, source, analyses }) {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO texts (title, mode, body, created_at, ref, by_line, translation, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(title, mode, body, Date.now(), ref, byLine ? 1 : 0, translation, source);
  for (const { sentence, analysis } of analyses) saveAnalysis(mode, sentence, analysis);
  return Number(lastInsertRowid);
}

app.get("/api/library/quran", async (req, res) => {
  res.json(await library.listSurahs(db));
});

app.post("/api/library/quran/:number", async (req, res) => {
  res.json({ id: await library.openSurah(db, Number(req.params.number), saveLibraryText) });
});

app.get("/api/library/hadith", async (req, res) => {
  res.json(await library.listCollections(db));
});

app.get("/api/library/hadith/:collection/:section", async (req, res) => {
  res.json(await library.listHadiths(db, req.params.collection, Number(req.params.section)));
});

app.post("/api/library/hadith/:collection/:section/:number", async (req, res) => {
  const { collection, section, number } = req.params;
  res.json({ id: await library.openHadith(db, collection, Number(section), Number(number), saveLibraryText) });
});

// ---- The AI that explains words (set up by each person in Settings) -----------

function getAi() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai'").get();
  return row ? JSON.parse(row.value) : null;
}

// What the Settings page may see: everything except the key itself.
const describeAi = (config) => ({
  provider: config?.provider ?? null,
  model: config?.model ?? "",
  baseUrl: config?.baseUrl ?? "",
  hasKey: Boolean(config?.apiKey),
});

app.get("/api/ai", (req, res) => {
  res.json(describeAi(getAi()));
});

app.put("/api/ai", (req, res) => {
  const config = checkConfig(req.body, getAi());
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ai', ?)").run(JSON.stringify(config));
  res.json(describeAi(config));
});

// Tries the saved settings on one short sentence, without storing the result.
app.post("/api/ai/test", async (req, res) => {
  const analysis = await analyzeSentence({ mode: "msa", sentence: "أهلا وسهلا", config: getAi() });
  const first = analysis.words.find(Boolean);
  if (!first) throw new AnalysisError(502, "The AI answered, but not in a form the app can use. A more capable model may be needed.");
  res.json({ translation: analysis.translation, word: first });
});

// ---- Analysis -------------------------------------------------------------

const inFlight = new Map(); // hash -> promise, so one sentence is never analysed twice at once

app.post("/api/analyze", async (req, res) => {
  const text = getText(req.body?.textId);
  const sentences = sentencesOf(text);
  const index = Number(req.body?.index);
  const sentence = sentences[index];
  if (sentence === undefined) throw new HttpError(404, "That sentence is not in this text.");

  const cached = cachedAnalysis(text.mode, sentence);
  if (cached) return res.json(cached);
  // Lines with no Arabic (page numbers, a stray English heading) are never sent anywhere.
  if (!/\p{Script=Arabic}/u.test(sentence)) {
    return res.json({ translation: "", words: tokenize(sentence).filter((t) => t.isWord).map(() => null) });
  }

  const hash = hashOf(text.mode, sentence);
  if (!inFlight.has(hash)) {
    const job = analyzeSentence({
      mode: text.mode,
      sentence,
      previous: sentences[index - 1],
      next: sentences[index + 1],
      config: getAi(),
    })
      .then((analysis) => {
        saveAnalysis(text.mode, sentence, analysis);
        return analysis;
      })
      .finally(() => inFlight.delete(hash));
    inFlight.set(hash, job);
  }
  res.json(await inFlight.get(hash));
});

// ---- Voice ------------------------------------------------------------------

app.get("/api/voice", (req, res) => {
  res.json({ available: voice.voiceAvailable(), installing: voice.installation });
});

// Installs the voice in the background; the Settings page watches /api/voice.
app.post("/api/voice/install", (req, res) => {
  if (!voice.voiceAvailable()) voice.installVoice().catch((err) => err instanceof voice.VoiceError || console.error(err));
  res.status(202).json({ available: voice.voiceAvailable(), installing: voice.installation });
});

app.get("/api/tts", async (req, res) => {
  const text = String(req.query.text ?? "").replace(/\s+/g, " ").trim();
  if (!text || !/\p{Script=Arabic}/u.test(text)) throw new HttpError(400, "There is no Arabic text to read.");
  if (text.length > 1000) throw new HttpError(400, "That is too long to read in one go.");
  const file = await voice.speechFile(text, path.join(dataDir, "tts"));
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  res.sendFile(file);
});

// ---- Saved words ----------------------------------------------------------

app.get("/api/cards", (req, res) => {
  res.json(db.prepare("SELECT * FROM cards ORDER BY created_at DESC").all());
});

app.post("/api/cards", (req, res) => {
  const text = getText(req.body?.textId);
  const sentence = sentencesOf(text)[Number(req.body?.index)];
  const analysis = sentence && cachedAnalysis(text.mode, sentence);
  const wordIndex = Number(req.body?.word);
  const entry = analysis?.words[wordIndex];
  if (!entry) throw new HttpError(400, "That word has not been analysed yet.");

  const surface = tokenize(sentence).filter((t) => t.isWord)[wordIndex].core;
  const state = newCardState();
  // In a library surah every line is one verse, and words that came from
  // Quran.com (no dictionary details) line up with its word recordings.
  const pad = (n) => String(n).padStart(3, "0");
  const audio =
    text.ref?.startsWith("quran:") && !entry.lemma && !entry.pos
      ? `https://audio.qurancdn.com/wbw/${pad(text.ref.split(":")[1])}_${pad(Number(req.body?.index) + 1)}_${pad(wordIndex + 1)}.mp3`
      : null;
  db.prepare(
    `INSERT OR IGNORE INTO cards
       (mode, word, vowelled, translit, meaning, lemma, root, pos, note,
        sentence, sentence_translation, created_at, due, interval, ease, reps, lapses, audio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    text.mode, surface, entry.vowelled, entry.translit, entry.meaning, entry.lemma, entry.root, entry.pos, entry.note,
    sentence, analysis.translation, Date.now(), state.due, state.interval, state.ease, state.reps, state.lapses, audio,
  );
  res.status(201).json(
    db.prepare("SELECT * FROM cards WHERE mode = ? AND vowelled = ?").get(text.mode, entry.vowelled),
  );
});

app.delete("/api/cards/:id", (req, res) => {
  db.prepare("DELETE FROM cards WHERE id = ?").run(Number(req.params.id));
  res.status(204).end();
});

// ---- Review ---------------------------------------------------------------

app.get("/api/review", (req, res) => {
  res.json(db.prepare("SELECT * FROM cards WHERE due <= ? ORDER BY due").all(Date.now()));
});

app.post("/api/review/:id", (req, res) => {
  const card = db.prepare("SELECT * FROM cards WHERE id = ?").get(Number(req.params.id));
  if (!card) throw new HttpError(404, "That word is no longer saved.");
  const grade = req.body?.grade;
  if (!GRADES.includes(grade)) throw new HttpError(400, "Unknown answer.");

  const now = Date.now();
  const next = schedule(card, grade, now);
  db.prepare("UPDATE cards SET due = ?, interval = ?, ease = ?, reps = ?, lapses = ? WHERE id = ?").run(
    next.due, next.interval, next.ease, next.reps, next.lapses, card.id,
  );
  db.prepare("INSERT INTO reviews (card_id, grade, reviewed_at) VALUES (?, ?, ?)").run(card.id, grade, now);
  res.json({ card: { ...card, ...next }, progress: progress(req, logActivity(req, "review")) });
});

app.get("/api/stats", (req, res) => {
  res.json({
    words: db.prepare("SELECT COUNT(*) AS n FROM cards").get().n,
    due: db.prepare("SELECT COUNT(*) AS n FROM cards WHERE due <= ?").get(Date.now()).n,
    ...progress(req),
  });
});

// ---- Errors ---------------------------------------------------------------

app.use((err, req, res, next) => {
  if ([HttpError, AnalysisError, library.LibraryError, voice.VoiceError, documents.DocumentError].some((kind) => err instanceof kind)) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.type === "entity.too.large") return res.status(413).json({ error: "That is too large. Files can be up to 40 MB." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong in the app." });
});

// PORT=0 lets the system pick any free port, which is what the desktop app does.
const port = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
const host = process.env.HOST || "127.0.0.1";
export const server = app.listen(port, host);
// Resolves with the port the app is actually listening on.
export const listening = new Promise((resolve, reject) => {
  server.once("error", reject);
  server.once("listening", () => {
    console.log(`Arabic reader running at http://localhost:${server.address().port}`);
    if (voice.voiceAvailable()) voice.warmUp();
    else console.log("No built-in voice yet. It can be installed from Settings.");
    resolve(server.address().port);
  });
});
