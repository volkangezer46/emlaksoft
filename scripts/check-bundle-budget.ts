/**
 * Bundle boyutu raporu + rota bazlı ilk yük bütçesi.
 *
 *   npm run build && npm run check:bundle               # yalnız rapor (eşik YOK; eski davranış)
 *   npm run check:bundle -- --max-kb=350                # opsiyonel: route başına sıkıştırılmamış JS üst sınırı
 *   npm run check:bundle -- --warn                      # + panel rotaları ilk yük bütçesi; aşımı YAZAR, çıkış 0
 *   npm run check:bundle -- --gate                      # + aynı bütçe; aşımda çıkış kodu 1 (yayın kancası WP3'te)
 *   npm run check:bundle -- --next-dir=/yol/.next       # başka bir derleme çıktısını ölç (önce/sonra karşılaştırma)
 *
 * İLK YÜK ÖLÇÜMÜ (Next 16 + Turbopack): app-build-manifest.json artık üretilmiyor; rota başına istemci JS'i
 * .next/server/app/<rota>/page_client-reference-manifest.js içindeki `entryJSFiles` (kök + layout zinciri + sayfa +
 * error/loading/not-found sınırları) ile build-manifest.json `rootMainFiles` birleşimidir. Boyut gzip (seviye 6) ile ölçülür.
 * KOPYA MODÜL ORANI: aynı turbopack modül kimliğinin (`,123456,e=>{` / `[123456,(e,t)=>{`) rotanın ilk yük dosyalarında
 * birden fazla kez geçtiği bayt / toplam bayt (konsey/dup.mjs mantığı). İSTEK: ilk yük JS + CSS dosya sayısı.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

/** Bütçe ölçülen panel rotaları (ana sayfa statik HTML; Next JS'i yok → hedef değil). */
export const BUDGET_ROUTES = ["/app", "/app/musteriler", "/app/portfoyler", "/admin"] as const;

/**
 * Eşikler: 2026-10-13 derlemesi (WP4, turbopackChunking requestCost 2M / minChunkSize 400k) ölçümü + %10, yukarı yuvarlı
 * (ölçüm: /app 225.2 · /app/musteriler 267.8 · /app/portfoyler 246.1 · /admin 236.9 KB gzip).
 * Ölçüm tablosu: docs/HAFIZA.md "Panel JS bütçesi". Bilinçli büyüme olursa yeniden ölç, tabloyu ve burayı birlikte güncelle.
 */
export const BUDGET: Record<(typeof BUDGET_ROUTES)[number], { gzipKb: number }> = {
  "/app": { gzipKb: 248 },
  "/app/musteriler": { gzipKb: 295 },
  "/app/portfoyler": { gzipKb: 271 },
  "/admin": { gzipKb: 261 },
};
/** Kopya modül oranı üst sınırı (kabul ölçütü < %10). */
export const MAX_DUP_RATIO = 0.1;
/** Rota başına ilk yük istek sayısı üst sınırı (JS + CSS). */
export const MAX_REQUESTS = 60;

export type RouteLoad = {
  route: string;
  jsFiles: string[];
  cssFiles: string[];
  rawKb: number;
  gzipKb: number;
  dupRatio: number;
  requests: number;
};

