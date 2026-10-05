import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Illustration, ILLUSTRATION_KINDS, resolveIllustration } from "./index";
import { EmptyState } from "../empty-state";

describe("illüstrasyon kiti", () => {
  it("her illüstrasyon dekoratif (aria-hidden), tema renkli ve ≤6 KB gz", () => {
    expect(ILLUSTRATION_KINDS.length).toBeGreaterThanOrEqual(19);
    for (const kind of ILLUSTRATION_KINDS) {
      const html = renderToStaticMarkup(createElement(Illustration, { kind }));
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("currentColor");
      expect(gzipSync(html).length).toBeLessThan(6 * 1024);
      expect(html).not.toMatch(/<img|\.gif/i);
    }
  });

  it("viz boş durum illüstrasyonları (funnel, gauge, heatmap) tanımlı", () => {
    for (const kind of ["funnel", "gauge", "heatmap"] as const) {
      expect(ILLUSTRATION_KINDS).toContain(kind);
      expect(resolveIllustration(kind)).toBe(kind);
    }
    expect(ILLUSTRATION_KINDS.length).toBeGreaterThanOrEqual(22);
  });

  it("eski illustration değerleri çözülür", () => {
    expect(resolveIllustration("search")).toBe("aramaYok");
    expect(resolveIllustration("start")).toBe("baslangic");
    expect(resolveIllustration("nope")).toBeNull();
  });

  it("hareket yalnız motion.css'te, reduced-motion korumalı; will-change yok", () => {
    const css = readFileSync("src/app/motion.css", "utf8");
    expect(css).toContain("prefers-reduced-motion: no-preference");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).not.toContain("will-change");
    expect(css).not.toMatch(/animation:[^;]*\b(width|height|top|left)\b/);
  });
});

describe("EmptyState (tek bileşen)", () => {
  it("v2 imzası: action nesnesi + illüstrasyon", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: "Müşteri yok", illustration: "musteri", action: { href: "/app/musteriler/yeni", label: "Müşteri ekle" } }),
    );
    expect(html).toContain("Müşteri yok");
    expect(html).toContain('href="/app/musteriler/yeni"');
    expect(html).toContain("<svg");
  });

  it("v3 imzası: action düğümü + compact", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { title: "Boş", variant: "compact", action: createElement("a", { href: "/x" }, "Git") }),
    );
    expect(html).toContain('href="/x"');
  });
});
