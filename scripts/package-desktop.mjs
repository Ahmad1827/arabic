// Builds the desktop app into dist/:  node scripts/package-desktop.mjs [win32|linux|darwin]
//
// The app's files are copied to a staging folder and their dependencies
// installed there for the target system (one of them, the canvas library,
// ships a different binary for each system), so a Windows build can be made
// from Linux and the other way round.
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const platform = process.argv[2] || process.platform;
const arch = process.argv[3] || "x64";
const info = JSON.parse(readFileSync("package.json", "utf8"));
const stage = path.resolve("dist", `stage-${platform}-${arch}`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const item of ["server.js", "src", "public", "scripts", "desktop", "README.md", "package-lock.json"]) cpSync(item, path.join(stage, item), { recursive: true });
// Only what the app needs at run time goes into the build.
const { devDependencies, scripts, ...runtime } = info;
writeFileSync(path.join(stage, "package.json"), JSON.stringify(runtime, null, 2));

console.log(`Installing dependencies for ${platform}-${arch}…`);
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", `--os=${platform}`, `--cpu=${arch}`], { cwd: stage, stdio: "inherit" });

// Files the app never loads: debugging maps, and the copies of the PDF library
// meant for web pages rather than for this program.
for (const unused of ["pdfjs-dist/build", "pdfjs-dist/web", "pdfjs-dist/types"]) rmSync(path.join(stage, "node_modules", unused), { recursive: true, force: true });
for (const file of readdirSync(path.join(stage, "node_modules"), { recursive: true })) {
  if (file.endsWith(".map")) rmSync(path.join(stage, "node_modules", file), { force: true });
}

console.log("Packaging…");
const [output] = await packager({
  dir: stage,
  name: "Arabic Reader",
  platform,
  arch,
  out: "dist",
  overwrite: true,
  asar: false, // plain files, so the voice helper script can be run from disk
  prune: false, // the staging folder already holds only runtime dependencies
  electronVersion: devDependencies.electron.replace(/^[^\d]*/, ""),
  appVersion: info.version,
  icon: path.resolve("desktop", platform === "win32" ? "icon.ico" : "icon.png"),
  win32metadata: { CompanyName: "Arabic Reader", FileDescription: "Arabic Reader", ProductName: "Arabic Reader" },
});
rmSync(stage, { recursive: true, force: true });
console.log("Built:", output);
