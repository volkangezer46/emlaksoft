/**
 * Bundle boyutu raporu (yalnız rapor; varsayılan olarak eşik YOK).
 *
 *   npm run build && npm run check:bundle
 *   npm run check:bundle -- --max-kb=350   # opsiyonel: route başına sıkıştırılmamış JS üst sınırı
 *
 * .next/app-build-manifest.json (varsa) veya .next/server/app/**\/page_client-reference-manifest.js
 * yerine, sürümler arası değişkenliğe dayanıklı olmak için build-manifest ve
 * app-build-manifest dosyalarını dener; hiçbiri yoksa anlamlı mesajla çıkar.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const nextDir = path.join(root, ".next");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const maxArg = arg("max-kb");
const maxKb = maxArg !== undefined ? Number(maxArg) : null;
if (maxKb !== null && (!Number.isFinite(maxKb) || maxKb <= 0)) {
  console.error(`Geçersiz --max-kb değeri: ${maxArg}`);
  process.exit(2);
}

if (!existsSync(nextDir)) {
  console.log(".next klasörü yok; önce `npm run build` çalıştırın. Rapor üretilmedi.");
  process.exit(0);
}

const sizeCache = new Map<string, number>();
function jsSize(file: string): number {
  const cached = sizeCache.get(file);
  if (cached !== undefined) return cached;
  const full = path.join(nextDir, file);
  const size = existsSync(full) ? statSync(full).size : 0;
  sizeCache.set(file, size);
  return size;
}

function readManifest(name: string): Record<string, unknown> | null {
  const p = path.join(nextDir, name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const appManifest = readManifest("app-build-manifest.json");
const pagesManifest = readManifest("build-manifest.json");

type Row = { route: string; kb: number; files: number };
const rows: Row[] = [];

function addRoutes(map: unknown) {
  if (!map || typeof map !== "object") return;
  for (const [route, files] of Object.entries(map as Record<string, unknown>)) {
    if (!Array.isArray(files)) continue;
    const js = [...new Set(files.filter((f): f is string => typeof f === "string" && f.endsWith(".js")))];
    rows.push({
      route,
      kb: js.reduce((sum, f) => sum + jsSize(f), 0) / 1024,
      files: js.length,
    });
  }
}

addRoutes(appManifest?.pages);
addRoutes(pagesManifest?.pages);

if (rows.length === 0) {
  console.log(
    "Route başına JS bilgisi bulunamadı (.next içinde app-build-manifest.json / build-manifest.json yok " +
      "veya bu Next sürümü üretmiyor). Rapor üretilmedi.",
  );
  process.exit(0);
}

rows.sort((a, b) => b.kb - a.kb);
console.log("Route başına JS (sıkıştırılmamış, paylaşılan parçalar dahil)");
console.log("-".repeat(72));
for (const r of rows) {
  console.log(`${r.kb.toFixed(1).padStart(9)} KB  ${String(r.files).padStart(3)} dosya  ${r.route}`);
}
console.log("-".repeat(72));
console.log(`Toplam route: ${rows.length}; en büyük: ${rows[0]!.route} (${rows[0]!.kb.toFixed(1)} KB)`);

if (maxKb !== null) {
  const over = rows.filter((r) => r.kb > maxKb);
  if (over.length > 0) {
    console.error(`\n--max-kb=${maxKb} aşan ${over.length} route:`);
    for (const r of over) console.error(`  ${r.kb.toFixed(1)} KB  ${r.route}`);
    process.exit(1);
  }
  console.log(`Tüm route'lar ${maxKb} KB altında.`);
}
