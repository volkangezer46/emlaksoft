/**
 * Bundle boyutu raporu + rota bazlı ilk yük bütçesi.
 *
 *   npm run build && npm run check:bundle               # yalnız rapor (eşik YOK; eski davranış)
 *   npm run check:bundle -- --max-kb=350                # opsiyonel: route başına sıkıştırılmamış JS üst sınırı
 *   npm run check:bundle -- --warn                      # + panel rotaları ilk yük bütçesi; aşımı YAZAR, çıkış 0
 *   npm run check:bundle -- --gate                      # + aynı bütçe; aşımda çıkış kodu 1 (yayın kancası WP3'te).
 *                                                         #   Ölçülemeyen rota (manifest yok) ya da diskte olmayan chunk da
 *                                                         #   kapıda ihlaldir: ölçülmeyen rota geçmiş sayılmaz.
 *   npm run check:bundle -- --next-dir=/yol/.next       # başka bir derleme çıktısını ölç (önce/sonra karşılaştırma)
 *   npm run check:bundle -- --static-html=/yol/ana.html # statik ana sayfa HTML'ini dosyadan ölç (ör. canlıdan curl)
 *
 * STATİK ANA SAYFA HTML BÜTÇESİ (F1; src/lib/perf/budgets.ts): gzip ≤ 80 KB, ham ≤ 360 KB. --warn/--gate iken derleme
 * çıktısındaki ön çizilmiş ana sayfa (.next/server/app/index.html) rota işleyicisiyle AYNI dönüşümden geçirilir
 * (src/lib/static-home/transform.ts: Next çalışma zamanı ayıklanır, kullanılan CSS gömülür, runtime.js eklenir) ve
 * gerçekten ölçülür. Fiyat verisi (birkaç KB JSON) derlemede yoktur; canlı ölçüm için --static-html. Aşım ya da
 * ölçülemeyen HTML --gate'te çıkış 1'dir.
 *
 * İLK YÜK ÖLÇÜMÜ (Next 16 + Turbopack): app-build-manifest.json artık üretilmiyor; rota başına istemci JS'i
 * .next/server/app/<rota>/page_client-reference-manifest.js içindeki `entryJSFiles` (kök + layout zinciri + sayfa +
 * error/loading/not-found sınırları) ile build-manifest.json `rootMainFiles` birleşimidir. Boyut gzip (seviye 6) ile ölçülür.
 * KOPYA MODÜL ORANI: aynı turbopack modül kimliğinin (`,123456,e=>{` / `[123456,(e,t)=>{`) rotanın ilk yük dosyalarında
 * birden fazla kez geçtiği bayt / toplam bayt (konsey/dup.mjs mantığı). İSTEK: ilk yük JS + CSS dosya sayısı.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { STATIC_HTML_BUDGET, checkStaticHtmlBudget, type BudgetViolation } from "../src/lib/perf/budgets";
import { measureHtml, type HtmlMeasure } from "../src/lib/perf/measure-html";
import { STATIC_ROUTES } from "../src/lib/static-home/registry";
import { buildStaticHome } from "../src/lib/static-home/transform";

/** Bütçe ölçülen rotalar (ana sayfa statik HTML; Next JS'i yok → hedef değil). Dinamik bölüm klasör adıyla yazılır. */
export const BUDGET_ROUTES = [
  "/app",
  "/app/musteriler",
  "/app/portfoyler",
  "/admin",
  "/app/portfoyler/[id]",
  "/vitrin/[slug]/[ilan]",
  "/app/ice-aktarma",
  "/app/finans",
] as const;

