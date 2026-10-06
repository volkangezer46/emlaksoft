import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS, buildRedirectMap, resolveRedirect, withLegacyRedirects } from "./redirects";
import { getSeoPage, seoPages } from "./registry";
import type { SeoRedirectRule } from "./schema";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Demo talebi akışı kaldırıldı (2026-10-06): tek yol self-servis kurulum sihirbazı (/kayit).
 * Bu sözleşme eski /demo adresinin KALICI olarak /kayit'a gittiğini ve envanterde sayfanın olmadığını korur.
 */
describe("eski /demo adresi → /kayit (kalıcı)", () => {
  it("SEO envanterinde /demo sayfası yok; sitemap'e girmez", () => {
    expect(getSeoPage("/demo")).toBeUndefined();
    expect(seoPages().map((p) => p.path)).not.toContain("/demo");
  });

  it("yerleşik yönlendirme 308 ile /kayit'a gider ve sayfa dosyaları silinmiştir", () => {
    const map = buildRedirectMap(withLegacyRedirects([]));
    expect(resolveRedirect(map, "/demo")).toEqual({ to: "/kayit", status: 308 });
    expect(resolveRedirect(map, "/demo/")).toEqual({ to: "/kayit", status: 308 });
    expect(existsSync(join(root, "src/app/demo"))).toBe(false);
    expect(existsSync(join(root, "src/app/actions/demo.ts"))).toBe(false);
  });

  it("admin kuralı aynı kaynak için varsa yerleşiği ezer (ilk kazanır)", () => {
    const adminRule: SeoRedirectRule = { id: "adminrule1", from: "/demo", to: "/fiyatlar", status: 307, enabled: true, note: "" };
    const map = buildRedirectMap(withLegacyRedirects([adminRule]));
    expect(resolveRedirect(map, "/demo")).toEqual({ to: "/fiyatlar", status: 307 });
  });

  it("next.config.ts kenar yönlendirmesi yerleşik listeyle aynı hedefi taşır (iki yer tutarlı)", () => {
    const cfg = read("next.config.ts");
    for (const r of LEGACY_REDIRECTS) {
      expect(cfg).toContain(`source: "${r.from}"`);
      expect(cfg).toContain(`destination: "${r.to}"`);
    }
  });

  it("public yüzeylerde demo talebi / görüşme CTA'sı yok; birincil CTA kurulum sihirbazı", () => {
    const sources = ["src/lib/site-content/defaults.ts", "src/lib/site-menu/defaults.ts", "src/components/site-footer.tsx", "src/components/pricing.tsx"].map(read).join("\n");
    expect(sources).not.toMatch(/"\/demo"/);
    expect(sources).not.toMatch(/Demo (talebi|görüşmesi|iste)/i);
    expect(read("src/lib/marketing-copy.ts")).toContain("Ofisini ücretsiz kur");
  });
});
