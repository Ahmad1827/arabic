// The app's own Arabic voice. Speech is made on this computer by the Piper
// engine, so it sounds the same everywhere. Each piece of text is spoken once
// and the recording kept. The voice is installed from Settings (or with
// `npm run setup-voice`): it needs Python, and downloads about 260 MB.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Where the voice lives: inside the project when run from source, in the
// user's own data folder when run as the desktop app.
const VOICE_DIR = process.env.ARABIC_VOICE_DIR || path.join(root, ".voice");
const WINDOWS = process.platform === "win32";
const PYTHON = WINDOWS ? path.join(VOICE_DIR, "Scripts", "python.exe") : path.join(VOICE_DIR, "bin", "python");
const VOICE_NAME = "ar_JO-kareem-medium";
const VOICE_SOURCE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium";
const MODEL = path.join(VOICE_DIR, "models", `${VOICE_NAME}.onnx`);
const WORKER = path.join(root, "scripts", "voice-worker.py");

export const voiceAvailable = () => existsSync(PYTHON) && existsSync(MODEL);

export class VoiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let worker = null; // { child, waiting: Map<id, {resolve, reject}> }
let nextId = 1;

function startWorker() {
  const child = spawn(PYTHON, [WORKER, MODEL], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" } });
  const waiting = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      return; // not ours: a stray print from a library
    }
    const request = waiting.get(reply.id);
    if (!request) return;
    waiting.delete(reply.id);
    if (reply.ok) request.resolve();
    else request.reject(new VoiceError(500, "The voice could not read that text."));
  });
  const failAll = () => {
    for (const request of waiting.values()) request.reject(new VoiceError(503, "The voice stopped unexpectedly. Try again."));
    waiting.clear();
    if (worker?.child === child) worker = null; // the next request starts a fresh one
  };
  child.on("exit", failAll);
  child.on("error", failAll);
  return { child, waiting };
}

// Loads the voice ahead of the first request, which otherwise waits a few seconds.
export function warmUp() {
  if (voiceAvailable()) worker ??= startWorker();
}

const inProgress = new Map(); // file -> promise, so the same text is never spoken twice at once

// Returns the path of a WAV file with `text` spoken aloud.
export async function speechFile(text, cacheDir) {
  if (!voiceAvailable()) {
    throw new VoiceError(503, "The Arabic voice is not installed yet. It can be installed from Settings.");
  }
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${createHash("sha256").update(text).digest("hex")}.wav`);
  if (existsSync(file)) return file;

  if (!inProgress.has(file)) {
    worker ??= startWorker();
    const { child, waiting } = worker;
    const id = nextId++;
    const partial = `${file}.${id}.part`;
    const job = new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, text, out: partial })}\n`);
    })
      .then(() => {
        renameSync(partial, file); // only complete recordings get the final name
        return file;
      })
      .finally(() => inProgress.delete(file));
    inProgress.set(file, job);
  }
  return inProgress.get(file);
}

// ---- Installing the voice -------------------------------------------------------

// What the Settings page shows while the voice is being installed.
export const installation = { running: false, step: "", percent: 0, error: null };

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(output.trim().split("\n").slice(-3).join(" ") || `exit ${code}`))));
  });
}

// The Python already on this computer, used once to create the voice's own copy.
async function findPython() {
  for (const [command, ...args] of WINDOWS ? [["python"], ["py", "-3"]] : [["python3"], ["python"]]) {
    try {
      const version = (await run(command, [...args, "--version"])).match(/Python 3\.(\d+)/);
      if (version && Number(version[1]) >= 9) return [command, ...args];
    } catch {
      // Not this one: try the next name.
    }
  }
  throw new VoiceError(503, "The voice needs Python 3.9 or newer, which was not found on this computer. Install it from python.org (on Windows, tick “Add python.exe to PATH”), then try again.");
}

async function download(url, file, onPercent) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed (${response.status})`);
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  const counted = Readable.fromWeb(response.body).on("data", (chunk) => {
    received += chunk.length;
    if (total) onPercent(Math.round((received / total) * 100));
  });
  await pipeline(counted, createWriteStream(`${file}.part`));
  renameSync(`${file}.part`, file);
}

// Sets the voice up from nothing. Progress is written to `installation`.
export async function installVoice() {
  if (installation.running) return;
  Object.assign(installation, { running: true, step: "Looking for Python…", percent: 0, error: null });
  try {
    if (!existsSync(PYTHON)) {
      const [python, ...args] = await findPython();
      installation.step = "Preparing a private copy of Python…";
      await run(python, [...args, "-m", "venv", VOICE_DIR]);
    }
    installation.step = "Installing the speech engine (this takes a minute or two)…";
    await run(PYTHON, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "piper-tts"]);

    mkdirSync(path.dirname(MODEL), { recursive: true });
    if (!existsSync(`${MODEL}.json`)) await download(`${VOICE_SOURCE}/${VOICE_NAME}.onnx.json`, `${MODEL}.json`, () => {});
    if (!existsSync(MODEL)) {
      installation.step = "Downloading the Arabic voice…";
      await download(`${VOICE_SOURCE}/${VOICE_NAME}.onnx`, MODEL, (percent) => (installation.percent = percent));
    }
    Object.assign(installation, { running: false, step: "", percent: 100 });
    warmUp();
  } catch (err) {
    const reason = err instanceof VoiceError ? err.message : `The voice could not be installed: ${String(err.message).slice(0, 240)}`;
    Object.assign(installation, { running: false, step: "", error: reason });
    throw err;
  }
}
