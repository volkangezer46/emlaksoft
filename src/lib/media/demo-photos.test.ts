import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_PHOTOS, DEMO_PHOTO_SETS, demoPhotoSets, demoPhotoSrcSet, demoPhotoUrl } from "./demo-photos";

const DIR = "public/img/demo";

/** Demo ilan fotoğrafları sözleşmesi (docs/design/GORSEL_KUTUPHANE.md › "Demo ilan fotoğrafları"). */
describe("demo ilan fotoğrafları: manifest", () => {
  it("her set kapaklı, Türkçe alt metinli, tam TL fiyat bantlı; konut setleri ≥ 5, arsa ≥ 3 kare", () => {
    expect(DEMO_PHOTO_SETS.length).toBeGreaterThanOrEqual(18);
    const sets = demoPhotoSets();
    for (const { meta, cover, photos } of sets) {
      expect(photos.length, meta.id).toBeGreaterThanOrEqual(meta.propertyType === "arsa" ? 3 : 5);
      expect(photos.length, meta.id).toBeLessThanOrEqual(8);
      expect(photos[0], meta.id).toBe(cover);
      expect(cover.cover, meta.id).toBe(true);
      expect(photos.filter((p) => p.cover), meta.id).toHaveLength(1);
      for (const p of photos) {
        expect(p.set, p.id).toBe(meta.id);
        expect(p.alt.length, p.id).toBeGreaterThan(10);
        expect(p.lqip).toMatch(/^data:image\/webp;base64,/);
        expect(p.lqip.length, p.id).toBeLessThan(1200);
        expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(p.credit.license).toBe("Unsplash License");
        expect(p.credit.pageUrl).toMatch(/^https:\/\/unsplash\.com\/photos\/[A-Za-z0-9_-]{11}$/);
        expect(p.credit.profileUrl).toMatch(/^https:\/\/unsplash\.com\/@[A-Za-z0-9_]+$/);
      }
      expect(meta.title.length, meta.id).toBeGreaterThan(15);
      const { min, max, currency, period } = meta.priceBand;
      expect(currency).toBe("TRY");
      // Tam TL: tamsayı, kısaltma (bin/milyon) yok; kira aylık ≥ 10.000 TL, satış ≥ 1.000.000 TL.
      expect(Number.isInteger(min) && Number.isInteger(max), meta.id).toBe(true);
      expect(max, meta.id).toBeGreaterThan(min);
      expect(min, meta.id).toBeGreaterThanOrEqual(period === "aylik" ? 10_000 : 1_000_000);
      expect(meta.listingType === "kiralik", meta.id).toBe(period === "aylik");
    }
  });

  it("konut setleri dış cephe/kapak + salon + mutfak + yatak odası + banyo içerir", () => {
    for (const { meta, photos } of demoPhotoSets()) {
      if (!["daire", "rezidans", "villa", "mustakil", "yali", "yazlik"].includes(meta.propertyType)) continue;
      const kinds = new Set(photos.map((p) => p.kind));
      for (const k of ["living", "kitchen", "bedroom", "bathroom"] as const) expect(kinds.has(k), `${meta.id}: ${k}`).toBe(true);
      expect(["exterior", "building"].includes(photos[0].kind), meta.id).toBe(true);
    }
  });

  it("referans verilen her dosya public/img/demo'da var; klasörde manifest dışı dosya yok", () => {
    const expected = new Set<string>();
    for (const p of DEMO_PHOTOS) {
      for (const w of p.widths) expected.add(path.basename(demoPhotoUrl(p, w, "avif")));
      for (const w of p.webpWidths) expected.add(path.basename(demoPhotoUrl(p, w, "webp")));
    }
    const actual = new Set(readdirSync(DIR));
    expect([...expected].filter((f) => !actual.has(f))).toEqual([]);
    expect([...actual].filter((f) => !expected.has(f))).toEqual([]);
  });

  it("tekil id/özet/kaynak; ad içerik özeti taşır; klasör ≤ 45 MB; AVIF ortalaması bütçede", () => {
    expect(new Set(DEMO_PHOTOS.map((p) => p.id)).size).toBe(DEMO_PHOTOS.length);
    expect(new Set(DEMO_PHOTOS.map((p) => p.hash)).size).toBe(DEMO_PHOTOS.length);
    expect(new Set(DEMO_PHOTOS.map((p) => p.credit.pageUrl)).size).toBe(DEMO_PHOTOS.length);
    let total = 0;
    const avif: Record<number, number[]> = { 480: [], 1600: [] };
    for (const f of readdirSync(DIR)) {
      expect(f).toMatch(/^[a-z0-9-]+-[0-9a-f]{8}-\d{3,4}\.(avif|webp)$/);
      const size = statSync(path.join(DIR, f)).size;
      total += size;
      const m = f.match(/-(480|1600)\.avif$/);
      if (m) avif[Number(m[1])].push(size);
    }
    expect(total).toBeLessThanOrEqual(45 * 1024 * 1024);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(avif[1600])).toBeLessThanOrEqual(180 * 1024);
    expect(avg(avif[480])).toBeLessThanOrEqual(60 * 1024);
  });

  it("lisans kaydı her fotoğrafı ve fotoğrafçıyı listeler; önbellek başlığı immutable", () => {
    const licenses = readFileSync("public/img/LICENSES.md", "utf8");
    expect(licenses).toContain("<!-- demo-photos:start -->");
    for (const p of DEMO_PHOTOS) {
      expect(licenses, p.id).toContain(`\`${p.id}\``);
      expect(licenses, p.id).toContain(p.credit.pageUrl);
      expect(licenses, p.id).toContain(p.credit.profileUrl);
    }
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toMatch(/source: "\/img\/demo\/:file\*",\s*headers: \[\{ key: "Cache-Control", value: "public, max-age=31536000, immutable" \}\]/);
  });

  it("url/srcset yardımcıları biçimde olmayan genişliği en yakın varyanta indirir", () => {
    const p = DEMO_PHOTOS[0];
    expect(demoPhotoUrl(p, 1600, "webp")).toBe(`/img/demo/${p.id}-${p.hash}-960.webp`);
    expect(demoPhotoUrl(p, 1600, "avif")).toBe(`/img/demo/${p.id}-${p.hash}-1600.avif`);
    expect(demoPhotoUrl(p, 100, "avif")).toBe(`/img/demo/${p.id}-${p.hash}-480.avif`);
    expect(demoPhotoSrcSet(p, "avif")).toBe(p.widths.map((w) => `/img/demo/${p.id}-${p.hash}-${w}.avif ${w}w`).join(", "));
    expect(demoPhotoSrcSet(p, "avif", 960)).not.toContain("1600w");
  });
});
