// The built-in library: the Quran (from Quran.com) and hadith collections
// (from the open hadith-api project). Texts are fetched once, then kept in the
// local database so they open instantly and work offline afterwards.
//
// Nothing here is generated: Arabic text, translations and the Quran's
// word-by-word meanings all come from those sources unchanged.

import { wordsOf } from "./text.js";

const QURAN_API = "https://api.quran.com/api/v4";
const QURAN_TRANSLATION = 20; // Saheeh International
const HADITH_API = "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1";

export const BASMALA_FREE = [1, 9]; // surahs that are not preceded by the basmala line

const COLLECTIONS = [
  { key: "nawawi", short: "Nawawi", title: "The Forty Hadith of an-Nawawi", blurb: "42 short, foundational hadiths. The best place to start." },
  { key: "qudsi", short: "Qudsi", title: "Forty Hadith Qudsi", blurb: "Sayings in which the Prophet ﷺ relates words from Allah." },
  { key: "bukhari", short: "Bukhari", title: "Sahih al-Bukhari", blurb: "The most widely relied-upon collection." },
  { key: "muslim", short: "Muslim", title: "Sahih Muslim", blurb: "The second of the two Sahih collections." },
  { key: "abudawud", short: "Abu Dawud", title: "Sunan Abi Dawud", blurb: "Focused on rulings and practice." },
  { key: "tirmidhi", short: "Tirmidhi", title: "Jami' at-Tirmidhi", blurb: "With notes on each hadith's grading." },
  { key: "nasai", short: "Nasa'i", title: "Sunan an-Nasa'i", blurb: "Known for its careful selection." },
  { key: "ibnmajah", short: "Ibn Majah", title: "Sunan Ibn Majah", blurb: "The sixth of the six major books." },
  { key: "malik", short: "Malik", title: "Muwatta Malik", blurb: "One of the earliest collections." },
];

export class LibraryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function fetchJson(db, url, sourceName) {
  const cached = db.prepare("SELECT body FROM remote_cache WHERE url = ?").get(url);
  if (cached) return JSON.parse(cached.body);

  let body;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = await response.text();
    JSON.parse(body);
  } catch {
    throw new LibraryError(502, `Could not download from ${sourceName}. Check your internet connection and try again.`);
  }
  db.prepare("INSERT OR REPLACE INTO remote_cache (url, body, fetched_at) VALUES (?, ?, ?)").run(url, body, Date.now());
  return JSON.parse(body);
}

const textIdsByRef = (db, prefix) =>
  new Map(db.prepare("SELECT ref, id FROM texts WHERE ref LIKE ?").all(`${prefix}%`).map((row) => [row.ref, row.id]));

// ---- Quran ------------------------------------------------------------------