/** page_client-reference-manifest.js → nesne (globalThis.__RSC_MANIFEST["/x/page"] = {...};). */
export function parseClientReferenceManifest(src: string): Record<string, unknown> | null {
  const eq = src.indexOf("] = {");
  if (eq < 0) return null;
  const body = src.slice(eq + 4).trim().replace(/;\s*$/, "");
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeChunk(f: string): string {
  return f.replace(/^\/?_next\//, "").replace(/^\//, "");
}

/** Rotanın ilk yük dosyaları: rootMainFiles ∪ entryJSFiles değerleri (sıra korunur, tekil). */
export function initialFiles(
  manifest: Record<string, unknown>,
  rootMainFiles: string[],
): { js: string[]; css: string[] } {
  const js = new Set<string>(rootMainFiles.map(normalizeChunk));
  const css = new Set<string>();
  const entryJs = (manifest.entryJSFiles ?? {}) as Record<string, unknown>;
  for (const files of Object.values(entryJs)) {
    if (Array.isArray(files)) for (const f of files) if (typeof f === "string" && f.endsWith(".js")) js.add(normalizeChunk(f));
  }
  const entryCss = (manifest.entryCSSFiles ?? {}) as Record<string, unknown>;
  for (const files of Object.values(entryCss)) {
    if (!Array.isArray(files)) continue;
    for (const f of files) {
      const p = typeof f === "string" ? f : (f as { path?: unknown })?.path;
      if (typeof p === "string" && p.endsWith(".css")) css.add(normalizeChunk(p));
    }
  }
  return { js: [...js], css: [...css] };
}

const MODULE_RE = /[,[](\d{3,7}),(?:\w|\([\w,]*\))=>\{/g;

/** Kopya modül oranı: aynı modül kimliği birden çok dosyada → (n-1) × modül baytı / toplam bayt. */
export function duplicateRatio(sources: string[]): number {
  const seen = new Map<string, { n: number; len: number }>();
  let total = 0;
  for (const s of sources) {
    total += s.length;
    const idx: Array<[number, string]> = [];
    for (const m of s.matchAll(MODULE_RE)) idx.push([m.index, m[1]!]);
    const inFile = new Set<string>();
    for (let i = 0; i < idx.length; i++) {
      const [at, id] = idx[i]!;
      if (inFile.has(id)) continue;
      inFile.add(id);
      const len = (i + 1 < idx.length ? idx[i + 1]![0] : s.length) - at;
      const e = seen.get(id);
      if (e) e.n++;
      else seen.set(id, { n: 1, len });
    }
  }
  if (total === 0) return 0;
  let dup = 0;
  for (const e of seen.values()) if (e.n > 1) dup += (e.n - 1) * e.len;
  return dup / total;
}

export type Violation = { route: string; message: string };

/** Ölçümü bütçeyle karşılaştırır; ihlalleri döndürür (yan etkisiz). */
export function checkBudget(loads: RouteLoad[]): Violation[] {
  const out: Violation[] = [];
  for (const l of loads) {
    const limit = BUDGET[l.route as keyof typeof BUDGET];
    if (limit && l.gzipKb > limit.gzipKb) out.push({ route: l.route, message: `ilk yük ${l.gzipKb.toFixed(1)} KB gzip > ${limit.gzipKb} KB` });
    if (l.dupRatio >= MAX_DUP_RATIO) out.push({ route: l.route, message: `kopya modül oranı %${(l.dupRatio * 100).toFixed(1)} ≥ %${MAX_DUP_RATIO * 100}` });
    if (l.requests > MAX_REQUESTS) out.push({ route: l.route, message: `ilk yük istek ${l.requests} > ${MAX_REQUESTS}` });
  }
  return out;
}

/** Bir rotanın ilk yükünü .next çıktısından ölçer; manifest yoksa null. */
export function measureRoute(nextDir: string, route: string, rootMainFiles: string[]): RouteLoad | null {
  const mf = path.join(nextDir, "server", "app", route.replace(/^\//, ""), "page_client-reference-manifest.js");
  if (!existsSync(mf)) return null;
  const manifest = parseClientReferenceManifest(readFileSync(mf, "utf8"));
  if (!manifest) return null;
  const { js, css } = initialFiles(manifest, rootMainFiles);
  const sources: string[] = [];
  let raw = 0;
  let gz = 0;
  for (const f of js) {
    const full = path.join(nextDir, f);
    if (!existsSync(full)) continue;
    const buf = readFileSync(full);
    raw += buf.length;
    gz += gzipSync(buf, { level: 6 }).length;
    sources.push(buf.toString("utf8"));
  }
  return {
    route,
    jsFiles: js,
    cssFiles: css,
    rawKb: raw / 1024,
    gzipKb: gz / 1024,
    dupRatio: duplicateRatio(sources),
    requests: js.length + css.length,
  };
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function readManifest(nextDir: string, name: string): Record<string, unknown> | null {
  const p = path.join(nextDir, name);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Eski rapor: app-build-manifest / build-manifest `pages` (Next 16 Turbopack'te çoğunlukla boş). */
function legacyReport(nextDir: string, maxKb: number | null): number {
  const sizeCache = new Map<string, number>();
  const jsSize = (file: string): number => {
    const cached = sizeCache.get(file);
    if (cached !== undefined) return cached;
    const full = path.join(nextDir, file);
    const size = existsSync(full) ? statSync(full).size : 0;
    sizeCache.set(file, size);
    return size;
  };
  type Row = { route: string; kb: number; files: number };
  const rows: Row[] = [];
  const addRoutes = (map: unknown) => {
    if (!map || typeof map !== "object") return;
    for (const [route, files] of Object.entries(map as Record<string, unknown>)) {
      if (!Array.isArray(files)) continue;
      const js = [...new Set(files.filter((f): f is string => typeof f === "string" && f.endsWith(".js")))];
      if (js.length === 0) continue;
      rows.push({ route, kb: js.reduce((sum, f) => sum + jsSize(f), 0) / 1024, files: js.length });
    }
  };
  addRoutes(readManifest(nextDir, "app-build-manifest.json")?.pages);
  addRoutes(readManifest(nextDir, "build-manifest.json")?.pages);

  if (rows.length === 0) {
    console.log(
      "Route başına JS bilgisi bulunamadı (.next içinde app-build-manifest.json / build-manifest.json yok " +
        "veya bu Next sürümü üretmiyor). Panel rotaları için --warn / --gate kullanın.",
    );
    return 0;
  }
  rows.sort((a, b) => b.kb - a.kb);
  console.log("Route başına JS (sıkıştırılmamış, paylaşılan parçalar dahil)");
  console.log("-".repeat(72));
  for (const r of rows) console.log(`${r.kb.toFixed(1).padStart(9)} KB  ${String(r.files).padStart(3)} dosya  ${r.route}`);
  console.log("-".repeat(72));
  console.log(`Toplam route: ${rows.length}; en büyük: ${rows[0]!.route} (${rows[0]!.kb.toFixed(1)} KB)`);

  if (maxKb !== null) {
    const over = rows.filter((r) => r.kb > maxKb);
    if (over.length > 0) {
      console.error(`\n--max-kb=${maxKb} aşan ${over.length} route:`);
      for (const r of over) console.error(`  ${r.kb.toFixed(1)} KB  ${r.route}`);
      return 1;
    }
    console.log(`Tüm route'lar ${maxKb} KB altında.`);
  }
  return 0;
}

function budgetReport(nextDir: string, gate: boolean): number {
  const rootMain = readManifest(nextDir, "build-manifest.json")?.rootMainFiles;
  const rootMainFiles = Array.isArray(rootMain) ? rootMain.filter((f): f is string => typeof f === "string") : [];
  const loads: RouteLoad[] = [];
  for (const route of BUDGET_ROUTES) {
    const l = measureRoute(nextDir, route, rootMainFiles);
    if (l) loads.push(l);
    else console.log(`(${route}: page_client-reference-manifest.js bulunamadı; atlandı)`);
  }
  console.log("\nPanel ilk yük bütçesi (gzip; kök + layout zinciri + sayfa)");
  console.log("-".repeat(72));
  for (const l of loads) {
    const limit = BUDGET[l.route as keyof typeof BUDGET]?.gzipKb;
    console.log(
      `${l.gzipKb.toFixed(1).padStart(7)} KB gz /${String(limit).padStart(4)}  ${l.rawKb.toFixed(0).padStart(5)} KB ham  ` +
        `kopya %${(l.dupRatio * 100).toFixed(1).padStart(4)}  istek ${String(l.requests).padStart(2)} (${l.jsFiles.length} js)  ${l.route}`,
    );
  }
  console.log("-".repeat(72));
  if (loads.length === 0) {
    console.error("Ölçülecek panel rotası bulunamadı (derleme eksik?).");
    return gate ? 1 : 0;
  }
  const violations = checkBudget(loads);
  if (violations.length === 0) {
    console.log("Bütçe içinde.");
    return 0;
  }
  const log = gate ? console.error : console.warn;
  log(`\nBütçe aşımı (${violations.length}):`);
  for (const v of violations) log(`  ${v.route}: ${v.message}`);
  return gate ? 1 : 0;
}

function main(): number {
  const nextDir = arg("next-dir") ?? path.join(process.cwd(), ".next");
  const maxArg = arg("max-kb");
  const maxKb = maxArg !== undefined ? Number(maxArg) : null;
  if (maxKb !== null && (!Number.isFinite(maxKb) || maxKb <= 0)) {
    console.error(`Geçersiz --max-kb değeri: ${maxArg}`);
    return 2;
  }
  const gate = process.argv.includes("--gate");
  const warn = process.argv.includes("--warn");
  if (!existsSync(nextDir)) {
    console.log(".next klasörü yok; önce `npm run build` çalıştırın. Rapor üretilmedi.");
    return gate ? 1 : 0;
  }
  let code = legacyReport(nextDir, maxKb);
  if (gate || warn) code = Math.max(code, budgetReport(nextDir, gate));
  return code;
}

// Doğrudan çalıştırıldığında (tsx) rapor; test içe aktarımında yan etkisiz.
if (/check-bundle-budget\.ts$/.test(process.argv[1] ?? "")) process.exit(main());
