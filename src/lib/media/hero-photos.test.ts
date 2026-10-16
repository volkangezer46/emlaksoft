import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroPhoto } from "@/components/ui/art/hero-photo";
import { HERO_PHOTOS, heroPhoto, heroPhotoSrcSet, heroPhotoUrl } from "./hero-photos";

const DIR = "public/img/hero";

/** Görsel kütüphanesi sözleşmesi (docs/design/GORSEL_KUTUPHANE.md). */
describe("görsel kütüphanesi: fotoğraf manifesti", () => {
  it("her varyant dosyası var; klasörde manifest dışı dosya yok", () => {
    const expected = new Set<string>();
    for (const p of HERO_PHOTOS) for (const w of p.widths) for (const ext of ["avif", "webp"] as const) expected.add(path.basename(heroPhotoUrl(p, w, ext)));
    const actual = new Set(readdirSync(DIR));
    expect([...expected].filter((f) => !actual.has(f))).toEqual([]);
    expect([...actual].filter((f) => !expected.has(f))).toEqual([]);
  });

  it("ad içerik özeti taşır (immutable önbellek), toplam boyut < 12 MB", () => {
    let total = 0;
    for (const f of readdirSync(DIR)) {
      expect(f).toMatch(/^[a-z0-9-]+-[0-9a-f]{8}-\d{3,4}\.(avif|webp)$/);
      total += statSync(path.join(DIR, f)).size;
    }
    expect(total).toBeLessThan(12 * 1024 * 1024);
    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toMatch(/source: "\/img\/hero\/:file\*",\s*headers: \[\{ key: "Cache-Control", value: "public, max-age=31536000, immutable" \}\]/);
  });

  it("her fotoğraf lisans kaydında, Türkçe alt metinli, LQIP'li ve tekil", () => {
    const licenses = readFileSync("public/img/LICENSES.md", "utf8");
    const ids = new Set<string>();
    for (const p of HERO_PHOTOS) {
      expect(ids.has(p.id), p.id).toBe(false);
      ids.add(p.id);
      expect(licenses, p.id).toContain(`\`${p.id}\``);
      expect(licenses, p.id).toContain(p.credit.pageUrl);
      expect(p.credit.licenseUrl).toBe("https://unsplash.com/license");
      expect(p.alt.length, p.id).toBeGreaterThan(10);
      expect(p.lqip).toMatch(/^data:image\/webp;base64,/);
      expect(p.lqip.length, p.id).toBeLessThan(1200);
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(HERO_PHOTOS.length).toBeGreaterThanOrEqual(12);
  });

  it("srcset en büyük genişliği sınırlar; HeroPhoto AVIF→WebP <picture> basar", () => {
    const p = heroPhoto("villa-gece-havuz");
    expect(heroPhotoSrcSet(p, "avif", 1280)).not.toContain("1920w");
    const html = renderToStaticMarkup(createElement(HeroPhoto, { photo: "villa-gece-havuz", priority: true, overlay: "left", sizes: "60vw" }));
    expect(html.indexOf('type="image/avif"')).toBeLessThan(html.indexOf('type="image/webp"'));
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain(`alt="${p.alt}"`);
    const deco = renderToStaticMarkup(createElement(HeroPhoto, { photo: "anahtar-elde", decorative: true }));
    expect(deco).toContain('alt=""');
    expect(deco).toContain('loading="lazy"');
    expect(existsSync(path.join("public", heroPhotoUrl(p, p.widths[0], "webp")))).toBe(true);
  });
});
