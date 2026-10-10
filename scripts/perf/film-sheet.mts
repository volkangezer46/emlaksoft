/** double-load.mts FILM karelerini tek temas sayfasina dizer. Kullanim: npx tsx scripts/perf/film-sheet.mts <klasor> <bas> <son> <cikti.jpg> */
import sharp from "sharp";
import { readdirSync } from "node:fs";

const [d, a, b, out] = process.argv.slice(2);
const files = readdirSync(d)
  .filter((f) => f.endsWith(".jpg") && !f.startsWith("sheet"))
  .sort()
  .slice(Number(a || 0), Number(b || 12));
const W = 480;
const H = 300;
const cols = 3;
const rows = Math.ceil(files.length / cols);
const comps = await Promise.all(
  files.map(async (f, i) => ({
    input: await sharp(`${d}/${f}`)
      .resize(W, H, { fit: "fill" })
      .composite([{ input: Buffer.from(`<svg width="${W}" height="22"><rect width="${W}" height="22" fill="black"/><text x="4" y="16" fill="yellow" font-size="14">${f.slice(2, 16)}</text></svg>`), top: 0, left: 0 }])
      .jpeg()
      .toBuffer(),
    left: (i % cols) * W,
    top: Math.floor(i / cols) * H,
  })),
);
await sharp({ create: { width: W * cols, height: H * rows, channels: 3, background: "#fff" } })
  .composite(comps)
  .jpeg({ quality: 70 })
  .toFile(out);
console.log(files.join(" "));
