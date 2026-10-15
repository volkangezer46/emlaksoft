/**
 * check-link-contracts.ts
 *
 * Tıklanabilirlik kontratı doğrulayıcı:
 *   - src/app, src/lib ve src/components altında üretilen her iç link (/app/... veya /admin/...) toplanır (string
 *     literal + template literal; test dosyaları hariç). Sorgusuz bağlantılar da denetlenir: hedef rota (page.tsx ya da
 *     route.ts) yoksa uyumsuzluktur (silinen rotaya kalan bağlantı / takma ad yakalanır).
 *   - Query parametresi taşıyan linklerde hedef rotanın page.tsx dosyasında bu parametrenin gerçekten okunduğunu
 *     doğrular (searchParams tip bildirimi, destructuring veya sp.X erişimi).
 *   - Uyumsuzlukları tablo halinde basar; varsa exit code 1 döner.
 *
 * Kullanım: npm run check:links
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(process.cwd(), "src", "app");
/** Link taranan kökler (rota tablosu yalnız src/app'ten kurulur). */
const SCAN_ROOTS = ["app", "lib", "components"].map((d) => join(process.cwd(), "src", d));

// ---------------------------------------------------------------------------
// ALLOWLIST — bilinçli istisnalar. Her giriş gerekçeli olmalı.
// Anahtar: "<rota>::<param>"  (rota, dinamik segmentler [x] normalize edilmiş)
// ---------------------------------------------------------------------------
const ALLOWLIST: Record<string, string> = {
  // Hedef bir GET route handler (indirme ucu); `bicim` paramını route.ts okur, betik yalnız page.tsx'i tarar.
  "/admin/analiz-tarifesi/piyasa-verisi::bicim": "route handler — EF piyasa verisi CSV/JSON indirme biçimi",
  // Kira yenileme bildiriminin mükerrer freni: href'teki ?yenileme={yıl}
  // işlevsel filtre değil, notifications tablosunda yıl bazlı tekillik
  // marker'ı (cron her yıl tek bildirim atsın diye). Hedef sayfa okumaz.
  "/app/kiralama/[id]::yenileme": "dedupe marker — kira-tahakkuk cron bildirimi",
  // Haftalık özet bildiriminin hafta bazlı tekillik marker'ı — hedef okumaz.
  "/app/raporlar::hafta": "dedupe marker — haftalik-ozet cron bildirimi",
  // Hesaplayıcı sayfası searchParams'ı calculator-view / investment-view bileşenlerine geçirir;
  // ?portfoy= o alt görünümlerde okunur (sayfa dosyasında literal olarak geçmez).
  "/app/hesaplayici::portfoy": "param page.tsx'ten alt görünüm bileşenlerine iletilir ve orada okunur",
  "/app/portfoy-avi::danisman": "searchParams src/lib/prospecting ayrıştırıcısına (FsboRawParams) iletilir ve orada okunur (sahipsiz | danışman id)",
  "/app/giderler::duzenle": "param page.tsx'ten Faturalar sekmesine (faturalar-tab.tsx) iletilir ve orada okunur",
  // Fatura defteri searchParams'ı `LedgerParams` tip adıyla alır (literal anahtar yok); süzgeçler saf ayrıştırıcılarda okunur.
  // Kabul edilen değerler billing-home-links-contract.test.ts ile kilitli.
  "/admin/billing/defter::durum": "searchParams parseLedgerFilter'a (src/lib/accounting/ledger.ts, LEDGER_STATUS_FILTERS) iletilir ve orada okunur",
  "/admin/billing/defter::donem": "searchParams resolvePeriod'a (src/lib/accounting/period.ts; bu-ay | gecen-ay | ozel | tumu) iletilir ve orada okunur",
};

// ---------------------------------------------------------------------------
// 1) Rota tablosu: src/app altındaki tüm page.tsx dosyaları
// ---------------------------------------------------------------------------
type Route = { pattern: string[]; pagePath: string };
/** Yalnız yol varlığı için geçerli hedefler: GET dışı rota işleyicileri de (ör. yükleme ucu POST) bağlantı hedefidir. */
const anyRoutes: Route[] = [];