export async function listSurahs(db) {
  const { chapters } = await fetchJson(db, `${QURAN_API}/chapters?language=en`, "Quran.com");
  const opened = textIdsByRef(db, "quran:");
  return chapters.map((chapter) => ({
    number: chapter.id,
    name: chapter.name_simple,
    nameArabic: chapter.name_arabic,
    meaning: chapter.translated_name.name,
    verses: chapter.verses_count,
    place: chapter.revelation_place === "makkah" ? "Meccan" : "Medinan",
    textId: opened.get(`quran:${chapter.id}`) ?? null,
  }));
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const ayahMark = (number) => `﴿${String(number).replace(/\d/g, (d) => ARABIC_DIGITS[d])}﴾`;

// Translations carry footnote markers such as <sup foot_note=1>1</sup>.
const stripMarkup = (text) => text.replace(/<sup[^>]*>.*?<\/sup>/g, "").replace(/<[^>]+>/g, "").trim();

// Turns one verse from Quran.com into a line of text plus a ready-made
// word-by-word analysis in the same shape the reader gets from Claude.
export function verseToLine(verse) {
  const words = verse.words.filter((word) => word.char_type_name === "word");
  const line = `${words.map((word) => word.text_uthmani.trim()).join(" ")} ${ayahMark(verse.verse_number)}`;
  const cores = wordsOf(line);
  // If the words do not line up one-to-one, store no analysis rather than a
  // shifted one; the reader then falls back to analysing the verse itself.
  const analysis =
    cores.length === words.length
      ? {
          translation: stripMarkup(verse.translations?.[0]?.text ?? ""),
          words: words.map((word, i) => ({
            vowelled: cores[i],
            translit: word.transliteration?.text ?? "",
            meaning: word.translation?.text ?? "",
            lemma: "",
            root: "",
            pos: "",
            note: "",
          })),
        }
      : null;
  return { line, analysis };
}

// `save` stores the text and its analyses and returns the new text's id.
export async function openSurah(db, number, save) {
  const ref = `quran:${number}`;
  const existing = db.prepare("SELECT id FROM texts WHERE ref = ?").get(ref);
  if (existing) return existing.id;

  const surah = (await listSurahs(db)).find((s) => s.number === number);
  if (!surah) throw new LibraryError(404, "There is no surah with that number.");

  const lines = [];
  for (let page = 1; page; ) {
    const data = await fetchJson(
      db,
      `${QURAN_API}/verses/by_chapter/${number}?words=true&word_fields=text_uthmani&translations=${QURAN_TRANSLATION}&per_page=50&page=${page}`,
      "Quran.com",
    );
    lines.push(...data.verses.map(verseToLine));
    page = data.pagination.next_page;
  }

  return save({
    title: surah.name,
    mode: "quranic",
    ref,
    byLine: true,
    body: lines.map((l) => l.line).join("\n"),
    translation: null,
    source: "Arabic text, pronunciation and word-by-word meanings from Quran.com. Translation: Saheeh International.",
    analyses: lines.filter((l) => l.analysis).map((l) => ({ sentence: l.line, analysis: l.analysis })),
  });
}

// ---- Hadith -----------------------------------------------------------------

export async function listCollections(db) {
  const info = await fetchJson(db, `${HADITH_API}/info.min.json`, "the hadith library");
  return COLLECTIONS.filter((c) => info[c.key]).map((collection) => {
    const { sections, section_details: details } = info[collection.key].metadata;
    return {
      key: collection.key,
      title: collection.title,
      blurb: collection.blurb,
      sections: Object.keys(sections)
        .filter((n) => details[n]?.hadithnumber_first > 0)
        .map((n) => ({
          number: Number(n),
          title: sections[n] || collection.title,
          count: Math.floor(details[n].hadithnumber_last) - Math.floor(details[n].hadithnumber_first) + 1,
        })),
    };
  });
}

async function loadSection(db, key, section) {
  if (!COLLECTIONS.some((c) => c.key === key) || !Number.isInteger(section) || section < 0) {
    throw new LibraryError(404, "That part of the hadith library does not exist.");
  }
  const [arabic, english] = await Promise.all(
    ["ara", "eng"].map((language) =>
      fetchJson(db, `${HADITH_API}/editions/${language}-${key}/sections/${section}.min.json`, "the hadith library"),
    ),
  );
  const englishByNumber = new Map(english.hadiths.map((hadith) => [hadith.hadithnumber, hadith]));
  return arabic.hadiths
    .filter((hadith) => hadith.text?.trim())
    .map((hadith) => ({
      number: hadith.hadithnumber,
      arabic: hadith.text.replace(/\s+/g, " ").trim(),
      english: englishByNumber.get(hadith.hadithnumber)?.text?.replace(/\s+/g, " ").trim() ?? "",
      grades: englishByNumber.get(hadith.hadithnumber)?.grades ?? [],
    }));
}

const preview = (text, length) => (text.length > length ? `${text.slice(0, length).trimEnd()}…` : text);

export async function listHadiths(db, key, section) {
  const hadiths = await loadSection(db, key, section);
  const opened = textIdsByRef(db, `hadith:${key}:`);
  return hadiths.map((hadith) => ({
    number: hadith.number,
    arabic: preview(hadith.arabic, 160),
    english: preview(hadith.english, 200),
    textId: opened.get(`hadith:${key}:${hadith.number}`) ?? null,
  }));
}

export async function openHadith(db, key, section, number, save) {
  const ref = `hadith:${key}:${number}`;
  const existing = db.prepare("SELECT id FROM texts WHERE ref = ?").get(ref);
  if (existing) return existing.id;

  const hadith = (await loadSection(db, key, section)).find((h) => h.number === number);
  if (!hadith) throw new LibraryError(404, "That hadith was not found.");
  const collection = COLLECTIONS.find((c) => c.key === key);
  const grading = hadith.grades.map((g) => `${g.grade} (${g.name})`).join("; ");

  return save({
    title: `${collection.short} ${hadith.number}`,
    mode: "hadith",
    ref,
    byLine: false,
    body: hadith.arabic,
    translation: hadith.english || null,
    source:
      `${collection.title}, hadith ${hadith.number}. ${grading ? `Grading: ${grading}. ` : ""}` +
      "Arabic and English text from the open hadith-api project. The word-by-word explanations are written by Claude and can contain mistakes.",
    analyses: [],
  });
}
