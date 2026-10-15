import { readCached, statKind, walkAll } from "./test-support/src-tree";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_BUDGETS } from "../../scripts/perf/live-budget";

/**
 * Performans bütçesi sözleşmesi (regresyon kilidi): "tüm sayfalar tıklar tıklamaz açılır".
 *
 * (a) /app ve /admin altındaki HER `page.tsx` segmentinin kendi `loading.tsx` dosyası vardır: tıklayınca kabuk + iskelet anında
 *     gelir, veri akıtılır (üst segmentin sınırına güvenmek ince sayfalarda iskeleti yanlış boyutlu gösterirdi).
 * (b) Sayfa dosyalarında, aynı işlev gövdesinde ARDIŞIK ve BİRBİRİNDEN BAĞIMSIZ `await supabase...` sorguları yoktur
 *     (waterfall): bağımsız okumalar `Promise.all` ile tek turda başlar. Statik, basit tespit: aynı girinti düzeyinde art arda
 *     iki `const x = await ...supabase...` ifadesinde ikincisi birincinin değişkenlerini kullanmıyorsa ihlaldir.
 *     Bağımlı zincirler (ikinci sorgu birinciyi kullanır) ihlal değildir. Aşağıdaki liste yalnız GEREKÇELİ istisnadır.
 * (c) "use client" bileşenleri ağır kütüphaneyi (recharts, pdf-lib, fontkit, read-excel-file ...) STATİK içe aktarmaz,
 *     ne doğrudan ne de içe aktarma zinciriyle; yalnız `next/dynamic` / dinamik `import()` (istemci paketi bölünür).
 * (e) İstemci önbelleği: staleTimes.dynamic ≤300 + arka plan tazeleme + tam önceden yükleme + realtime + temizlik sözleşmesi.
 *     `client-bundle-contract.test.ts` (zod / kabuk panelleri) ile birlikte çalışır.
 * (f) Canlı bütçe (SK1/B181): statik metin taraması yetmez (canlıda anon kanal hatası bu sözleşmeler yeşilken yaşandı).
 *     Yayın sonrası bekçi GERÇEK ölçer: scripts/perf/measure-live.mts --watchdog (TTFB/DCL + realtime olay gecikmesi)
 *     ve public smoke; bütçe değerleri scripts/perf/live-budget.ts'te, saha konseyi hedefleriyle eşit.
 */
const ROOT = process.cwd();

const rel = (f: string) => f.slice(ROOT.length + 1).split("\\").join("/");
const SRC_FILES = walkAll(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));

describe("(a) her sayfa segmentinin kendi loading.tsx dosyası var", () => {
  it("/app ve /admin page.tsx segmentleri", () => {
    const missing = [...walkAll(join(ROOT, "src/app/app")), ...walkAll(join(ROOT, "src/app/admin"))]
      .filter((f) => f.endsWith("page.tsx"))
      .filter((f) => statKind(join(dirname(f), "loading.tsx")) !== "file")
      .map((f) => rel(dirname(f)));
    expect(missing, `loading.tsx eksik segmentler (tıklayınca iskelet gelmez):\n${missing.join("\n")}`).toEqual([]);
  });
});

/** (b) Gerekçeli istisnalar: sayfa -> neden bağımsız ardışık okuma kabul edildi. Yeni satır eklemek için gerekçe şart. */
const WATERFALL_ALLOW: Record<string, string> = {};

type Stmt = { start: number; text: string; declared: string[] };

/** Bir dosyadaki "  const x = await ...supabase..." biçimli, girintisi `indent` olan ifadeleri (çok satırlı) çıkarır. */
function awaitStatements(lines: string[]): { indent: number; stmts: Stmt[] }[] {
  const groups = new Map<number, Stmt[]>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^(\s+)(?:const|let)\s+(\{[^=]*\}|\[[^=]*\]|[A-Za-z_$][\w$]*)\s*=\s*await\s+(.*)$/);
    if (!m) continue;
    const indent = m[1]!.length;
    // İfade, aynı girintide yeni satır başlayana ya da kapanan `;` satırına kadar sürer.
    let j = i;
    let text = lines[i]!;
    while (j + 1 < lines.length && !/;\s*$/.test(lines[j]!)) {
      j++;
      text += `\n${lines[j]!}`;
      if (j - i > 60) break;
    }
    const declared = [...m[2]!.matchAll(/[A-Za-z_$][\w$]*/g)].map((d) => d[0]);
    const arr = groups.get(indent) ?? [];
    arr.push({ start: i, text, declared });
    groups.set(indent, arr);
  }
  return [...groups.entries()].map(([indent, stmts]) => ({ indent, stmts }));
}

