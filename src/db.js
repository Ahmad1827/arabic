import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function openDb(file) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS texts (
      id         INTEGER PRIMARY KEY,
      title      TEXT NOT NULL,
      mode       TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- One row per analysed sentence, keyed by a hash of variety + sentence,
    -- so a sentence is only ever paid for once.
    CREATE TABLE IF NOT EXISTS analyses (
      hash       TEXT PRIMARY KEY,
      json       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id          INTEGER PRIMARY KEY,
      mode        TEXT NOT NULL,
      word        TEXT NOT NULL,   -- as it appeared in the text
      vowelled    TEXT NOT NULL,
      translit    TEXT NOT NULL,
      meaning     TEXT NOT NULL,
      lemma       TEXT NOT NULL,
      root        TEXT NOT NULL,
      pos         TEXT NOT NULL,
      note        TEXT NOT NULL,
      sentence    TEXT NOT NULL,
      sentence_translation TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      due         INTEGER NOT NULL,
      interval    REAL NOT NULL,
      ease        REAL NOT NULL,
      reps        INTEGER NOT NULL,
      lapses      INTEGER NOT NULL,
      UNIQUE (mode, vowelled)
    );

    -- Every answer is kept; streaks and progress charts are built from this.
    CREATE TABLE IF NOT EXISTS reviews (
      id          INTEGER PRIMARY KEY,
      card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      grade       TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL
    );

    -- One row per practice answer of any kind (word review or letter quiz).
    -- Kept separate from reviews so deleting a word never shortens a streak.
    CREATE TABLE IF NOT EXISTS activity (
      id   INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS activity_at ON activity (at);

    -- Days (numbered in the learner's own timezone) on which the daily goal
    -- was reached. Recorded at the time, so changing the goal later does not
    -- rewrite the past.
    CREATE TABLE IF NOT EXISTS goal_days (day INTEGER PRIMARY KEY);

    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS letter_progress (
      letter   TEXT PRIMARY KEY,
      strength INTEGER NOT NULL,  -- 0 (new) to 5 (known)
      correct  INTEGER NOT NULL,
      wrong    INTEGER NOT NULL
    );

    INSERT INTO activity (kind, at)
      SELECT 'review', reviewed_at FROM reviews
      WHERE NOT EXISTS (SELECT 1 FROM activity);
  `);
  // Columns added for library texts (Quran and hadith).
  const columns = new Set(db.prepare("PRAGMA table_info(texts)").all().map((column) => column.name));
  const added = {
    ref: "TEXT",                          // e.g. quran:112 or hadith:nawawi:1
    by_line: "INTEGER NOT NULL DEFAULT 0", // 1 = every line is one sentence
    translation: "TEXT",                  // published translation of the whole text
    source: "TEXT",                       // where the text comes from
    picture: "TEXT",                      // file name of the picture it was read from
  };
  for (const [name, type] of Object.entries(added)) {
    if (!columns.has(name)) db.exec(`ALTER TABLE texts ADD COLUMN ${name} ${type}`);
  }
  // Saved Quran words remember the recording of that word.
  const cardColumns = db.prepare("PRAGMA table_info(cards)").all().map((column) => column.name);
  if (!cardColumns.includes("audio")) db.exec("ALTER TABLE cards ADD COLUMN audio TEXT");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS texts_ref ON texts (ref) WHERE ref IS NOT NULL;
    CREATE TABLE IF NOT EXISTS remote_cache (
      url        TEXT PRIMARY KEY,
      body       TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `);
  return db;
}