/**
 * Eşikler: 2026-10-13 ilk yük inceltmesi sonrası derleme ölçümü + ~%5, yukarı yuvarlı
 * (ölçüm: /app 190.9 · /app/musteriler 193.6 · /app/portfoyler 198.4 · /admin 181.2 KB gzip; önceki: 221.6 · 269.7 · 248.0 · 233.7).
 * Ölçüm tablosu: docs/HAFIZA.md "Panel JS bütçesi". Bilinçli büyüme olursa yeniden ölç, tabloyu ve burayı birlikte güncelle.
 *
 * `initial: true` = BAŞLANGIÇ eşiği (2026-10-16): derlemesiz eklendi, ölçülmedi. Değer mevcut panel ölçeğinin (~190-210 KB)
 * üstünde, gevşek tutuldu (detay/sihirbaz sayfaları daha çok istemci bileşeni taşır). Bu rotalarda aşım ve ölçüm eksiği
 * --gate'te de yalnız UYARIDIR (çıkış kodunu değiştirmez). İlk derleme ölçümünden sonra eşik ölçüm + ~%5'e çekilip bayrak
 * kaldırılır; o andan itibaren kapı onları da durdurur.
 */
export const BUDGET: Record<(typeof BUDGET_ROUTES)[number], { gzipKb: number; initial?: boolean }> = {
  "/app": { gzipKb: 201 },
  "/app/musteriler": { gzipKb: 204 },
  "/app/portfoyler": { gzipKb: 209 },
  "/admin": { gzipKb: 191 },
  "/app/portfoyler/[id]": { gzipKb: 260, initial: true },
  "/vitrin/[slug]/[ilan]": { gzipKb: 240, initial: true },
  // 2026-10-17 ölçüm 215.3 KB (sihirbaz bölündü: ayrıştırıcılar, önizleme tabloları, açılır seçiciler dinamik) + ~%5.
  "/app/ice-aktarma": { gzipKb: 226 },
  "/app/finans": { gzipKb: 240, initial: true },
};

/** Başlangıç (henüz ölçülmemiş) eşikli rota mı: ihlali kapıyı düşürmez, uyarı olarak yazılır. */
export function isInitialBudget(route: string): boolean {
  return BUDGET[route as keyof typeof BUDGET]?.initial === true;
}
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
  /** Manifestte geçen ama diskte bulunmayan JS dosyaları (ölçüme girmedi; boyut eksik ölçülmüş olabilir). */
  missingFiles: string[];
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
const MANIFEST_FILE = "page_client-reference-manifest.js";

/**
 * Rotanın manifest dosyası. Rota grupları (`(bugun)` gibi parantezli klasörler) URL'de görünmez: `/app` ana ekranı
 * `server/app/app/(bugun)/page_client-reference-manifest.js` altındadır. Önce düz yol, yoksa her düzeyde grup klasörleri
 * denenir (ilk eşleşme). Bulunamazsa null.
 */
export function routeManifestPath(nextDir: string, route: string): string | null {
  const segments = route.split("/").filter(Boolean);
  const walk = (dir: string, rest: string[]): string | null => {
    if (rest.length === 0) {
      const direct = path.join(dir, MANIFEST_FILE);
      if (existsSync(direct)) return direct;
    } else {
      const next = path.join(dir, rest[0]!);
      if (existsSync(next)) {
        const hit = walk(next, rest.slice(1));
        if (hit) return hit;
      }
    }
    let groups: string[] = [];
    try {
      groups = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\(.+\)$/.test(e.name))
        .map((e) => e.name)
        .sort();
    } catch {
      return null;
    }
    for (const g of groups) {
      const hit = walk(path.join(dir, g), rest);
      if (hit) return hit;
    }
    return null;
  };
  return walk(path.join(nextDir, "server", "app"), segments);
}

