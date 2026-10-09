// Turns an uploaded file (PDF, Word or plain text) into plain text for the reader.
//
// PDFs are the hard case. A PDF stores glyphs at positions, not sentences, and
// Arabic is usually stored in the order it is drawn (left to right across the
// page) using the joined letter shapes. So each line is put back into reading
// order, the shapes are turned back into ordinary letters, and lines are
// rejoined into paragraphs.

import path from "node:path";

export class DocumentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const ARABIC_ALL = new RegExp(ARABIC.source, "g");
const LATIN_ALL = /[A-Za-z]/g;

// Joined letter shapes (ﻋ ﻌ ﻊ) back to plain letters (ع).
const plainLetters = (text) => text.replace(/[ﭐ-﷿ﹰ-﻿]+/g, (shapes) => shapes.normalize("NFKC"));

const MIRROR = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "«": "»", "»": "«", "<": ">", ">": "<" };
const isMark = (text) => /^\p{M}+$/u.test(text);
const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)] ?? 0;

// ---- Ligatures that come through back to front ---------------------------------
//
// Some PDFs (typically ones made with Adobe tools) write ordinary letters as
// joined shapes, but a ligature, one glyph standing for two letters, comes
// through as two plain letters in the wrong order: "في" arrives as "يف".
// Arabic joining rules give it away: a plain (unjoined) letter cannot sit where
// a joined one must be. So each run of plain letters is read as single letters
// or swapped pairs, whichever makes the joining come out right.

// The shape of each joined-form character: its block in Unicode lists
// isolated, final, initial, medial, in that order.
const SHAPE = new Map();
{
  let previous = null;
  let index = 0;
  for (let code = 0xfe80; code <= 0xfefc; code++) {
    const char = String.fromCharCode(code);
    const letter = char.normalize("NFKC");
    index = letter === previous ? index + 1 : 0;
    previous = letter;
    SHAPE.set(char, ["isolated", "final", "initial", "medial"][index]);
  }
}
const PLAIN_LETTER = /[ء-ي]/;
const NEVER_JOINS_NEXT = new Set("اأإآدذرزوؤءةى");
const ONLY_AT_WORD_END = new Set("ةى");

export function fixLigatures(raw) {
  const chars = Array.from(raw);
  if (!chars.some((char) => SHAPE.has(char))) return raw; // ordinary text: nothing to fix
  const isLetter = (char) => char !== undefined && (PLAIN_LETTER.test(char) || SHAPE.has(char));

  for (let start = 0; start < chars.length; start++) {
    if (!PLAIN_LETTER.test(chars[start])) continue;
    let end = start;
    while (end < chars.length && PLAIN_LETTER.test(chars[end])) end++;
    const run = chars.slice(start, end);
    const before = chars[start - 1];
    const after = chars[end];
    const joinedFromBefore = ["initial", "medial"].includes(SHAPE.get(before));
    const joinsToAfter = ["final", "medial"].includes(SHAPE.get(after));

    // best[k][j]: fewest swaps to read run[k..], where j says whether the
    // letter before position k reaches forward to join it.
    const memo = new Map();
    const solve = (k, joined) => {
      if (k === run.length) return joined === joinsToAfter || !isLetter(after) ? { swaps: 0, out: [] } : null;
      const key = `${k}${joined}`;
      if (memo.has(key)) return memo.get(key);
      let best = null;
      const consider = (swaps, out, rest) => {
        if (rest && (!best || swaps + rest.swaps < best.swaps)) best = { swaps: swaps + rest.swaps, out: [...out, ...rest.out] };
      };
      const letter = run[k];
      const nextIsLetter = k + 1 < run.length || isLetter(after);
      // A letter standing alone: nothing may join onto it, and it must not be
      // one that would have joined the letter after it.
      if (!joined && (!nextIsLetter || (NEVER_JOINS_NEXT.has(letter) && !ONLY_AT_WORD_END.has(letter)))) {
        consider(0, [letter], solve(k + 1, false));
      }
      // A swapped pair: really `second` then `first`.
      if (k + 1 < run.length) {
        const [first, second] = [run[k], run[k + 1]];
        const lastOfPairEndsWord = ONLY_AT_WORD_END.has(first);
        const moreLetters = k + 2 < run.length || isLetter(after);
        if (!ONLY_AT_WORD_END.has(second) && !(lastOfPairEndsWord && moreLetters)) {
          consider(1, [second, first], solve(k + 2, !NEVER_JOINS_NEXT.has(first) && moreLetters));
        }
      }
      memo.set(key, best);
      return best;
    };
    const reading = run.length > 1 || joinedFromBefore ? solve(0, joinedFromBefore) : null;
    if (reading?.swaps) chars.splice(start, run.length, ...reading.out);
    start = end;
  }
  return chars.join("");
}

