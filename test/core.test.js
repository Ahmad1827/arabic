import test from "node:test";
import assert from "node:assert/strict";
import { splitSentences, tokenize, wordsOf, stripMarks } from "../src/text.js";
import { schedule, newCardState } from "../src/srs.js";

const DAY = 86_400_000;

test("splits on lines and keeps short neighbouring sentences together", () => {
  assert.deepEqual(splitSentences("مرحبا، كيفك؟ أنا منيح.\n\nشو اسمك؟"), ["مرحبا، كيفك؟ أنا منيح.", "شو اسمك؟"]);
});

test("starts a new piece when merged sentences would get long", () => {
  const a = Array(8).fill("كلمة").join(" ") + ".";
  assert.deepEqual(splitSentences(`${a} ${a}`), [a, a]);
});

test("breaks a very long sentence into pieces of at most 30 words", () => {
  const pieces = splitSentences(Array(70).fill("كلمة").join(" "));
  assert.deepEqual(pieces.map((p) => p.split(" ").length), [30, 30, 10]);
});

test("tokenize separates punctuation and rebuilds the sentence exactly", () => {
  const sentence = "«مرحبا»، كيفك؟ ١٢ ۝";
  const tokens = tokenize(sentence);
  assert.equal(tokens.map((t) => t.pre + t.core + t.post).join(" "), sentence);
  assert.deepEqual(tokens.map((t) => t.isWord), [true, true, false, false]);
  assert.deepEqual(wordsOf(sentence), ["مرحبا", "كيفك"]);
});

test("vowel marks stay inside the word and can be stripped", () => {
  assert.deepEqual(wordsOf("بِسْمِ اللَّهِ"), ["بِسْمِ", "اللَّهِ"]);
  assert.equal(stripMarks("بِسْمِ"), "بسم");
});

test("a new card answered good comes back in 2 days, then grows", () => {
  const now = 1_000_000;
  const first = schedule(newCardState(now), "good", now);
  assert.equal(first.interval, 2);
  assert.equal(first.due, now + 2 * DAY);
  const second = schedule(first, "good", now);
  assert.equal(second.interval, 5);
  assert.equal(second.reps, 2);
});

test("again resets the card and brings it back in 10 minutes", () => {
  const now = 1_000_000;
  const learned = schedule(schedule(newCardState(now), "good", now), "good", now);
  const lapsed = schedule(learned, "again", now);
  assert.equal(lapsed.reps, 0);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.due, now + 600_000);
  assert.ok(lapsed.ease < learned.ease);
});

test("hard never lets the interval shrink or the ease drop below 1.3", () => {
  let card = schedule(newCardState(0), "hard", 0);
  for (let i = 0; i < 20; i++) {
    const next = schedule(card, "hard", 0);
    assert.ok(next.interval > card.interval);
    card = next;
  }
  assert.ok(card.ease >= 1.3);
});

import { streaks } from "../src/streak.js";
import { letterForms, TRAINER_LETTERS, LETTERS, LETTER_AUDIO, LETTER_SPOKEN } from "../public/letters.js";
import { existsSync } from "node:fs";

test("streak counts back from today, or from yesterday if today is not done yet", () => {
  assert.deepEqual(streaks(new Set([8, 9, 10]), 10), { streak: 3, best: 3 });
  assert.deepEqual(streaks(new Set([8, 9]), 10), { streak: 2, best: 2 });
  assert.deepEqual(streaks(new Set([7, 8]), 10), { streak: 0, best: 2 });
  assert.deepEqual(streaks(new Set([1, 2, 3, 4, 9, 10]), 10), { streak: 2, best: 4 });
  assert.deepEqual(streaks(new Set(), 10), { streak: 0, best: 0 });
});

test("every trainer letter has a name and sound, and the right number of shapes", () => {
  assert.equal(TRAINER_LETTERS.length, 31);
  assert.equal(new Set(TRAINER_LETTERS).size, 31);
  for (const letter of TRAINER_LETTERS) assert.ok(LETTERS[letter], letter);
  assert.equal(letterForms("ب").length, 4);
  assert.deepEqual(letterForms("د").map((f) => f.where), ["alone", "end"]);
  assert.deepEqual(letterForms("ء").map((f) => f.where), ["alone"]);
});

import { verseToLine, ayahMark } from "../src/library.js";

test("library texts keep one sentence per line, however long or short", () => {
  const longVerse = Array(45).fill("كلمة").join(" ");
  const body = `${longVerse}\nالٓمٓ. ذَٰلِكَ`;
  assert.deepEqual(splitSentences(body, { byLine: true }), [longVerse, "الٓمٓ. ذَٰلِكَ"]);
  assert.equal(splitSentences(body).length, 3);
});

test("a Quran.com verse becomes a line with a word-for-word analysis", () => {
  const word = (text, translit, meaning) => ({ char_type_name: "word", text_uthmani: text, transliteration: { text: translit }, translation: { text: meaning } });
  const verse = {
    verse_number: 12,
    words: [word("قُلْ", "qul", "Say"), word("هُوَ", "huwa", "He"), { char_type_name: "end", text_uthmani: "١٢" }],
    translations: [{ text: 'Say, "He<sup foot_note=1>1</sup>' }],
  };
  const { line, analysis } = verseToLine(verse);
  assert.equal(line, "قُلْ هُوَ ﴿١٢﴾");
  assert.equal(ayahMark(105), "﴿١٠٥﴾");
  assert.equal(analysis.translation, 'Say, "He');
  assert.deepEqual(analysis.words.map((w) => [w.vowelled, w.translit, w.meaning]), [["قُلْ", "qul", "Say"], ["هُوَ", "huwa", "He"]]);
  assert.deepEqual(wordsOf(line), ["قُلْ", "هُوَ"]);
});