/** Aynı girintide, satır olarak BİTİŞİK iki ifade: ikincisi birincinin değişkenini kullanmıyor ve ikisi de supabase sorgusu. */
export function findIndependentSequentialAwaits(source: string): number[] {
  const lines = source.split("\n");
  const hits: number[] = [];
  for (const { stmts } of awaitStatements(lines)) {
    for (let k = 1; k < stmts.length; k++) {
      const prev = stmts[k - 1]!;
      const cur = stmts[k]!;
      const prevEnd = prev.start + prev.text.split("\n").length - 1;
      // Aralarında başka kod olmamalı (yalnız boş satır / yorum): kontrol akışı ya da kullanım araya girmiş olabilir.
      const between = lines.slice(prevEnd + 1, cur.start).filter((l) => l.trim() !== "" && !l.trim().startsWith("//"));
      if (between.length > 0) continue;
      const isDb = (t: string) => /\bsupabase\b|\badmin\b|\.from\(|\.rpc\(/.test(t);
      if (!isDb(prev.text) || !isDb(cur.text)) continue;
      const usesPrev = prev.declared.some((d) => new RegExp(`(?<![\\w$.])${d.replace(/\$/g, "\\$")}(?![\\w$])`).test(cur.text));
      if (!usesPrev) hits.push(cur.start + 1);
    }
  }
  return hits;
}

describe("(b) sayfalarda bağımsız ardışık await supabase (waterfall) yok", () => {
  it("tespit yardımcısı bağımsız ardışık sorguyu yakalar, bağımlıyı yakalamaz", () => {
    const bad = [
      "export default async function P() {",
      "  const a = await supabase.from(\"x\").select(\"id\");",
      "  const b = await supabase.from(\"y\").select(\"id\");",
      "}",
    ].join("\n");
    expect(findIndependentSequentialAwaits(bad)).toEqual([3]);
    const dependent = [
      "export default async function P() {",
      "  const a = await supabase.from(\"x\").select(\"id\");",
      "  const b = await supabase.from(\"y\").select(\"id\").in(\"id\", a.data);",
      "}",
    ].join("\n");
    expect(findIndependentSequentialAwaits(dependent)).toEqual([]);
  });

  it("/app ve /admin page.tsx dosyaları", () => {
    const offenders: string[] = [];
    const pages = [...walkAll(join(ROOT, "src/app/app")), ...walkAll(join(ROOT, "src/app/admin"))].filter((f) => f.endsWith("page.tsx"));
    for (const f of pages) {
      const path = rel(f);
      if (WATERFALL_ALLOW[path]) continue;
      const hits = findIndependentSequentialAwaits(readCached(f));
      if (hits.length > 0) offenders.push(`${path}: satır ${hits.join(", ")}`);
    }
    expect(offenders, `Bağımsız ardışık await supabase (Promise.all kullanın ya da gerekçeyle istisna ekleyin):\n${offenders.join("\n")}`).toEqual([]);
  });
});

/** (c) İstemci paketine statik girmemesi gereken ağır paketler. */
const HEAVY_PACKAGES = ["recharts", "pdf-lib", "@pdf-lib/fontkit", "read-excel-file", "exceljs", "xlsx", "jspdf", "html2canvas", "web-push", "pg"];

/** Gerekçeli istisna: bu dosya DOĞRUDAN ağır paketi içe aktarır çünkü yalnız dinamik yükleyicinin hedefidir. */
const HEAVY_ENTRY_ALLOW: Record<string, string> = {
  "src/components/ui/chart.tsx": "recharts sarmalayıcısı; yalnız lazy-charts.tsx (next/dynamic) tarafından yüklenir",
};

const RS_CACHE = new Map<string, string | null>();
function resolveSpec(spec: string, from: string): string | null {
  const key = `${from}function resolveSpec(spec: string, from: string): string | null {${spec}`;
  if (RS_CACHE.has(key)) return RS_CACHE.get(key)!;
  const r = resolveSpecRaw(spec, from);
  RS_CACHE.set(key, r);
  return r;
}
function resolveSpecRaw(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (statKind(p) === "file") return p;
  }
  return null;
}

/** Değer içe aktarmaları (`import type`, yalnız-tip listeleri ve dinamik `import()` hariç). */
const VI_CACHE = new Map<string, string[]>();
function valueImports(text: string): string[] {
  let r = VI_CACHE.get(text);
  if (!r) VI_CACHE.set(text, (r = valueImportsRaw(text)));
  return r;
}
function valueImportsRaw(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) continue;
    const inner = m[2]!.match(/^\{([\s\S]*)\}$/);
    if (inner && inner[1]!.split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(m[3]!);
  }
  for (const s of text.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) out.push(s[1]!);
  return out;
}

const isClientFile = (text: string) => /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(text);

