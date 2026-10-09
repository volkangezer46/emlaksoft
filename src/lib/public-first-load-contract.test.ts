import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPECULATION_RULES } from "@/components/marketing/speculation-rules";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** İlk açılış (public ana sayfa, giriş, kayıt) için yük sözleşmeleri. */
describe("public ilk acilis sozlesmesi", () => {
  it("speculation rules yalniz public pazarlama sayfalarini listeler (oturumlu/token yuzey yok)", () => {
    const urls = [...SPECULATION_RULES.prerender, ...SPECULATION_RULES.prefetch].flatMap((r) => [...r.urls]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u.startsWith("/")).toBe(true);
      expect(u).not.toMatch(/^\/(app|admin|api|malik-portali|musteri-portali|imza|odeme-link|paylas|sunum|lead|anket|randevu-teyit|danisman|degerleme-raporu)(\/|$)/);
    }
    // Dinamik giris/kayit yalniz prefetch; prerender yalniz statik sayfa.
    const prerendered = SPECULATION_RULES.prerender.flatMap((r) => [...r.urls]);
    expect(prerendered).not.toContain("/giris");
    expect(prerendered).not.toContain("/kayit");
  });

  it("speculation rules yalniz SiteHeader (public pazarlama kabugu) ile eklenir, /app kabugunda yok", () => {
    expect(read("src/components/site-header.tsx")).toContain("<SpeculationRules />");
    expect(read("src/app/app/layout.tsx")).not.toContain("SpeculationRules");
    expect(read("src/app/admin/layout.tsx")).not.toContain("SpeculationRules");
  });

  it("urun turunun gorunmeyen ekranlari HTML/RSC yukune girmez (ilk ekran sunucuda, kalani bostayken)", () => {
    const tour = read("src/components/marketing/product-tour/product-tour.tsx");
    expect(tour).toMatch(/i === 0 \? SCREENS\[t\.id\]\(\) : <LazyTourScreen/);
    const lazy = read("src/components/marketing/product-tour/lazy-screen.tsx");
    expect(lazy).toMatch(/runWhenIdle\(/);
    expect(lazy).toMatch(/import\("\.\/screens-client"\)/);
  });

  it("Google dugmesi tarayici Supabase istemcisini statik import etmez (giris/kayit ilk yuku)", () => {
    const src = read("src/components/auth/google-button.tsx");
    expect(src).not.toMatch(/^import .*@\/lib\/supabase\/client/m);
    expect(src).toMatch(/await import\("@\/lib\/supabase\/client"\)/);
  });
});
