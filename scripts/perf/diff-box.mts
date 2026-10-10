/**
 * Iki ekran goruntusu arasindaki farkin satir araliklarini yazar. Kullanim: npx tsx scripts/perf/diff-box.mts a.png b.png
 */
import sharp from "sharp";

const a = await sharp(process.argv[2]!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const b = await sharp(process.argv[3]!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const w = a.info.width;
const h = Math.min(a.info.height, b.info.height);
const rows: number[] = [];
for (let y = 0; y < h; y++) {
  let d = 0;
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!) > 12) d++;
  }
  if (d) rows.push(y);
}
const ranges: [number, number][] = [];
for (const y of rows) {
  const last = ranges[ranges.length - 1];
  if (last && y - last[1] <= 8) last[1] = y;
  else ranges.push([y, y]);
}
console.log(ranges.slice(0, 30).map((r) => r.join("-")).join(" "));