export function measureRoute(nextDir: string, route: string, rootMainFiles: string[]): RouteLoad | null {
  const mf = routeManifestPath(nextDir, route);
  if (!mf) return null;
  const manifest = parseClientReferenceManifest(readFileSync(mf, "utf8"));
  if (!manifest) return null;
  const { js, css } = initialFiles(manifest, rootMainFiles);
  const sources: string[] = [];
  const missingFiles: string[] = [];
  let raw = 0;
  let gz = 0;
  for (const f of js) {
    const full = path.join(nextDir, f);
    if (!existsSync(full)) {
      missingFiles.push(f);
      continue;
    }
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
    missingFiles,
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

/**
 * Ölçüm eksikleri: manifesti olmayan bütçe rotası ve diskte olmayan chunk. `--gate` iken ihlal (çıkış 1) — rota adı
 * değişir ya da gruba taşınırsa kapı o rotayı sessizce "geçmiş" saymaz; `--warn` iken yalnız uyarı.
 */
export function coverageGaps(loads: RouteLoad[], routes: readonly string[] = BUDGET_ROUTES): Violation[] {
  const out: Violation[] = [];
  const measured = new Set(loads.map((l) => l.route));
  for (const r of routes) if (!measured.has(r)) out.push({ route: r, message: "page_client-reference-manifest.js bulunamadı; rota ölçülemedi" });
  for (const l of loads) {
    if (l.missingFiles.length > 0) {
      out.push({ route: l.route, message: `${l.missingFiles.length} chunk diskte yok (ölçüme girmedi): ${l.missingFiles.join(", ")}` });
    }
  }
  return out;
}

export function budgetReport(nextDir: string, gate: boolean): number {
  const rootMain = readManifest(nextDir, "build-manifest.json")?.rootMainFiles;
  const rootMainFiles = Array.isArray(rootMain) ? rootMain.filter((f): f is string => typeof f === "string") : [];
  const loads: RouteLoad[] = [];
  for (const route of BUDGET_ROUTES) {
    const l = measureRoute(nextDir, route, rootMainFiles);
    if (l) loads.push(l);
  }
  console.log("\nRota ilk yük bütçesi (gzip; kök + layout zinciri + sayfa; * = başlangıç eşiği)");
  console.log("-".repeat(72));
  for (const l of loads) {
    const limit = BUDGET[l.route as keyof typeof BUDGET]?.gzipKb;
    const mark = isInitialBudget(l.route) ? "*" : " ";
    console.log(
      `${l.gzipKb.toFixed(1).padStart(7)} KB gz /${String(limit).padStart(4)}${mark} ${l.rawKb.toFixed(0).padStart(5)} KB ham  ` +
        `kopya %${(l.dupRatio * 100).toFixed(1).padStart(4)}  istek ${String(l.requests).padStart(2)} (${l.jsFiles.length} js)  ${l.route}`,
    );
  }
  console.log("-".repeat(72));
  if (loads.length === 0) {
    console.error("Ölçülecek panel rotası bulunamadı (derleme eksik?).");
    return gate ? 1 : 0;
  }
  // Başlangıç eşikli rotalar (BUDGET[…].initial) kapıyı düşürmez: ihlal/eksikleri ayrı uyarı olarak yazılır.
  const gaps = coverageGaps(loads);
  const hardGaps = gaps.filter((g) => !isInitialBudget(g.route));
  const all = [...checkBudget(loads), ...gaps];
  const soft = all.filter((v) => isInitialBudget(v.route));
  if (hardGaps.length > 0) {
    const log = gate ? console.error : console.warn;
    log(`\nÖlçüm eksiği (${hardGaps.length})${gate ? "" : " — uyarı"}:`);
    for (const g of hardGaps) log(`  ${g.route}: ${g.message}`);
  }
  if (soft.length > 0) {
    console.warn(`\nBaşlangıç eşikli rota uyarısı (${soft.length}; kapıyı düşürmez, ölçüp eşiği güncelleyin):`);
    for (const v of soft) console.warn(`  ${v.route}: ${v.message}`);
  }
  const violations = [...checkBudget(loads).filter((v) => !isInitialBudget(v.route)), ...(gate ? hardGaps : [])];
  if (violations.length === 0) {
    console.log("Bütçe içinde.");
    return 0;
  }
  const log = gate ? console.error : console.warn;
  log(`\nBütçe aşımı (${violations.length}):`);
  for (const v of violations) log(`  ${v.route}: ${v.message}`);
  return gate ? 1 : 0;
}

/** Derleme çıktısından statik ana sayfa HTML'i (rota işleyicisiyle aynı dönüşüm; fiyat verisi hariç). Yoksa null. */
export function staticHomeFromBuild(nextDir: string, publicDir = path.join(process.cwd(), "public")): string | null {
  const src = path.join(nextDir, "server", "app", "index.html");
  const manifestPath = path.join(publicDir, "statik", "manifest.json");
  if (!existsSync(src) || !existsSync(manifestPath)) return null;
  let m: { runtime: string; islands: Record<string, string>; classTokens: string[] };
  try {
    m = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof m;
  } catch {
    return null;
  }
  const runtimePath = path.join(publicDir, m.runtime.replace(/^\//, ""));
  if (!existsSync(runtimePath)) return null;
  const home = STATIC_ROUTES.find((r) => r.id === "home")!;
  const readStylesheet = (href: string): string | null => {
    const p = href.split("?")[0]!;
    if (!p.startsWith("/_next/static/") || p.includes("..")) return null;
    const full = path.join(nextDir, "static", p.slice("/_next/static/".length));
    return existsSync(full) ? readFileSync(full, "utf8") : null;
  };
  const islands = Object.fromEntries(Object.entries(m.islands).filter(([k]) => (home.islands as readonly string[]).includes(k)));
  const data = JSON.stringify({ islands }).replace(/</g, "\\u003c");
  return buildStaticHome({
    html: readFileSync(src, "utf8"),
    readStylesheet,
    purge: { keepPrefixes: home.keepPrefixes, extraClasses: m.classTokens },
    bodyEnd: `<script type="application/json" id="mk-static">${data}</script><script>${readFileSync(runtimePath, "utf8")}</script>`,
    lazyDom: home.lazyDom === true,
  });
}

/** Statik HTML ölçümü → ihlaller (yan etkisiz). Next betiği kalmışsa da ihlaldir (statik sürümde 0 olmalı). */
export function checkStaticHtml(m: HtmlMeasure): BudgetViolation[] {
  const out = checkStaticHtmlBudget(m);
  if (m.nextScripts > 0) out.push({ metric: "raw", actualKb: 0, limitKb: 0, message: `${m.nextScripts} Next betiği kaldı (statik sürümde 0 olmalı)` });
  return out;
}

export function staticHtmlReport(html: string | null, gate: boolean, sourceLabel: string): number {
  const log = gate ? console.error : console.warn;
  console.log(`\nStatik ana sayfa HTML bütçesi (gzip ≤ ${STATIC_HTML_BUDGET.gzipKb} KB, ham ≤ ${STATIC_HTML_BUDGET.rawKb} KB)`);
  console.log("-".repeat(72));
  if (html === null) {
    log(`Ölçülemedi: ${sourceLabel} (ön çizilmiş ana sayfa / public/statik yok ya da dönüşüm beklenmeyen biçim gördü)`);
    return gate ? 1 : 0;
  }
  const m = measureHtml(html);
  console.log(
    `${(m.gzipBytes / 1024).toFixed(1).padStart(7)} KB gz  ${(m.rawBytes / 1024).toFixed(1).padStart(7)} KB ham  Next betiği ${m.nextScripts}  (${sourceLabel})`,
  );
  const v = checkStaticHtml(m);
  if (v.length === 0) {
    console.log("Statik HTML bütçe içinde.");
    return 0;
  }
  log(`\nStatik HTML bütçe aşımı (${v.length}):`);
  for (const x of v) log(`  /: ${x.message}`);
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
  const staticFile = arg("static-html");
  if (staticFile) {
    code = Math.max(code, staticHtmlReport(existsSync(staticFile) ? readFileSync(staticFile, "utf8") : null, true, staticFile));
  } else if (gate || warn) {
    code = Math.max(code, staticHtmlReport(staticHomeFromBuild(nextDir), gate, "derleme çıktısı (.next/server/app/index.html)"));
  }
  return code;
}

// Doğrudan çalıştırıldığında (tsx) rapor; test içe aktarımında yan etkisiz.
if (/check-bundle-budget\.ts$/.test(process.argv[1] ?? "")) process.exit(main());
