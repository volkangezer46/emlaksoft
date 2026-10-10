/**
 * Iki goruntunun ayni bolgesini alt alta birlestirir. Kullanim: npx tsx scripts/perf/crop-pair.mts a.png b.png cikti.png x y w h
 */
import sharp from "sharp";

const [a, b, out, x, y, w, h] = process.argv.slice(2);
const r = { left: Number(x), top: Number(y), width: Number(w), height: Number(h) };
const ca = await sharp(a!).extract(r).toBuffer();
const cb = await sharp(b!).extract(r).toBuffer();
await sharp({ create: { width: r.width, height: r.height * 2 + 4, channels: 3, background: "#f00" } })
  .composite([{ input: ca, top: 0, left: 0 }, { input: cb, top: r.height + 4, left: 0 }])
  .png()
  .toFile(out!);
