import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { HERO_ART_KINDS, HeroArt } from "./hero-art";

describe("HeroArt (sayfa bandı sahneleri)", () => {
  it("her sahne dekoratif, yalnız token renkli, hafif (≤4 KB gz) ve deterministik", () => {
    expect(HERO_ART_KINDS.length).toBeGreaterThanOrEqual(12);
    for (const kind of HERO_ART_KINDS) {
      const html = renderToStaticMarkup(createElement(HeroArt, { kind }));
      expect(html, kind).toContain('aria-hidden="true"');
      expect(html, kind).toContain("var(--");
      expect(html, kind).not.toMatch(/(fill|stroke)="(#[0-9a-f]{3,8}|white|black|rgba?\()/i);
      expect(html, kind).not.toMatch(/<img|<filter|\.gif/i);
      expect(gzipSync(html).length, kind).toBeLessThan(4 * 1024);
      expect(renderToStaticMarkup(createElement(HeroArt, { kind }))).toBe(html);
    }
  });
});
