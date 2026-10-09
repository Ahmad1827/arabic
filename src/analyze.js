import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { wordsOf } from "./text.js";

// Word explanations come from an AI that each person sets up for themselves
// in the app's Settings. Three kinds are supported:
//   claude-code        the Claude Code app installed on this computer
//   anthropic          the Claude API, with the person's own key
//   openai-compatible  any service with an OpenAI-style chat endpoint
//                      (OpenAI, Gemini, OpenRouter, Groq, a local Ollama, ...)
export const PROVIDERS = ["claude-code", "anthropic", "openai-compatible"];
const DEFAULT_MODEL = { "claude-code": "sonnet", anthropic: "claude-opus-5-5" };
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
const ANALYSIS_SCHEMA = {
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
};

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

// ---- Claude Code on this computer -------------------------------------------

function askClaudeCode(prompt, config) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format", "json",
        "--model", config.model || DEFAULT_MODEL["claude-code"],
        "--effort", "low",
        "--tools", "",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--no-session-persistence",
        "--system-prompt", SYSTEM,
        "--json-schema", JSON.stringify(ANALYSIS_SCHEMA),
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
          ? new AnalysisError(503, "Claude Code is not installed on this computer (the `claude` command was not found). Install it, or choose another option in Settings.")
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
        // Covers being logged out and reaching the plan's usage limit.
        return reject(new AnalysisError(502, `Claude Code said: ${String(reply.result ?? "no answer").slice(0, 300)}`));
      }
      resolve(reply.structured_output);
    });

    child.stdin.end(prompt);
  });
}

// ---- Claude API ---------------------------------------------------------------

// Models where a declined request can be retried on a fallback model by the API.
const HAS_FALLBACK = /^claude-(fable-5|opus-5|sonnet-5-5)/;
// Older models that do not accept an effort setting.
const NO_EFFORT = /^claude-(haiku-4|sonnet-4-5|opus-4-[01])/;

async function askAnthropic(prompt, config) {
  const model = config.model || DEFAULT_MODEL.anthropic;
  const client = new Anthropic({ apiKey: config.apiKey });
  let message;
  try {
    message = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      ...(HAS_FALLBACK.test(model) && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
      output_config: {
        ...(!NO_EFFORT.test(model) && { effort: "low" }),
        format: betaJSONSchemaOutputFormat(ANALYSIS_SCHEMA),
      },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AnalysisError(401, "The Anthropic API key was rejected. Check it in Settings.");
    }
    if (err instanceof Anthropic.NotFoundError) {
      throw new AnalysisError(404, `Anthropic does not know the model "${model}". Check the model name in Settings.`);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AnalysisError(429, "The Anthropic API is rate limiting this key. Wait a moment and try again.");
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new AnalysisError(502, "Could not reach the Anthropic API. Check your internet connection.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new AnalysisError(502, `Anthropic API error (${err.status}): ${err.message}`);
    }
    throw err;
  }
  if (message.stop_reason === "refusal") throw new AnalysisError(422, "The model declined to analyse this sentence.");
  if (message.stop_reason === "max_tokens" || !message.parsed_output) {
    throw new AnalysisError(502, "The analysis came back incomplete. Try again.");
  }
  return message.parsed_output;
}

// ---- Any OpenAI-style service -------------------------------------------------

const JSON_ONLY = `

Reply with a single JSON object and nothing else, in exactly this shape:
{"translation": string, "words": [{"i": number, "vowelled": string, "translit": string, "meaning": string, "lemma": string, "root": string, "pos": string, "note": string}]}`;

async function askOpenAICompatible(prompt, config) {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const send = async (responseFormat) => {
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }) },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: SYSTEM + JSON_ONLY },
            { role: "user", content: prompt },
          ],
          response_format: responseFormat,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err.name === "TimeoutError") throw new AnalysisError(504, "The AI service took too long to answer. Try again.");
      throw new AnalysisError(502, `Could not reach ${config.baseUrl}. Check the address in Settings, and that the service is running.`);
    }
  };

  // Ask for output that must follow the schema; services that do not support
  // that get a plain "JSON please" request instead.
  let response = await send({ type: "json_schema", json_schema: { name: "analysis", strict: true, schema: ANALYSIS_SCHEMA } });
  if (response.status === 400 || response.status === 422) response = await send({ type: "json_object" });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    if (response.status === 401 || response.status === 403) throw new AnalysisError(401, "The AI service rejected the API key. Check it in Settings.");
    if (response.status === 404) throw new AnalysisError(404, `The AI service does not know the model "${config.model}", or the address is wrong. Check both in Settings.`);
    if (response.status === 429) throw new AnalysisError(429, "The AI service is rate limiting this key, or its free quota is used up. Wait and try again.");
    throw new AnalysisError(502, `The AI service answered with an error (${response.status}). ${detail}`);
  }

  const data = await response.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new AnalysisError(502, "The AI service sent back an answer the app could not read.");
  try {
    // Some models wrap their JSON in a code fence or add a word before it.
    return JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  } catch {
    throw new AnalysisError(502, "The AI service did not answer in the expected format. A more capable model may be needed.");
  }
}

// ---- Settings ---------------------------------------------------------------

// Checks settings coming from the Settings page. `previous` supplies the saved
// API key when the form leaves the key field empty, so a key is typed only once.
export function checkConfig(input, previous) {
  const provider = input?.provider;
  if (!PROVIDERS.includes(provider)) throw new AnalysisError(400, "Choose one of the options.");
  const trimmed = (value) => String(value ?? "").trim();
  const sameProvider = previous?.provider === provider;
  const config = {
    provider,
    model: trimmed(input.model),
    baseUrl: provider === "openai-compatible" ? trimmed(input.baseUrl) : "",
    apiKey: provider === "claude-code" ? "" : trimmed(input.apiKey) || (sameProvider ? previous.apiKey : ""),
  };
  if (provider === "anthropic" && !config.apiKey) throw new AnalysisError(400, "Paste your Anthropic API key.");
  if (provider === "openai-compatible") {
    if (!/^https?:\/\/\S+$/.test(config.baseUrl)) throw new AnalysisError(400, "Enter the service's address, starting with http:// or https://.");
    if (!config.model) throw new AnalysisError(400, "Enter the name of the model to use.");
  }
  return config;
}

const ASK = { "claude-code": askClaudeCode, anthropic: askAnthropic, "openai-compatible": askOpenAICompatible };

// Returns { translation, words } where words[k] is the analysis of the k-th
// word of the sentence, or null if the model skipped it.
export async function analyzeSentence({ mode, sentence, previous, next, config }) {
  if (!config) {
    throw new AnalysisError(409, "No AI is set up to explain words yet. Open Settings and choose one.");
  }
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

  const answer = await ASK[config.provider](prompt, config);
  if (!Array.isArray(answer?.words)) throw new AnalysisError(502, "The analysis came back incomplete. Try again.");

  // Other services are not held to the schema as strictly, so every field is
  // read defensively.
  const byIndex = new Map(answer.words.map((word) => [Number(word?.i), word]));
  const field = (value) => (typeof value === "string" ? value : "");
  return {
    translation: field(answer.translation),
    words: words.map((_, i) => {
      const entry = byIndex.get(i);
      if (!entry || !field(entry.vowelled) || !field(entry.meaning)) return null;
      return {
        vowelled: entry.vowelled,
        translit: field(entry.translit),
        meaning: entry.meaning,
        lemma: field(entry.lemma),
        root: field(entry.root),
        pos: field(entry.pos),
        note: field(entry.note),
      };
    }),
  };
}
