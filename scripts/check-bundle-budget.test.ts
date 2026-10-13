import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BUDGET,
  BUDGET_ROUTES,
  MAX_DUP_RATIO,
  MAX_REQUESTS,
  checkBudget,
  duplicateRatio,
  initialFiles,
  measureRoute,
  parseClientReferenceManifest,
  type RouteLoad,
} from "./check-bundle-budget";

const load = (over: Partial<RouteLoad> = {}): RouteLoad => ({
  route: "/app",
  jsFiles: [],
  cssFiles: [],
  rawKb: 100,
  gzipKb: 100,
  dupRatio: 0.01,
  requests: 10,
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
    expect(measureRoute(dir, "/admin", [])).toBeNull();
  });
});
