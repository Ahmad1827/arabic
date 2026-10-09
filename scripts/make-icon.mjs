// Draws the app icon (desktop/icon.png and desktop/icon.ico). Run once; the
// results are kept in the repository.  node scripts/make-icon.mjs [font.ttf]
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { existsSync, writeFileSync } from "node:fs";

const font = [process.argv[2], "/mnt/c/Windows/Fonts/arabtype.ttf", "/mnt/c/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf"].find((file) => file && existsSync(file));
if (!font) throw new Error("No Arabic font found: pass the path of a .ttf file.");
GlobalFonts.registerFromPath(font, "IconArabic");

function draw(size) {
  const canvas = createCanvas(size, size);
  const c = canvas.getContext("2d");
  const u = size / 512;
  // emerald tile with rounded corners
  const tile = c.createLinearGradient(0, 0, size, size);
  tile.addColorStop(0, "#0d7a6d");
  tile.addColorStop(1, "#07463f");
  c.fillStyle = tile;
  c.beginPath();
  c.roundRect(24 * u, 24 * u, 464 * u, 464 * u, 104 * u);
  c.fill();
  // gold arch, like a mihrab niche
  c.fillStyle = "#e6b450";
  c.beginPath();
  c.moveTo(116 * u, 408 * u);
  c.lineTo(116 * u, 250 * u);
  c.bezierCurveTo(116 * u, 150 * u, 190 * u, 104 * u, 256 * u, 84 * u);
  c.bezierCurveTo(322 * u, 104 * u, 396 * u, 150 * u, 396 * u, 250 * u);
  c.lineTo(396 * u, 408 * u);
  c.closePath();
  c.fill();
  // the letter ḍād, the emblem of Arabic
  c.fillStyle = "#07463f";
  c.font = `${300 * u}px IconArabic`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("ض", 256 * u, 262 * u);
  return canvas.toBuffer("image/png");
}

writeFileSync("desktop/icon.png", draw(512));

// An .ico file is a small directory followed by the pictures; Windows accepts PNG data inside it.
const sizes = [256, 64, 48, 32, 16];
const images = sizes.map(draw);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size === 256 ? 0 : size, entry);
  header.writeUInt8(size === 256 ? 0 : size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
writeFileSync("desktop/icon.ico", Buffer.concat([header, ...images]));
console.log("icon drawn with", font);
