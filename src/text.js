// Splitting pasted text into sentences and words. This is done in code, not by
// the model, so the words on screen are always exactly what the user pasted.

const MAX_WORDS = 30; // longest sentence sent to the model in one piece
const MERGE_UP_TO = 12; // short neighbouring sentences on one line are analysed together

const countWords = (s) => s.split(/\s+/).filter(Boolean).length;

// With `byLine`, every line is exactly one sentence. Library texts use this
// so a Quran verse is never merged with its neighbour or cut in two.
export function splitSentences(body, { byLine = false } = {}) {
  if (byLine) {
    return body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let current = "";
    for (const part of trimmed.split(/(?<=[.!?؟۔…])\s+/u)) {
      if (current && countWords(current) + countWords(part) > MERGE_UP_TO) {
        out.push(...splitLong(current));
        current = part;
      } else {
        current = current ? `${current} ${part}` : part;
      }
    }
    if (current) out.push(...splitLong(current));
  }
  return out;
}

function splitLong(sentence) {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_WORDS) return [sentence];
  const pieces = [];
  for (let i = 0; i < words.length; i += MAX_WORDS) {
    pieces.push(words.slice(i, i + MAX_WORDS).join(" "));
  }
  return pieces;
}

// Each token keeps the punctuation around it so the sentence can be redrawn
// exactly. `core` is the word itself; tokens without a letter (numbers, verse
// markers, lone punctuation) are not words and are never sent for analysis.
export function tokenize(sentence) {
  return sentence
    .split(/\s+/)
    .filter(Boolean)
    .map((piece) => {
      const [, pre, core, post] = piece.match(
        /^([^\p{L}\p{M}\p{N}]*)(.*?)([^\p{L}\p{M}\p{N}]*)$/su,
      );
      return { pre, core, post, isWord: /\p{L}/u.test(core) };
    });
}

export const wordsOf = (sentence) =>
  tokenize(sentence)
    .filter((t) => t.isWord)
    .map((t) => t.core);

// Removes vowel marks and tatweel, leaving the bare consonant skeleton.
export const stripMarks = (s) => s.replace(/[\p{M}ـ]/gu, "");