function collectRoutes(dir: string, segs: string[], out: Route[]) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("_")) continue; // private folder
      // Route group '(...)' URL'e yansımaz
      const next = entry.startsWith("(") ? segs : [...segs, entry];
      collectRoutes(full, next, out);
    } else if (entry === "page.tsx" || entry === "page.ts") {
      out.push({ pattern: segs, pagePath: full });
    } else if (entry === "route.ts" && /export\s+async\s+function\s+GET\b/.test(readFileSync(full, "utf8"))) {
      // GET rota işleyicisi (ör. /app/ara?tel= kısayolu, vCard indirme) da geçerli bağlantı hedefidir.
      out.push({ pattern: segs, pagePath: full });
    } else if (entry === "route.ts") {
      anyRoutes.push({ pattern: segs, pagePath: full });
    }
  }
}

const routes: Route[] = [];
collectRoutes(ROOT, [], routes);

function matchRoute(pathSegs: string[], pool: readonly Route[] = routes): Route | undefined {
  // Önce tam eşleşme, sonra dinamik segment ([id]) eşleşmesi
  const candidates = pool.filter((r) => r.pattern.length === pathSegs.length);
  const score = (r: Route) =>
    r.pattern.reduce((acc, seg, i) => {
      if (seg === pathSegs[i]) return acc + 2; // literal
      if (seg.startsWith("[")) return acc + 1; // dinamik segment her şeyi karşılar
      return -1000;
    }, 0);
  let best: Route | undefined;
  let bestScore = -1;
  for (const r of candidates) {
    const s = score(r);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  return bestScore >= 0 ? best : undefined;
}

// ---------------------------------------------------------------------------
// 2) Hedef sayfanın okuduğu paramlar
// ---------------------------------------------------------------------------
type Target = { params: Set<string>; acceptsAll: boolean; hasSearchParams: boolean };
const targetCache = new Map<string, Target>();

function targetParams(pagePath: string): Target {
  const cached = targetCache.get(pagePath);
  if (cached) return cached;

  const src = readFileSync(pagePath, "utf8");
  const params = new Set<string>();
  let acceptsAll = false;
  const hasSearchParams = /searchParams/.test(src);

  // a) Tip bildirimi: searchParams?: Promise<{ a?: string; b?: string }>
  for (const m of src.matchAll(/searchParams\??\s*:\s*Promise<\{([\s\S]*?)\}>/g)) {
    for (const key of m[1].matchAll(/([A-Za-z_$][\w$]*)\??\s*:/g)) params.add(key[1]);
    if (/\[\s*key\s*:/.test(m[1])) acceptsAll = true;
  }
  // Record<string, ...> → tüm paramları kabul eder
  if (/searchParams\??\s*:\s*Promise<\s*Record</.test(src)) acceptsAll = true;

  // b) Destructuring: const { a = "", b } = (await searchParams) ?? {}
  for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*\(?await\s+searchParams/g)) {
    for (const part of m[1].split(",")) {
      const key = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (key) params.add(key[1]);
    }
  }

  // a2) Rota işleyicisi: req.nextUrl.searchParams.get("X") / new URL(req.url).searchParams.get("X")
  for (const m of src.matchAll(/searchParams\.get\(\s*["']([\w-]+)["']\s*\)/g)) params.add(m[1]);

  // a3) Adlandırılmış tip: searchParams?: Promise<Sp> / searchParams: SearchParams → aynı dosyadaki `type Sp = {...}`
  //     (ya da `type SearchParams = Promise<{...}>`) anahtarları.
  for (const m of src.matchAll(/searchParams\??\s*:\s*(?:Promise<\s*)?([A-Z][\w$]*)\b/g)) {
    const decl = new RegExp(`(?:type|interface)\\s+${m[1]}\\s*=?\\s*(?:Promise<\\s*)?\\{([\\s\\S]*?)\\}`).exec(src);
    if (!decl) continue;
    for (const key of decl[1].matchAll(/([A-Za-z_$][\w$]*)\??\s*:/g)) params.add(key[1]);
    if (/\[\s*key\s*:/.test(decl[1])) acceptsAll = true;
  }

  // c) sp.X erişimi (sp = await searchParams ya da Promise.all ile çözülen `sp` yaygın deseni)
  if (/=\s*\(?await\s+searchParams/.test(src) || /\[\s*sp\b[^\]]*\]\s*=\s*await\s+Promise\.all\(\s*\[\s*searchParams/.test(src)) {
    for (const m of src.matchAll(/\bsp\.([A-Za-z_$][\w$]*)/g)) params.add(m[1]);
  }

  // d) Rota dizinindeki client bileşenler: useSearchParams().get("X")
  //    (ör. musteriler/[id]/customer-360-tabs.tsx ?tab= paramını URL'den okur)
  const dir = join(pagePath, "..");
  for (const entry of readdirSync(dir)) {
    if (!/\.tsx?$/.test(entry) || entry.startsWith("page.")) continue;
    const sibling = readFileSync(join(dir, entry), "utf8");
    if (!/useSearchParams/.test(sibling)) continue;
    for (const m of sibling.matchAll(/\.get\(\s*["']([\w-]+)["']\s*\)/g)) params.add(m[1]);
  }

  const t = { params, acceptsAll, hasSearchParams: hasSearchParams || params.size > 0 };
  targetCache.set(pagePath, t);
  return t;
}

// ---------------------------------------------------------------------------
// 3) Link üretimlerini tara
// ---------------------------------------------------------------------------
type Link = { file: string; line: number; path: string; query: string };

function walkFiles(dir: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, out);
    // Test dosyaları bilinçli olarak OLMAYAN rotaları da anar (silinen rota sözleşmeleri); taranmaz.
    else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.(test|spec)\.[jt]sx?$/.test(entry)) out.push(full);
  }
}

const files: string[] = [];
for (const root of SCAN_ROOTS) walkFiles(root, files);

// String literal ("..."/'...') ve template literal (`...`) içindeki
// /app/... veya /admin/... + ?query kalıpları. Basit ama kapsayıcı.
const LITERALS = [
  /"(\/(?:app|admin)\/[^"?#\s]*)\?([^"#]*)/g,
  /'(\/(?:app|admin)\/[^'?#\s]*)\?([^'#]*)/g,
  /`(\/(?:app|admin)\/[^`?#\s]*)\?([^`#]*)/g,
];

// Sorgusuz bağlantılar: dizgenin TAMAMI yol (+ isteğe bağlı #çapa) olmalı; ön ek karşılaştırmaları ("/admin/" ile
// başlıyor mu) ve yol parçaları bu kalıba girmez (sonu "/" ya da "-" olanlar atlanır).
const PATH_ONLY = [/"(\/(?:app|admin)(?:\/[^"?#\s]*)?)(?:#[^"\s]*)?"/g, /'(\/(?:app|admin)(?:\/[^'?#\s]*)?)(?:#[^'\s]*)?'/g, /`(\/(?:app|admin)(?:\/[^`?#\s]*)?)(?:#[^`\s]*)?`/g];

const links: Link[] = [];
const pathLinks: Omit<Link, "query">[] = [];
/** Sorgusuz tarama yalnız kodda: JSDoc blokları ve satır başı `//` yorumları (örnek/anlatım yolları) atlanır. */
const stripComments = (src: string) => src.replace(/\/\*\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, (c) => c.replace(/[^\n]/g, " "));

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const code = stripComments(src);
  for (const re of LITERALS) {
    for (const m of src.matchAll(re)) {
      const line = src.slice(0, m.index).split("\n").length;
      links.push({ file, line, path: m[1], query: m[2] });
    }
  }
  for (const re of PATH_ONLY) {
    for (const m of code.matchAll(re)) {
      // Ön ek / parça (".../" ya da "...-" ile biten) ve yer tutucu ("/app/...", "rota::param") bağlantı değildir.
      if ((/[/-]$/.test(m[1]) && m[1].length > 5) || m[1].includes("...") || m[1].includes("::")) continue;
      const line = code.slice(0, m.index).split("\n").length;
      pathLinks.push({ file, line, path: m[1] });
    }
  }
}

function paramNames(query: string): string[] {
  // '${...}' ifadelerini nötrle, '&' ile böl, 'ad=' kalıbını çek
  const cleaned = query.replace(/\$\{[^}]*\}/g, "\u0000");
  const names: string[] = [];
  for (const piece of cleaned.split("&")) {
    const m = piece.match(/^([A-Za-z_][\w-]*)=/);
    if (m) names.push(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// 4) Eşleştir + raporla
// ---------------------------------------------------------------------------
type Issue = { route: string; param: string; source: string; note: string };
const issues: Issue[] = [];
const allowUsed = new Set<string>();
let checkedParams = 0;

for (const link of links) {
  const segs = link.path.split("/").filter(Boolean).map((s) => (s.includes("${") ? "[dyn]" : s));
  const route = matchRoute(segs);
  const rel = relative(process.cwd(), link.file).split(sep).join("/");
  const source = `${rel}:${link.line}`;

  if (!route) {
    issues.push({ route: link.path, param: "-", source, note: "rota bulunamadı (page.tsx yok)" });
    continue;
  }
  const routeStr = "/" + route.pattern.join("/");
  const target = targetParams(route.pagePath);

  for (const p of paramNames(link.query)) {
    checkedParams++;
    const allowKey = `${routeStr}::${p}`;
    if (ALLOWLIST[allowKey]) {
      allowUsed.add(allowKey);
      continue;
    }
    if (target.acceptsAll || target.params.has(p)) continue;
    issues.push({
      route: routeStr,
      param: p,
      source,
      note: target.hasSearchParams ? "hedef bu paramı okumuyor" : "hedef searchParams hiç okumuyor",
    });
  }
}

// Sorgusuz bağlantılar: yalnız hedef rotanın varlığı (page.tsx / route.ts).
for (const link of pathLinks) {
  const segs = link.path.split("/").filter(Boolean).map((s) => (s.includes("${") ? "[dyn]" : s));
  if (matchRoute(segs) || matchRoute(segs, anyRoutes)) continue;
  const rel = relative(process.cwd(), link.file).split(sep).join("/");
  issues.push({ route: link.path, param: "-", source: `${rel}:${link.line}`, note: "rota bulunamadı (page.tsx/route.ts yok)" });
}

// Tekrarlanan (rota,param) girişlerini kaynaklarıyla grupla
const grouped = new Map<string, Issue[]>();
for (const i of issues) {
  const key = `${i.route}::${i.param}`;
  grouped.set(key, [...(grouped.get(key) ?? []), i]);
}

console.log(`Link kontrat kontrolü — ${links.length} sorgulu + ${pathLinks.length} sorgusuz link, ${checkedParams} param kontrol edildi, ${routes.length} rota.\n`);

if (grouped.size === 0) {
  console.log("UYUMSUZLUK YOK ✔");
} else {
  console.log("UYUMSUZLUKLAR:");
  console.log("ROTA".padEnd(40) + "PARAM".padEnd(14) + "KAYNAK");
  for (const [, list] of grouped) {
    const first = list[0];
    console.log(first.route.padEnd(40) + first.param.padEnd(14) + `${first.source}  (${first.note})`);
    for (const extra of list.slice(1)) console.log("".padEnd(54) + extra.source);
  }
}

const staleAllow = Object.keys(ALLOWLIST).filter((k) => !allowUsed.has(k));
if (staleAllow.length) {
  console.log("\nUYARI — kullanılmayan allowlist girişleri: " + staleAllow.join(", "));
}
if (allowUsed.size) {
  console.log("\nAllowlist ile geçilenler:");
  for (const k of allowUsed) console.log(`  ${k} — ${ALLOWLIST[k]}`);
}

process.exit(grouped.size === 0 ? 0 : 1);
