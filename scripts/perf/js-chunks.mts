/**
 * Bir sayfanin yukledigi JS parcalari: ham boyut + ilk modullerin ipucu. Kullanim: npx tsx scripts/perf/js-chunks.mts http://localhost:3100 /
 */
import { gzipSync } from "node:zlib";

const base = process.argv[2] ?? "http://localhost:3100";
const path = process.argv[3] ?? "/";
const html = await (await fetch(base + path)).text();
const urls = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) => m[0]))];
let total = 0;
for (const u of urls) {
  const s = await (await fetch(base + u)).text();
  const gz = gzipSync(s).length;
  total += gz;
  const icons = [...s.matchAll(/default\)\("([a-z0-9-]+)",/g)].map((m) => m[1]).slice(0, 14);
  console.log(`${String(gz).padStart(7)} gz ${String(s.length).padStart(7)} ham ${u.split("/").pop()} ${icons.length ? "ikon:" + icons.join(",") : ""} ${s.slice(100, 180).replace(/\s+/g, " ")}`);
}
console.log("toplam gz", total);