// Tidies one piece of text as the PDF library hands it over.
function pieceText(raw) {
  const text = plainLetters(fixLigatures(raw));
  // A vowel mark often arrives with a stray space in front of it.
  if (/^[\s\u0640]*\p{M}+$/u.test(text)) return text.replace(/[\s\u0640]/g, "");
  // The one-piece ligature for "لله" comes through back to front.
  return text.replace(/^هلل(?!\p{L})/u, "لله");
}

// Horizontal distance between two pieces of text (0 if they touch or overlap).
const gapBetween = (a, b) => Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));

// One page's pieces of text -> lines in reading order, each with its vertical
// position and letter height.
//
// The order pieces arrive in cannot be trusted (it follows fonts as much as
// position), so everything is rebuilt from where each piece sits on the page:
// pieces are grouped into lines by height, ordered across the line, and a
// space is added wherever there is a visible gap.
export function pageLines(items) {
  const pieces = items
    .filter((item) => item.str.trim())
    .map((item) => ({ text: pieceText(item.str), x: item.transform[4], y: item.transform[5], width: item.width, height: item.height || 0, marks: [] }));
  const bases = pieces.filter((piece) => !isMark(piece.text)).sort((a, b) => b.y - a.y);
  const marks = pieces.filter((piece) => isMark(piece.text));

  const lines = [];
  for (const piece of bases) {
    const line = lines.at(-1);
    if (line && Math.abs(piece.y - line.y) <= Math.max(line.height, piece.height) * 0.5) {
      line.pieces.push(piece);
      line.height = Math.max(line.height, piece.height);
    } else {
      lines.push({ y: piece.y, height: piece.height, pieces: [piece] });
    }
  }

  // Vowel marks are separate pieces floating above or below a letter: each is
  // given to the letter it sits over, on the nearest line.
  for (const mark of marks) {
    const line = lines.reduce((best, l) => (!best || Math.abs(l.y - mark.y) < Math.abs(best.y - mark.y) ? l : best), null);
    if (!line || Math.abs(line.y - mark.y) > line.height * 1.5) continue;
    // A mark is drawn from the left edge of its letter, so it belongs to the
    // letter whose width covers that point (failing that, the nearest one).
    const covering = line.pieces.filter((piece) => piece.x - 0.5 <= mark.x && mark.x < piece.x + piece.width - 0.5);
    const letter = (covering.length ? covering : line.pieces).reduce((best, piece) =>
      !best || Math.abs(piece.x - mark.x) < Math.abs(best.x - mark.x) ? piece : best, null);
    letter.marks.push(mark.text);
  }

  return lines
    .map((line) => {
      const raw = line.pieces.map((piece) => piece.text).join("");
      const rtl = ARABIC.test(raw) && (raw.match(ARABIC_ALL)?.length ?? 0) >= (raw.match(LATIN_ALL)?.length ?? 0);
      const centre = (piece) => piece.x + piece.width / 2;
      let ordered = [...line.pieces].sort((a, b) => (rtl ? centre(b) - centre(a) : centre(a) - centre(b)));

      // Pieces are now in the order they appear across the line. A stretch
      // written in the other direction (a number or Latin word inside Arabic,
      // or an Arabic word inside English) reads the opposite way, so each
      // such stretch is turned round.
      const kind = (piece) => (ARABIC.test(piece.text) ? "rtl" : /[A-Za-z0-9\u0660-\u0669]/.test(piece.text) ? "ltr" : "neutral");
      const own = rtl ? "rtl" : "ltr";
      const other = rtl ? "ltr" : "rtl";
      const fixed = [];
      for (let i = 0; i < ordered.length; ) {
        if (kind(ordered[i]) !== other) {
          const piece = ordered[i++];
          // Brackets are stored the way they look, which in Arabic is mirrored.
          fixed.push(rtl && MIRROR[piece.text] ? { ...piece, text: MIRROR[piece.text] } : piece);
          continue;
        }
        let end = i; // last piece of this stretch
        for (let j = i + 1; j < ordered.length && kind(ordered[j]) !== own; j++) {
          if (kind(ordered[j]) === other) end = j;
        }
        fixed.push(...ordered.slice(i, end + 1).reverse());
        i = end + 1;
      }
      ordered = fixed;

      // Neighbouring pieces sometimes overlap and repeat the letters they
      // share; the repeat is dropped.
      for (let i = 1; i < ordered.length; i++) {
        const [left, right] = [ordered[i - 1], ordered[i]];
        const overlap = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
        if (overlap <= 0.5) continue;
        // Single letters count as a repeat only when they sit on top of each other.
        const single = left.text.length < 2 || right.text.length < 2;
        if (single && overlap < Math.min(left.width, right.width) * 0.6) continue;
        for (let size = Math.min(4, left.text.length, right.text.length); size > 0; size--) {
          if (left.text.endsWith(right.text.slice(0, size))) {
            ordered[i] = { ...right, text: right.text.slice(size) };
            break;
          }
        }
      }

      let text = "";
      ordered.forEach((piece, i) => {
        // Small print on a line of larger text has smaller gaps between words.
        const size = Math.min(ordered[i - 1]?.height || line.height, piece.height || line.height);
        if (i > 0 && gapBetween(ordered[i - 1], piece) > size * 0.15) text += " ";
        text += piece.text + piece.marks.join("");
      });
      // A vowel mark never starts a word, so a space before one is stray.
      const tidy = plainLetters(text).replace(/\s+(\p{M})/gu, "$1").replace(/\s+/g, " ").trim();
      return { text: tidy, y: line.y, height: line.height };
    })
    .filter((line) => line.text);
}

