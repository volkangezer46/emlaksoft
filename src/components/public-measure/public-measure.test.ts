import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ settingsReads: 0 }));
vi.mock("@/lib/measure/settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/measure/settings")>()),
  getMeasureSettings: async () => {
    h.settingsReads += 1;
    return { pageviews: true, vitals: true, attribution: true, attributionLegalAt: "2026-10-13T00:00:00.000Z" };
  },
}));

// Derleme çıktısı (public/statik/measure.json) testte yok: içerik özetli dosya adı sabitlenir.
vi.mock("./script-src", async (orig) => ({
  ...(await orig<typeof import("./script-src")>()),
  measureScriptSrc: () => "/statik/m-0123456789.js",
}));

import { renderToStaticMarkup } from "react-dom/server";
import { PublicMeasure } from "./public-measure";
import { measureScriptProps } from "./script-src";
import { MEASURE_DEFAULTS } from "@/lib/measure/settings";
import { buildStaticHome } from "@/lib/static-home/transform";

const SRC = "/statik/m-0123456789.js";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("<PublicMeasure />", () => {
  it.each(["/admin", "/admin/site/reklam", "/app", "/app/musteriler", "/giris", "/kayit/tamamla", "/sifre-yenile"])(
    "%s altında null döner (ayar bile okunmaz)",
    async (path) => {
      const before = h.settingsReads;
      expect(await PublicMeasure({ path })).toBeNull();
      expect(h.settingsReads).toBe(before);
      expect(measureScriptProps(path, MEASURE_DEFAULTS, SRC)).toBeNull();
    },
  );

  it("herkese açık yolda etiket öznitelikleri: data-a atıf ayarından", () => {
    expect(measureScriptProps("/", MEASURE_DEFAULTS, SRC)).toEqual({ src: SRC, "data-a": "0" });
    expect(measureScriptProps(undefined, { ...MEASURE_DEFAULTS, attribution: true }, SRC)).toEqual({ src: SRC, "data-a": "1" });
  });

  it("sayaç ve hız ölçümü ikisi de kapalıysa ya da paket yoksa etiket basılmaz", () => {
    expect(measureScriptProps("/", { ...MEASURE_DEFAULTS, pageviews: false, vitals: false }, SRC)).toBeNull();
    expect(measureScriptProps("/", MEASURE_DEFAULTS, null)).toBeNull();
  });

  it("altbilgi tek satırla bağlar; etiket K4 (data-static-keep, defer, /statik/) biçiminde", () => {
    const footer = readFileSync(join(process.cwd(), "src/components/site-footer.tsx"), "utf8");
    expect(footer.match(/<PublicMeasure \/>/g)).toHaveLength(1);
    const src = readFileSync(join(process.cwd(), "src/components/public-measure/public-measure.tsx"), "utf8");
    expect(src).toMatch(/<script src=\{props\.src\} defer data-static-keep="" data-a=\{props\["data-a"\]\} \/>/);
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe("S6: ölçüm kapsaması (herkese açık kabuklar) ve statik sürüm", () => {
  it("fiyatlar, yasal sayfalar, kayıt, sayfa oluşturucu, vitrin ve danışman kartı etiketi basar", () => {
    expect(read("src/components/pricing-page/page-shell.tsx")).toContain("{measurePath ? <PublicMeasure path={measurePath} /> : null}");
    expect(read("src/app/fiyatlar/page.tsx")).toContain('measurePath="/fiyatlar"');
    expect(read("src/app/[...slug]/page.tsx")).toContain("<PricingShell measurePath={`/${decision.slug}`}>");
    expect(read("src/components/legal-page.tsx")).toContain("<PublicMeasure />");
    expect(read("src/app/kayit/page.tsx").match(/<PublicMeasure path="\/kayit" \/>/g)).toHaveLength(2);
    expect(read("src/app/vitrin/layout.tsx")).toContain("<PublicMeasure />");
    expect(read("src/app/danisman/[slug]/page.tsx")).toContain("<PublicMeasure path={`/danisman/${slug}`} />");
  });

  it("personel önizlemeleri ve /app, /admin hiçbir zaman etiket basmaz", () => {
    expect(read("src/app/admin/site/sayfalar/fiyatlar/onizleme/page.tsx")).not.toContain("measurePath");
    expect(read("src/app/admin/site/sayfalar/[id]/onizleme/page.tsx")).not.toContain("PublicMeasure");
    for (const dir of ["src/app/app", "src/app/admin"]) {
      const hits = measureImporters(dir);
      expect(hits, dir).toEqual([]);
    }
  });

  it("gerçek etiket statik sayfa dönüşümünde korunur (yasal sayfa, adacıksız)", async () => {
    const el = await PublicMeasure({ path: "/gizlilik" });
    expect(el).not.toBeNull();
    const tag = renderToStaticMarkup(el!);
    expect(tag).toBe(`<script src="${SRC}" defer="" data-static-keep="" data-a="1"></script>`);
    const html = `<html><head><link rel="stylesheet" href="/_next/static/chunks/a.css"/></head><body><h1 class="a">Gizlilik</h1><script src="/_next/static/chunks/x.js" async=""></script>${tag}</body></html>`;
    const out = buildStaticHome({ html, readStylesheet: () => ".a{color:red}", purge: {}, bodyEnd: "" });
    expect(out).toContain(tag);
    expect(out).not.toContain("/_next/static/chunks/x.js");
  });
});

/** Dizindeki .ts/.tsx dosyalarından PublicMeasure içe aktaranlar. */
function measureImporters(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(join(process.cwd(), d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name) && read(rel).includes("public-measure/public-measure")) out.push(rel);
    }
  };
  walk(dir);
  return out;
}