describe("(c) istemci bileşenleri ağır kütüphaneyi statik içe aktarmaz", () => {
  it("doğrudan ve içe aktarma zinciriyle", () => {
    const heavyHit = (spec: string) => HEAVY_PACKAGES.find((p) => spec === p || spec.startsWith(`${p}/`));
    const offenders: string[] = [];
    for (const f of SRC_FILES) {
      const text = readCached(f);
      if (!isClientFile(text)) continue;
      const seen = new Set<string>();
      const walkChain = (file: string, chain: string[]): string | null => {
        if (seen.has(file)) return null;
        seen.add(file);
        const t = readCached(file);
        // "use server" sınırı istemci paketine girmez (eylem referansı olur).
        if (chain.length > 0 && /^\s*["']use server["']/.test(t)) return null;
        for (const spec of valueImports(t)) {
          const pkg = heavyHit(spec);
          if (pkg && !HEAVY_ENTRY_ALLOW[rel(file)]) return [...chain, rel(file), pkg].join(" -> ");
          const next = resolveSpec(spec, file);
          if (next) {
            const hit = walkChain(next, [...chain, rel(file)]);
            if (hit) return hit;
          }
        }
        return null;
      };
      const hit = walkChain(f, []);
      if (hit) offenders.push(hit);
    }
    expect(offenders, `İstemci paketine statik giren ağır paket (next/dynamic kullanın):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("istisna listesindeki dosyalar gerçekten dinamik yükleyiciyle bağlı (statik import yok)", () => {
    for (const allowed of Object.keys(HEAVY_ENTRY_ALLOW)) {
      const importers = SRC_FILES.filter((f) => {
        const text = readCached(f);
        return valueImports(text).some((s) => resolveSpec(s, f) === join(ROOT, allowed));
      }).map(rel);
      expect(importers, `${allowed} statik içe aktarılıyor`).toEqual([]);
    }
  });
});

describe("(d) sunucu Supabase istemcileri takılma korumasından (guardedFetch) geçer", () => {
  // Zaman aşımsız tek bir istek tüm sayfayı 40-80 sn bekletiyordu (2026-10-09). Yeni sunucu istemcisi yalnız bu dosyalarda kurulur.
  const GUARDED = ["src/lib/supabase/server.ts", "src/lib/supabase/middleware.ts", "src/lib/supabase/admin.ts"];
  // Gerekçeli istisna: parola yeniden doğrulama için tek seferlik, oturumsuz istemci (sayfa yolunda değil, yalnız action).
  const EXEMPT = new Set(["src/app/actions/account.ts", "src/app/actions/ownership-transfer.ts", "src/lib/supabase/client.ts"]);
  it("kurucu çağrıları yalnız korumalı dosyalarda", () => {
    const offenders = SRC_FILES.map(rel).filter((f) => {
      if (GUARDED.includes(f) || EXEMPT.has(f)) return false;
      const s = readCached(join(ROOT, f));
      return /\b(createServerClient|createBrowserClient)\(/.test(s) || /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*"@supabase\/supabase-js"/.test(s);
    });
    expect(offenders).toEqual([]);
  });
  it("korumalı dosyalar guardedFetch kullanır", () => {
    for (const f of GUARDED) expect(readCached(join(ROOT, f)), f).toMatch(/global:\s*\{\s*fetch:\s*guardedFetch\s*\}/);
  });
});

describe("(e) istemci router önbelleği: 300 sn + arka plan tazeleme + tam önceden yükleme + realtime", () => {
  const read = (p: string) => readCached(join(ROOT, p));
  it("next.config staleTimes.dynamic 1..300", () => {
    const m = read("next.config.ts").match(/staleTimes:\s*\{\s*dynamic:\s*(\d+)/);
    expect(m, "staleTimes.dynamic tanımlı olmalı").not.toBeNull();
    const v = Number(m![1]);
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(300);
  });
  it("staleTimes.dynamic > 30 ise arka plan tazeleme bileşeni /app ve /admin layout'unda bağlıdır", () => {
    const v = Number(read("next.config.ts").match(/staleTimes:\s*\{\s*dynamic:\s*(\d+)/)![1]);
    if (v <= 30) return;
    for (const f of ["src/app/app/layout.tsx", "src/app/admin/layout.tsx"]) {
      expect(read(f), `${f} <ClientCacheSync> bağlamalı`).toMatch(/<ClientCacheSync\b/);
    }
    const c = read("src/components/app/client-cache-sync.tsx");
    expect(c).toMatch(/router\.refresh\(\)/);
    expect(c).toMatch(/startTransition/);
    expect(c).toMatch(/SCOPE_CHANGE_EVENT/); // kapsam değişiminde temizlik
    expect(c).toMatch(/isGateRedirectAfterRefresh/); // kapı reddinde tam yükleme
    expect(c).toMatch(/window\.location\.replace/);
    expect(c).toMatch(/clearClientCacheState/); // çıkış / kimlik değişiminde temizlik
  });
  it("realtime: ana tablolar tenant filtreli dinlenir", () => {
    const t = read("src/lib/realtime-throttle.ts");
    for (const table of ["customers", "properties", "customer_demands", "appointments", "tasks", "deals", "commissions", "listing_pool_entries", "cash_entries"]) {
      expect(t, `${table} realtime listesinde olmalı`).toContain(`"${table}"`);
    }
    expect(read("src/hooks/use-realtime-refresh.ts")).toMatch(/filter:\s*`tenant_id=eq\.\$\{tenantId\}`/);
    // Abonelik rotaya iner: bileşen tabloları `tablesForPath`'ten alır; genişletilmiş liste ROUTE_TABLES'ta kapsanır
    // (kapsam ayrıntısı realtime-throttle.test.ts'te).
    expect(read("src/components/app/realtime-refresh.tsx")).toMatch(/^\s*tablesForPath,$/m);
    expect(t).toMatch(/ROUTE_TABLES/);
  });
  it("tam önceden yükleme: kind full, kuyruk, ağ kapısı; menü + sekme şeridi + satır bağlantıları bağlı", () => {
    const p = read("src/lib/client-prefetch.ts");
    expect(p).toMatch(/"full"/);
    expect(p).toMatch(/canPrefetchOnThisConnection/);
    expect(read("src/lib/client-cache-policy.ts")).toMatch(/PREFETCH_CONCURRENCY\s*=\s*2/);
    expect(read("src/components/app/app-sidebar.tsx")).toMatch(/useIdlePrefetch\(/);
    expect(read("src/components/app/section-tabs.tsx")).toMatch(/useIdlePrefetch\(/);
    expect(read("src/components/app/intent-link.tsx")).toMatch(/takeViewportBudget/);
  });
});

describe("(f) canlı bütçe ve yayın sonrası bekçi (SK1/B179-B181)", () => {
  const rootRead = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
  it("bütçeler saha konseyi hedefleriyle eşit", () => {
    expect(LIVE_BUDGETS.ttfbP50Ms).toEqual({ "/app": 60, "/admin": 70 });
    expect(LIVE_BUDGETS.realtimeP95Ms).toBe(1000);
    expect(LIVE_BUDGETS.quietLoad1).toBe(4);
    expect(LIVE_BUDGETS.minSamplesForP95).toBe(20);
    expect(LIVE_BUDGETS.minSamplesForMedian).toBe(5);
    expect(LIVE_BUDGETS.ttfbSamples).toBeGreaterThanOrEqual(LIVE_BUDGETS.minSamplesForP95);
    expect(LIVE_BUDGETS.realtimeSamples).toBeGreaterThanOrEqual(LIVE_BUDGETS.minSamplesForP95);
  });
  it("deploy.sh sağlıktan SONRA public smoke + measure-live bekçisini koşar; seri eşiği bütçe modülüyle aynı", () => {
    const d = rootRead("scripts/sunucu/deploy.sh");
    expect(d).toContain("APP_URL=https://emlaksoft.com.tr npm run -s test:e2e:public");
    expect(d).toContain("scripts/perf/measure-live.mts --watchdog");
    expect(d).toContain(`WATCHDOG_GREENS=${LIVE_BUDGETS.consecutiveGreensBeforeRollback}`);
    const call = d.indexOf("if watchdog; then");
    expect(call).toBeGreaterThan(d.indexOf('if [ "$SWAP_RC" = 0 ] && external_ok; then'));
    expect(d.slice(call)).toContain("record_release ok");
  });
  it("measure-live realtime ölçümü gerçek abonelik + INSERT ile; fast.sh flaky kaydı ve 30 sn varsayılan zaman aşımı", () => {
    const m = rootRead("scripts/perf/measure-live.mts");
    expect(m).toMatch(/"postgres_changes"/);
    expect(m).toMatch(/from\("tasks"\)\s*\.insert/);
    expect(m).toContain("evaluateBudgets(");
    const f = rootRead("scripts/gate/fast.sh");
    expect(f).toContain('echo "FLAKY $f"');
    expect(f).toContain("FLAKY_LIMIT:-3");
    expect(f).not.toContain("--testTimeout=300000");
    expect(f).toMatch(/nice -n 19 ionice -c3/);
    const v = rootRead("vitest.config.ts");
    expect(v).toMatch(/testTimeout: 30_000/);
    expect(v).toMatch(/name: "pglite", include: PGLITE_FILES, testTimeout: 120_000/);
    expect(v).toMatch(/maxWorkers:/);
    expect(v).toContain('"src/app/actions/**/*.ts", "src/hooks/**/*.ts"');
  });
});