// Lines -> paragraphs: a new paragraph starts at a wider gap or a change of
// letter size (a heading); otherwise lines are parts of one running paragraph.
function paragraphs(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
  const usual = median(gaps.filter((gap) => gap > 0));
  const out = [];
  lines.forEach((line, i) => {
    const previous = lines[i - 1];
    const gap = previous ? previous.y - line.y : 0;
    const sameSize = previous && Math.abs(previous.height - line.height) <= previous.height * 0.1;
    if (previous && sameSize && gap > 0 && gap <= usual * 1.35) out[out.length - 1] += ` ${line.text}`;
    else out.push(line.text);
  });
  return out;
}

// ---- Scans: reading text off pictures of pages --------------------------------
//
// A scanned PDF or a photo has no text in it, only an image. The Tesseract
// recogniser reads Arabic off the image, on this computer. It is right most of
// the time on clean print and makes mistakes, so its text is labelled as such.

const SCAN_NOTE = "recognised from a picture of the page, so expect some wrong letters and punctuation";
const MAX_SCAN_PAGES = 300;

async function startRecogniser(cacheDir) {
  const { createWorker } = await import("tesseract.js");
  try {
    return await createWorker("ara", 1, { cachePath: cacheDir });
  } catch {
    throw new DocumentError(503, "The text recogniser could not start. The first time it is used it downloads its Arabic data, which needs an internet connection.");
  }
}

// One page image -> paragraphs of text.
async function recognise(recogniser, image) {
  const { data } = await recogniser.recognize(image, {}, { blocks: true });
  const lines = (data.blocks ?? [])
    .flatMap((block) => block.paragraphs ?? [])
    .flatMap((paragraph) => paragraph.lines ?? [])
    // Specks, logos and decoration come out as low-confidence scraps.
    .filter((line) => line.confidence >= 40 && (line.text.match(ARABIC_ALL)?.length ?? 0) >= 3)
    .map((line) => ({ text: line.text.replace(/\s+/g, " ").trim(), width: line.bbox.x1 - line.bbox.x0 }));

  // A line clearly shorter than the rest is a heading or the end of a paragraph.
  const usual = median(lines.map((line) => line.width));
  const out = [];
  let open = false;
  for (const line of lines) {
    if (open) out[out.length - 1] += ` ${line.text}`;
    else out.push(line.text);
    open = line.width >= usual * 0.7;
  }
  return out;
}

async function recogniseImage(data, options) {
  const recogniser = await startRecogniser(options.cacheDir);
  try {
    options.onProgress?.({ stage: "recognising", page: 1, pages: 1 });
    const text = await recognise(recogniser, data).catch(() => {
      throw new DocumentError(422, "This picture could not be read. Use a PNG or JPEG image.");
    });
    return { body: text.join("\n"), detail: `picture, ${SCAN_NOTE}` };
  } finally {
    await recogniser.terminate();
  }
}