test("a verse whose words do not line up gets no analysis instead of a shifted one", () => {
  const verse = { verse_number: 1, words: [{ char_type_name: "word", text_uthmani: "يَا أَيُّهَا" }], translations: [] };
  assert.equal(verseToLine(verse).analysis, null);
});

test("every trainer letter can be heard: a recording that exists, or a spoken name", () => {
  for (const letter of TRAINER_LETTERS) {
    const file = LETTER_AUDIO[letter];
    if (file) assert.ok(existsSync(new URL(`../public/audio/letters/${file}.mp3`, import.meta.url)), `${letter}: ${file}.mp3`);
    else assert.ok(LETTER_SPOKEN[letter], letter);
  }
  assert.equal(new Set(Object.values(LETTER_AUDIO)).size, 29);
});

import { checkConfig } from "../src/analyze.js";

test("AI settings: a saved key is kept when the field is left empty, and dropped on switching", () => {
  const saved = { provider: "anthropic", model: "", baseUrl: "", apiKey: "secret" };
  assert.equal(checkConfig({ provider: "anthropic", apiKey: "" }, saved).apiKey, "secret");
  assert.equal(checkConfig({ provider: "anthropic", apiKey: "new" }, saved).apiKey, "new");
  assert.equal(checkConfig({ provider: "claude-code", apiKey: "x" }, saved).apiKey, "");
  assert.equal(checkConfig({ provider: "openai-compatible", baseUrl: "https://x/v1", model: "m" }, saved).apiKey, "");
  assert.throws(() => checkConfig({ provider: "anthropic" }, null), /key/);
  assert.throws(() => checkConfig({ provider: "openai-compatible", baseUrl: "ftp://x", model: "m" }, null), /address/);
  assert.throws(() => checkConfig({ provider: "nope" }, null));
});

import { fixLigatures, pageLines } from "../src/documents.js";

// A glyph as a PDF hands it over: text, position of its left edge, width.
const glyph = (str, x, width = 10, y = 100, height = 20) => ({ str, transform: [1, 0, 0, 1, x, y], width, height });
const lineOf = (...glyphs) => pageLines(glyphs).map((line) => line.text);

test("PDF: Arabic drawn left to right across the page is put back in reading order", () => {
  // "كتب 12" as drawn: the number on the left, then ب ت ك from left to right.
  assert.deepEqual(lineOf(glyph("2", 10), glyph("1", 0), glyph("ﺐ", 30), glyph("ﺘ", 40), glyph("ﻛ", 50)), ["كتب 12"]);
});

test("PDF: glyph order in the file is ignored, only positions count", () => {
  assert.deepEqual(lineOf(glyph("ﻛ", 50), glyph("ﺐ", 30), glyph("ﺘ", 40)), ["كتب"]);
});

test("PDF: brackets are un-mirrored and vowel marks go to the letter they sit on", () => {
  assert.deepEqual(lineOf(glyph(")", 70, 5), glyph("ب", 60), glyph("ا", 50), glyph("(", 45, 5)), ["(با)"]);
  assert.deepEqual(lineOf(glyph("ﻝ", 30), glyph(" َ", 41, 0, 104, 12), glyph("ﻗ", 40)), ["قَل"]);
});

test("PDF: an Arabic word inside an English line keeps its letters in order", () => {
  assert.deepEqual(lineOf(glyph("the word", 0, 80), glyph("ب", 90), glyph("ا", 100), glyph("ب", 110), glyph("ok", 130, 20)), ["the word باب ok"]);
});

test("PDF: letters repeated where two pieces overlap are written once", () => {
  assert.deepEqual(lineOf(glyph("كان ا", 100, 50), glyph("الناس", 55, 50)), ["كان الناس"]);
});

test("PDF: two-letter ligatures that arrive reversed are turned back", () => {
  const cases = { "ملﺎ": "لمﺎ", "ﻋﺎمل": "ﻋﺎلم", "ﺗﻨﺎيس": "ﺗﻨﺎسي", "اﻟﻀﻤري": "اﻟﻀﻤير", "أﻋامل": "أﻋمال", "اﻷرسة": "اﻷسرة", "إىل ﻋﺎ": "إلى ﻋﺎ", "اﻻﻋرتاف": "اﻻﻋتراف" };
  for (const [broken, fixed] of Object.entries(cases)) assert.equal(fixLigatures(broken), fixed, broken);
});

test("PDF: correctly ordered text is left alone", () => {
  for (const fine of ["واﻟﺴﻼم", "ﻛﺎن", "دار ﻛﺒﻴﺮة", "في الكتاب", "ﻗﺎل ورد"]) assert.equal(fixLigatures(fine), fine, fine);
});

import { readDocument } from "../src/documents.js";

test("documents: hidden control characters are removed, and files without Arabic are refused", async () => {
  const file = (text) => Buffer.from(text, "utf8");
  const document = await readDocument("notes.txt", file("﻿مرحبا\u0000 بكم‏\n\n  كتاب  جديد "));
  assert.equal(document.body, "مرحبا بكم\nكتاب جديد");
  assert.equal(document.title, "notes");
  await assert.rejects(readDocument("notes.txt", file("hello")), /No Arabic/);
  await assert.rejects(readDocument("film.mp4", file("مرحبا")), /cannot be read/);
});
