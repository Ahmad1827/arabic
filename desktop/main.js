// The desktop app: starts the same server the browser version uses, on a
// private port, and shows it in a window of its own. Words, progress and the
// voice are kept in the user's own application-data folder.

import { app, BrowserWindow, dialog, session, shell } from "electron";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// `--self-test=<folder>` starts the app, saves a screenshot and a status report
// there, and quits. Used to check a packaged build without clicking through it.
// `--self-test-steps=ai,voice` also tries the Claude Code option and installs
// and tries the voice.
const option = (name) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const selfTest = option("self-test");
const selfTestSteps = (option("self-test-steps") ?? "").split(",").filter(Boolean);

let window = null;

if (!app.requestSingleInstanceLock()) {
  app.quit(); // already open: the first copy is brought forward instead
} else {
  const data = app.getPath("userData");
  process.env.DB_PATH = path.join(data, "app.db");
  process.env.ARABIC_VOICE_DIR = path.join(data, "voice");
  process.env.PORT = "0"; // any free port
  process.env.HOST = "127.0.0.1";

  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("window-all-closed", () => app.quit());

  app.whenReady().then(async () => {
    let port;
    try {
      const { listening } = await import("../server.js");
      port = await listening;
    } catch (err) {
      dialog.showErrorBox("Arabic Reader could not start", String(err?.stack || err));
      return app.quit();
    }
    const home = `http://127.0.0.1:${port}`;

    // The "Paste from clipboard" button needs to read the clipboard.
    session.defaultSession.setPermissionRequestHandler((contents, permission, allow) => {
      allow(contents.getURL().startsWith(home) && ["clipboard-read", "clipboard-sanitized-write", "media"].includes(permission));
    });

    window = new BrowserWindow({
      width: 1280,
      height: 880,
      minWidth: 380,
      minHeight: 560,
      title: "Arabic Reader",
      icon: path.join(here, "icon.png"),
      backgroundColor: "#f5efe2",
      autoHideMenuBar: true,
      show: false,
    });
    // Links that lead out of the app open in the normal browser.
    const outside = (url) => !url.startsWith(home);
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (outside(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
      if (!outside(url)) return;
      event.preventDefault();
      shell.openExternal(url);
    });
    window.on("closed", () => (window = null));

    await window.loadURL(home);
    window.show();

    if (selfTest) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const get = async (route) => (await fetch(home + route)).json().catch((err) => ({ error: String(err) }));
      const report = {
        versions: { electron: process.versions.electron, node: process.versions.node, platform: process.platform },
        dataFolder: data,
        title: window.getTitle(),
        stats: await get("/api/stats"),
        voice: await get("/api/voice"),
        ai: await get("/api/ai"),
        surahs: (await get("/api/library/quran")).length,
      };
      const send = async (method, route, body) => {
        const response = await fetch(home + route, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
        return { status: response.status, ...(await response.json().catch(() => ({}))) };
      };
      if (selfTestSteps.includes("ai")) {
        // Uses whatever Claude Code is installed and logged in on this computer.
        const previous = report.ai.provider;
        await send("PUT", "/api/ai", { provider: "claude-code" });
        report.claudeCode = await send("POST", "/api/ai/test");
        if (!previous) report.note = "Claude Code was selected as the AI by this test.";
      }
      if (selfTestSteps.includes("voice")) {
        await send("POST", "/api/voice/install");
        const started = Date.now();
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          report.voice = await get("/api/voice");
          if (report.voice.available || !report.voice.installing.running || Date.now() - started > 15 * 60_000) break;
        }
        report.voiceInstallSeconds = Math.round((Date.now() - started) / 1000);
        if (report.voice.available) {
          const spoken = await fetch(`${home}/api/tts?text=${encodeURIComponent("مَرْحَبًا بِكُمْ")}`);
          report.speech = { status: spoken.status, type: spoken.headers.get("content-type"), bytes: (await spoken.arrayBuffer()).byteLength };
        }
      }
      writeFileSync(path.join(selfTest, "screenshot.png"), (await window.webContents.capturePage()).toPNG());
      writeFileSync(path.join(selfTest, "report.json"), JSON.stringify(report, null, 2));
      app.quit();
    }
  });
}
