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
