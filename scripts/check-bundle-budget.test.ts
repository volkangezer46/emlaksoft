import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BUDGET,
  BUDGET_ROUTES,
  MAX_DUP_RATIO,
  MAX_REQUESTS,
  budgetReport,
  checkBudget,
  checkStaticHtml,
  coverageGaps,
  duplicateRatio,
  initialFiles,
  isInitialBudget,
  measureRoute,
  parseClientReferenceManifest,
  routeManifestPath,
  staticHomeFromBuild,
  staticHtmlReport,
  type RouteLoad,
} from "./check-bundle-budget";
import { measureHtml } from "../src/lib/perf/measure-html";

const load = (over: Partial<RouteLoad> = {}): RouteLoad => ({
  route: "/app",
  jsFiles: [],
  cssFiles: [],
  rawKb: 100,
  gzipKb: 100,
  dupRatio: 0.01,
  requests: 10,
  missingFiles: [],
  ...over,
});

describe("check-bundle-budget", () => {
  it("her bütçe rotası için eşik tanımlı; ana sayfa ölçüm hedefi değil", () => {
    for (const r of BUDGET_ROUTES) expect(BUDGET[r].gzipKb).toBeGreaterThan(0);
    expect(BUDGET_ROUTES).not.toContain("/");
    expect(MAX_DUP_RATIO).toBe(0.1);
    expect(MAX_REQUESTS).toBe(60);
  });

  it("page_client-reference-manifest.js gövdesini çözer", () => {
    const src = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/app/page"] = {"entryJSFiles":{"a":["static/chunks/x.js"]}};`;
    expect(parseClientReferenceManifest(src)).toEqual({ entryJSFiles: { a: ["static/chunks/x.js"] } });
    expect(parseClientReferenceManifest("bozuk")).toBeNull();
  });

  it("ilk yük = rootMainFiles ∪ entryJSFiles (tekil) + entryCSSFiles", () => {
    const files = initialFiles(
      {
        entryJSFiles: { layout: ["static/chunks/a.js", "static/chunks/b.js"], page: ["static/chunks/b.js", "static/chunks/c.js"] },
        entryCSSFiles: { layout: [{ path: "static/chunks/s.css", inlined: false }], page: ["static/chunks/t.css"] },
      },
      ["static/chunks/root.js", "static/chunks/a.js"],
    );
    expect(files.js).toEqual(["static/chunks/root.js", "static/chunks/a.js", "static/chunks/b.js", "static/chunks/c.js"]);
    expect(files.css).toEqual(["static/chunks/s.css", "static/chunks/t.css"]);
  });

  it("kopya modül oranı: aynı turbopack modül kimliği iki dosyada → kopya bayt sayılır", () => {
    const mod = (id: number, body: string) => `,${id},e=>{${body}}`;
    const shared = mod(123456, "x".repeat(80));
    const a = `[${mod(111111, "a".repeat(20)).slice(1)}${shared}`;
    const b = `[${mod(222222, "b".repeat(20)).slice(1)}${shared}`;
    expect(duplicateRatio([a, a.replace("111111", "333333").replace("123456", "444444")])).toBe(0);
    const ratio = duplicateRatio([a, b]);
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.5);
    expect(duplicateRatio([])).toBe(0);
  });

  it("checkBudget: gzip, kopya ve istek eşiklerini ayrı ayrı yakalar", () => {
    expect(checkBudget([load()])).toEqual([]);
    expect(checkBudget([load({ gzipKb: BUDGET["/app"].gzipKb + 1 })])[0]!.message).toMatch(/gzip/);
    expect(checkBudget([load({ dupRatio: MAX_DUP_RATIO })])[0]!.message).toMatch(/kopya/);
    expect(checkBudget([load({ requests: MAX_REQUESTS + 1 })])[0]!.message).toMatch(/istek/);
  });

  const dir = mkdtempSync(path.join(tmpdir(), "bundle-budget-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("measureRoute: manifestten dosyaları okuyup gzip/kopya/istek hesaplar; manifest yoksa null", () => {
    mkdirSync(path.join(dir, "server/app/app"), { recursive: true });
    mkdirSync(path.join(dir, "static/chunks"), { recursive: true });
    writeFileSync(path.join(dir, "static/chunks/root.js"), "console.log(1);".repeat(50));
    writeFileSync(path.join(dir, "static/chunks/p.js"), "console.log(2);".repeat(50));
    writeFileSync(
      path.join(dir, "server/app/app/page_client-reference-manifest.js"),
      `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/app/page"] = ${JSON.stringify({
        entryJSFiles: { "[project]/src/app/app/page": ["static/chunks/p.js", "static/chunks/yok.js"] },
        entryCSSFiles: { "[project]/src/app/app/page": [{ path: "static/chunks/s.css" }] },
      })};`,
    );
    const m = measureRoute(dir, "/app", ["static/chunks/root.js"]);
    expect(m).not.toBeNull();
    expect(m!.jsFiles).toHaveLength(3);
    expect(m!.requests).toBe(4);
    expect(m!.rawKb).toBeCloseTo(1500 / 1024, 5);
    expect(m!.gzipKb).toBeGreaterThan(0);
    expect(m!.gzipKb).toBeLessThan(m!.rawKb);
    expect(m!.dupRatio).toBe(0);
    expect(m!.missingFiles).toEqual(["static/chunks/yok.js"]);
    expect(measureRoute(dir, "/admin", [])).toBeNull();
  });

  it("rota grubu: /app ana ekranı `(bugun)` grubundaysa manifest grup klasöründen bulunur", () => {
    const g = mkdtempSync(path.join(tmpdir(), "bundle-group-"));
    try {
      mkdirSync(path.join(g, "server/app/app/(bugun)"), { recursive: true });
      mkdirSync(path.join(g, "server/app/app/musteriler"), { recursive: true });
      writeFileSync(path.join(g, "server/app/app/(bugun)/page_client-reference-manifest.js"), "x");
      writeFileSync(path.join(g, "server/app/app/musteriler/page_client-reference-manifest.js"), "x");
      expect(routeManifestPath(g, "/app")).toBe(path.join(g, "server/app/app/(bugun)/page_client-reference-manifest.js"));
      expect(routeManifestPath(g, "/app/musteriler")).toBe(path.join(g, "server/app/app/musteriler/page_client-reference-manifest.js"));
      expect(routeManifestPath(g, "/app/yok")).toBeNull();
    } finally {
      rmSync(g, { recursive: true, force: true });
    }
  });

  it("coverageGaps: manifesti olmayan rota ve diskte olmayan chunk ihlal adayıdır", () => {
    const all = BUDGET_ROUTES.map((route) => load({ route }));
    expect(coverageGaps(all)).toEqual([]);
    const gaps = coverageGaps(all.filter((l) => l.route !== "/admin"));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.route).toBe("/admin");
    expect(coverageGaps([...all.slice(1), load({ missingFiles: ["static/chunks/x.js"] })])[0]!.message).toMatch(/diskte yok/);
  });

  it("budgetReport --gate: tek rotanın manifesti eksikse çıkış 1; --warn ise 0", () => {
    const quiet = (fn: () => number) => {
      const orig = [console.log, console.warn, console.error];
      console.log = console.warn = console.error = () => {};
      try {
        return fn();
      } finally {
        [console.log, console.warn, console.error] = orig;
      }
    };
    const d = mkdtempSync(path.join(tmpdir(), "bundle-gate-"));
    try {
      mkdirSync(path.join(d, "static/chunks"), { recursive: true });
      writeFileSync(path.join(d, "static/chunks/p.js"), "console.log(1);");
      // /admin dışındaki rotaların manifesti var, bütçe içinde.
      for (const r of BUDGET_ROUTES.filter((x) => x !== "/admin")) {
        const dirOf = path.join(d, "server/app", r.replace(/^\//, ""));
        mkdirSync(dirOf, { recursive: true });
        writeFileSync(
          path.join(dirOf, "page_client-reference-manifest.js"),
          `globalThis.__RSC_MANIFEST["${r}/page"] = ${JSON.stringify({ entryJSFiles: { p: ["static/chunks/p.js"] } })};`,
        );
      }
      expect(quiet(() => budgetReport(d, true))).toBe(1);
      expect(quiet(() => budgetReport(d, false))).toBe(0);
      const adminDir = path.join(d, "server/app/admin");
      mkdirSync(adminDir, { recursive: true });
      writeFileSync(
        path.join(adminDir, "page_client-reference-manifest.js"),
        `globalThis.__RSC_MANIFEST["/admin/page"] = ${JSON.stringify({ entryJSFiles: { p: ["static/chunks/p.js"] } })};`,
      );
      expect(quiet(() => budgetReport(d, true))).toBe(0);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("başlangıç eşikli rotalar (W8): dinamik bölüm klasörü bulunur; eksik/aşım --gate'i düşürmez", () => {
    const initial = ["/app/portfoyler/[id]", "/vitrin/[slug]/[ilan]", "/app/finans"] as const;
    for (const r of initial) {
      expect(BUDGET_ROUTES).toContain(r);
      expect(isInitialBudget(r)).toBe(true);
      // Ölçülmüş panel ölçeğinin (en büyük 209 KB) altında değil: ilk derlemede yanlış alarm vermesin.
      expect(BUDGET[r].gzipKb).toBeGreaterThanOrEqual(209);
    }
    // /app/ice-aktarma 2026-10-17 derlemede ölçüldü (215,3 KB): artık kesin eşik.
    for (const r of ["/app", "/app/musteriler", "/app/portfoyler", "/admin", "/app/ice-aktarma"]) expect(isInitialBudget(r)).toBe(false);
    const quiet = (fn: () => number) => {
      const orig = [console.log, console.warn, console.error];
      console.log = console.warn = console.error = () => {};
      try {
        return fn();
      } finally {
        [console.log, console.warn, console.error] = orig;
      }
    };
    const d = mkdtempSync(path.join(tmpdir(), "bundle-initial-"));
    try {
      mkdirSync(path.join(d, "static/chunks"), { recursive: true });
      writeFileSync(path.join(d, "static/chunks/p.js"), "console.log(1);");
      const write = (r: string, files: string[]) => {
        const dirOf = path.join(d, "server/app", r.replace(/^\//, ""));
        mkdirSync(dirOf, { recursive: true });
        writeFileSync(
          path.join(dirOf, "page_client-reference-manifest.js"),
          `globalThis.__RSC_MANIFEST["${r}/page"] = ${JSON.stringify({ entryJSFiles: { p: files } })};`,
        );
      };
      // Yalnız ölçülmüş dört rota var: başlangıç rotalarının manifesti yok → kapı yine 0.
      for (const r of BUDGET_ROUTES.filter((x) => !isInitialBudget(x))) write(r, ["static/chunks/p.js"]);
      expect(quiet(() => budgetReport(d, true))).toBe(0);
      // Dinamik bölüm klasörü ([id]) düz yol olarak bulunur.
      write("/app/portfoyler/[id]", ["static/chunks/p.js"]);
      expect(measureRoute(d, "/app/portfoyler/[id]", [])?.jsFiles).toEqual(["static/chunks/p.js"]);
      // Başlangıç rotası istek sınırını aşsa da kapı düşmez; ölçülmüş rota aşarsa düşer.
      const many = Array.from({ length: MAX_REQUESTS + 1 }, (_, i) => `static/chunks/x${i}.js`);
      write("/app/finans", many);
      expect(checkBudget([measureRoute(d, "/app/finans", [])!]).length).toBeGreaterThan(0);
      expect(quiet(() => budgetReport(d, true))).toBe(0);
      write("/admin", many);
      expect(quiet(() => budgetReport(d, true))).toBe(1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("statik HTML eşiği (F1): gzip 80 KB / ham 360 KB; Next betiği kalırsa ihlal", () => {
    const m = (raw: number, gz: number, next = 0) => ({ rawBytes: raw * 1024, gzipBytes: gz * 1024, nextScripts: next, externalScripts: next, inlineScripts: 0 });
    expect(checkStaticHtml(m(360, 80))).toEqual([]);
    expect(checkStaticHtml(m(361, 80)).map((v) => v.metric)).toEqual(["raw"]);
    expect(checkStaticHtml(m(300, 81)).map((v) => v.metric)).toEqual(["gzip"]);
    expect(checkStaticHtml(m(100, 20, 2))[0]?.message).toMatch(/Next betiği/);
  });

  it("derleme çıktısındaki ana sayfayı dönüştürüp ölçer; ölçülemezse --gate 1", () => {
    const quiet = (fn: () => number) => {
      const orig = [console.log, console.warn, console.error];
      console.log = console.warn = console.error = () => {};
      try {
        return fn();
      } finally {
        [console.log, console.warn, console.error] = orig;
      }
    };
    const d = mkdtempSync(path.join(tmpdir(), "static-html-"));
    try {
      const next = path.join(d, ".next");
      const pub = path.join(d, "public");
      expect(staticHomeFromBuild(next, pub)).toBeNull();
      expect(quiet(() => staticHtmlReport(null, true, "yok"))).toBe(1);
      expect(quiet(() => staticHtmlReport(null, false, "yok"))).toBe(0);
      mkdirSync(path.join(next, "server/app"), { recursive: true });
      mkdirSync(path.join(next, "static/chunks"), { recursive: true });
      mkdirSync(path.join(pub, "statik"), { recursive: true });
      writeFileSync(
        path.join(next, "server/app/index.html"),
        '<html><head><link rel="stylesheet" href="/_next/static/chunks/a.css"/></head><body><p class="a">x</p><script src="/_next/static/chunks/m.js" async=""></script></body></html>',
      );
      writeFileSync(path.join(next, "static/chunks/a.css"), ".a{color:red}.b{color:blue}");
      writeFileSync(path.join(pub, "statik/manifest.json"), JSON.stringify({ runtime: "/statik/runtime.js", islands: { pricing: "/statik/p.js" }, classTokens: [] }));
      writeFileSync(path.join(pub, "statik/runtime.js"), "void 0;");
      const html = staticHomeFromBuild(next, pub);
      expect(html).toContain("<style>.a{color:red}</style>");
      expect(html).toContain('{"islands":{"pricing":"/statik/p.js"}}');
      expect(measureHtml(html!).nextScripts).toBe(0);
      expect(quiet(() => staticHtmlReport(html, true, "fixture"))).toBe(0);
      expect(quiet(() => staticHtmlReport(`<html>${"x".repeat(400 * 1024)}</html>`, true, "büyük"))).toBe(1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
