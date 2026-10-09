import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { wordsOf } from "./text.js";

// Analysis runs through the Claude Code command line (`claude -p`), which uses
// the Claude subscription this computer is already logged in to. No API key.
const MODEL = process.env.CLAUDE_MODEL || "sonnet";
const TIMEOUT_MS = 120_000;

export const MODES = {
  levantine: "Levantine Arabic",
  quranic: "Quranic Arabic",
  hadith: "Hadith",
  msa: "Modern Standard Arabic",
};

// An error whose message is safe and useful to show to the learner.
export class AnalysisError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const text = (description) => ({ type: "string", description });
const ANALYSIS_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    translation: text("Natural English translation of the whole sentence."),
    words: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer", description: "The number of the word, as given in the list." },
          vowelled: text("The word with full vowel marks (tashkeel)."),
          translit: text("Latin-letter transliteration of the word as pronounced."),
          meaning: text("What the word means in this sentence, in 1-4 English words."),
          lemma: text("Dictionary form, vowelled: singular noun, or past-tense 'he' form of a verb."),
          root: text("Root letters separated by spaces, e.g. 'ك ت ب'. Empty if the word has no root."),
          pos: text("Part of speech in plain English, e.g. noun, verb, preposition, pronoun."),
          note: text("One short sentence a beginner would find useful, or empty."),
        },
        required: ["i", "vowelled", "translit", "meaning", "lemma", "root", "pos", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["translation", "words"],
  additionalProperties: false,
});

const VARIETY_GUIDE = {
  levantine: `The text is Levantine colloquial Arabic (Syria, Lebanon, Palestine, Jordan). Vowel and transliterate every word the way it is said in everyday Levantine speech, not the way it would be read in Modern Standard Arabic: for example ق is usually a glottal stop (ʾ), ة is usually -e or -a, and case endings are never pronounced. When a word is specific to the dialect, use the note to give the Modern Standard equivalent.`,
  quranic: `The text is from the Quran or another classical text. Where the text already has vowel marks, keep them exactly as written and only complete what is missing. Transliterate with classical pronunciation, including case endings as written. Give meanings that follow the mainstream understanding of the verse.`,
  hadith: `The text is a hadith, in classical Arabic. Where the text already has vowel marks, keep them exactly as written and only complete what is missing. Transliterate with classical pronunciation. Names of people in the chain of narrators are names: say so in the meaning (for example "Umar (a name)") instead of translating them. Translate the wording faithfully and plainly; do not add commentary or rulings.`,
  msa: `The text is Modern Standard Arabic. Vowel words fully, as in careful formal reading, but leave off the case ending of the last word before a pause the way a newsreader would.`,
};

const SYSTEM = `You are the language engine inside a reading app for someone learning Arabic. The learner is a beginner who cannot read the Arabic script fluently yet, so the app shows your analysis under each word: the vowelled spelling, a transliteration they can read aloud, and the meaning. They tap a word to see its dictionary form, root and a short note, and can save it as a flashcard. Accuracy matters more than anything else here, because the learner cannot check your answer and will memorise what you give them.

You receive one sentence and a numbered list of its words. Return one entry for every numbered word, using the same numbers, and analyse each word as it is used in this sentence. Prefixes and suffixes attached to a word (و، ب، ل، ال, pronoun endings) stay part of that word; explain them in the note when it helps, for example "بـ (with) + ال (the) + قلم (pen)".

Transliteration uses one consistent scheme: long vowels ā ī ū; ʾ for hamza and ʿ for ع; ḥ for ح, kh for خ, gh for غ, sh for ش, th for ث, dh for ذ; ṣ ḍ ṭ ẓ for the emphatic letters; q for ق when it is pronounced as q. Write doubled consonants twice.

Keep meanings short and concrete, and keep notes to a single sentence in plain English without grammar jargon the learner would have to look up. Leave the note empty when there is nothing worth saying.`;

// Runs one prompt through Claude Code and returns the structured answer.
function askClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format", "json",
        "--model", MODEL,
        "--effort", "low",
        "--tools", "",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--no-session-persistence",
        "--system-prompt", SYSTEM,
        "--json-schema", ANALYSIS_SCHEMA,
      ],
      { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    const timer = setTimeout(() => {
      child.kill();
      reject(new AnalysisError(504, "Claude took too long to answer. Try again."));
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        err.code === "ENOENT"
          ? new AnalysisError(503, "Claude Code is not installed on this computer (the `claude` command was not found).")
          : err,
      );
    });

    child.on("close", () => {
      clearTimeout(timer);
      let reply;
      try {
        reply = JSON.parse(stdout);
      } catch {
        return reject(new AnalysisError(502, `Claude Code failed: ${(stderr || stdout).trim().slice(0, 300) || "no output"}`));
      }
      if (reply.is_error || !reply.structured_output) {
        // Covers being logged out and reaching the subscription's usage limit.
        return reject(new AnalysisError(502, `Claude Code said: ${String(reply.result ?? "no answer").slice(0, 300)}`));
      }
      resolve(reply.structured_output);
    });

    child.stdin.end(prompt);
  });
}

// Returns { translation, words } where words[k] is the analysis of the k-th
// word of the sentence, or null if the model skipped it.
export async function analyzeSentence({ mode, sentence, previous, next }) {
  const words = wordsOf(sentence);
  if (words.length === 0) return { translation: "", words: [] };

  const prompt = [
    VARIETY_GUIDE[mode],
    previous && `Sentence before it, for context only:\n${previous}`,
    `Sentence to analyse:\n${sentence}`,
    next && `Sentence after it, for context only:\n${next}`,
    `Words to analyse:\n${words.map((w, i) => `${i}: ${w}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const answer = await askClaude(prompt);
  if (!Array.isArray(answer.words)) throw new AnalysisError(502, "The analysis came back incomplete. Try again.");

  const byIndex = new Map(answer.words.map((w) => [w.i, w]));
  return {
    translation: String(answer.translation ?? ""),
    words: words.map((_, i) => {
      const entry = byIndex.get(i);
      if (!entry) return null;
      const { i: _i, ...rest } = entry;
      return rest;
    }),
  };
}
