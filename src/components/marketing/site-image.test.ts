import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SiteMediaView } from "@/lib/site-media/types";
import { SiteImage } from "./site-image";

const media: SiteMediaView = {
  id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  alt: "Ofiste danışman ve müşteri",
  w: 1600,
  h: 900,
  lqip: "UklGRg",
  variants: [
    { file: "1600w-0a1b2c3d.avif", w: 1600, h: 900, format: "avif", bytes: 1 },
    { file: "480w-0a1b2c3d.avif", w: 480, h: 270, format: "avif", bytes: 1 },
    { file: "960w-0a1b2c3d.avif", w: 960, h: 540, format: "avif", bytes: 1 },
    { file: "480w-0a1b2c3d.webp", w: 480, h: 270, format: "webp", bytes: 1 },
    { file: "960w-0a1b2c3d.webp", w: 960, h: 540, format: "webp", bytes: 1 },
    { file: "1600w-0a1b2c3d.webp", w: 1600, h: 900, format: "webp", bytes: 1 },
  ],
};

describe("SiteImage", () => {
  it("<picture>: AVIF + WebP srcset (artan genişlik), width/height her zaman var", () => {
    const out = renderToStaticMarkup(createElement(SiteImage, { media }));
    expect(out.startsWith("<picture>")).toBe(true);
    expect(out).toContain(`<source type="image/avif" srcSet="/medya/${media.id}/480w-0a1b2c3d.avif 480w, /medya/${media.id}/960w-0a1b2c3d.avif 960w, /medya/${media.id}/1600w-0a1b2c3d.avif 1600w"`);
    expect(out).toContain('<source type="image/webp"');
    expect(out).toContain('width="1600"');
    expect(out).toContain('height="900"');
    expect(out).toContain(`src="/medya/${media.id}/960w-0a1b2c3d.webp"`);
    expect(out).toContain('alt="Ofiste danışman ve müşteri"');
  });

  it("hero (priority): fetchpriority=high, tembel yükleme yok", () => {
    const out = renderToStaticMarkup(createElement(SiteImage, { media, priority: true, alt: "Özel" }));
    // React özniteliği HTML'de küçük harfle yazar: fetchpriority="high".
    expect(out.toLowerCase()).toContain('fetchpriority="high"');
    expect(out).not.toContain("loading=");
    expect(out).toContain('alt="Özel"');
  });

  it("diğerleri: loading=lazy + decoding=async, fetchpriority yok", () => {
    const out = renderToStaticMarkup(createElement(SiteImage, { media }));
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
    expect(out.toLowerCase()).not.toContain("fetchpriority");
  });

  it("varyant yoksa hiçbir şey çizilmez", () => {
    expect(renderToStaticMarkup(createElement(SiteImage, { media: { ...media, variants: [] } }))).toBe("");
  });
});