async function recognisePdfPages(pdf, options) {
  if (pdf.numPages > MAX_SCAN_PAGES) {
    throw new DocumentError(413, `This scan has ${pdf.numPages} pages. Recognising text is slow, so the limit is ${MAX_SCAN_PAGES}: split it into parts.`);
  }
  const { createCanvas } = await import("@napi-rs/canvas");
  const recogniser = await startRecogniser(options.cacheDir);
  const pages = [];
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      options.onProgress?.({ stage: "recognising", page: number, pages: pdf.numPages });
      const page = await pdf.getPage(number);
      // About 1800 pixels wide: enough for the recogniser, without wasting time.
      const scale = Math.min(4, Math.max(1, 1800 / page.getViewport({ scale: 1 }).width));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const text = await recognise(recogniser, canvas.toBuffer("image/png"));
      page.cleanup();
      if (text.length) pages.push({ number, text });
    }
  } finally {
    await recogniser.terminate();
  }
  return pages;
}

async function fromPdf(data, options) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(data), useSystemFonts: true, verbosity: 0 });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (err) {
    if (err?.name === "PasswordException") throw new DocumentError(422, "This PDF is locked with a password, so it cannot be read.");
    throw new DocumentError(422, "This file could not be read as a PDF. It may be damaged.");
  }
  const pageCount = pdf.numPages;
  try {
    let pages = [];
    for (let number = 1; number <= pageCount; number++) {
      options.onProgress?.({ stage: "reading", page: number, pages: pageCount });
      const content = await (await pdf.getPage(number)).getTextContent();
      const text = paragraphs(pageLines(content.items));
      if (text.length) pages.push({ number, text });
    }
    // No real Arabic text inside: the pages are pictures, so read them as such.
    const scanned = !ARABIC.test(pages.flatMap((page) => page.text).join(""));
    if (scanned) pages = await recognisePdfPages(pdf, options);
    if (pages.length === 0) throw new DocumentError(422, "No Arabic text could be found on these pages, even by reading them as pictures.");

    // Page numbers are kept as markers so a place in the document can be found again.
    const body = pages.map((page) => (pageCount > 1 ? [`⸻ ${page.number} ⸻`, ...page.text] : page.text).join("\n")).join("\n");
    const count = `${pageCount} ${pageCount === 1 ? "page" : "pages"}`;
    return { body, detail: scanned ? `${count}, ${SCAN_NOTE}` : count };
  } finally {
    await task.destroy();
  }
}

async function fromWord(data) {
  const mammoth = (await import("mammoth")).default;
  try {
    const { value } = await mammoth.extractRawText({ buffer: data });
    return { body: value, detail: "Word document" };
  } catch {
    throw new DocumentError(422, "This file could not be read as a Word document. Only .docx files work, not the older .doc.");
  }
}

function fromPlainText(data) {
  const body = new TextDecoder("utf-8", { fatal: false }).decode(data).replace(/^﻿/, "");
  if (body.includes("�")) throw new DocumentError(422, "This text file is not saved as UTF-8, so its Arabic cannot be read. Save it again as UTF-8.");
  return { body, detail: "text file" };
}

const READERS = {
  ".pdf": fromPdf,
  ".docx": fromWord,
  ".txt": fromPlainText,
  ".md": fromPlainText,
  ".srt": fromPlainText,
  ".png": recogniseImage,
  ".jpg": recogniseImage,
  ".jpeg": recogniseImage,
  ".webp": recogniseImage,
};
export const DOCUMENT_TYPES = Object.keys(READERS);

// Returns { title, body, source } for a file's name and contents.
// `options.cacheDir` is where the text recogniser keeps its language data;
// `options.onProgress` is told which page is being worked on.
export async function readDocument(filename, data, options = {}) {
  const extension = path.extname(filename).toLowerCase();
  // A PDF is recognised by its first bytes too, in case the name says nothing.
  const reader = READERS[extension] ?? (data.subarray(0, 5).toString("latin1") === "%PDF-" ? fromPdf : null);
  if (!reader) throw new DocumentError(415, `This kind of file cannot be read. Use one of: ${DOCUMENT_TYPES.join(", ")}.`);

  const { body, detail } = await reader(data, options);
  const cleaned = body
    // Invisible control characters (PDFs sometimes carry a NUL for a glyph
    // they cannot name) would cut the text short when stored.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (!ARABIC.test(cleaned)) throw new DocumentError(422, "No Arabic text was found in this file.");
  return {
    title: path.basename(filename, path.extname(filename)).slice(0, 80) || "Document",
    body: cleaned,
    source: `From the file “${path.basename(filename)}” (${detail}).`,
  };
}
