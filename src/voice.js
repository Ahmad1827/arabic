// The app's own Arabic voice. Speech is made on this computer by the Piper
// engine (installed with `npm run setup-voice`), so it sounds the same in
// every browser. Each piece of text is spoken once and the recording kept.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = path.join(root, ".voice", "bin", "python");
const MODEL = path.join(root, ".voice", "models", "ar_JO-kareem-medium.onnx");
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
  const child = spawn(PYTHON, [WORKER, MODEL], { stdio: ["pipe", "pipe", "ignore"] });
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
    throw new VoiceError(503, "The Arabic voice is not installed. Run `npm run setup-voice` in the project folder, then restart the app.");
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
