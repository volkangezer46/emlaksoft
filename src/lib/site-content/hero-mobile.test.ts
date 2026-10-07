import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { trialCtaMobileLabel } from "@/lib/marketing-copy";
import { defaultSiteContent } from "./defaults";
import { heroMobileCopy } from "./hero-mobile";
import { firstSentence, heroMobileLead, parseSiteContent, validateSiteContent } from "./schema";

const ctx = { trialDays: 14, plans: [] };

describe("mobil hero metinleri", () => {
  it("varsayılan içerik: tek cümle açıklama, kısa düğme, kısa güven çipleri", () => {
    const m = heroMobileCopy(defaultSiteContent().hero, ctx);
    expect(m.lead).toBe("Müşteri, talep, portföy, anlaşma ve komisyon akışı tek panelde.");
    expect(m.primary).toBe("Ücretsiz dene — 14 gün");
    expect(m.secondary).toBe("Paketleri gör");
    expect(m.checks.map((c) => c.short)).toEqual(["Kartsız", "Tüm özellikler", "Taahhüt yok"]);
  });

  it("yöneticinin değiştirdiği metin telefonda da aynen görünür (kod ezmez)", () => {
    const h = defaultSiteContent().hero;
    h.mobileLead = "Ofisinizin tüm işi tek uygulamada.";
    h.primary.label = "Hemen başla";
    h.secondary.label = "Özellikler";
    h.checks[0]!.text = "Kurulum ücreti yok";
    const m = heroMobileCopy(h, ctx);
    expect(m.lead).toBe("Ofisinizin tüm işi tek uygulamada.");
    expect(m.primary).toBe("Hemen başla");
    expect(m.secondary).toBe("Özellikler");
    expect(m.checks[0]).toMatchObject({ text: "Kurulum ücreti yok", short: "Kurulum ücreti yok" });
  });

  it("deneme günü bilinmiyorsa sayı uydurulmaz", () => {
    expect(trialCtaMobileLabel(undefined)).toBe("Ücretsiz dene");
    expect(heroMobileCopy(defaultSiteContent().hero, { plans: [] }).primary).toBe("Ücretsiz dene");
  });

  it("ilk cümle ve boş alan geri dönüşü", () => {
    expect(firstSentence("Bir. İki.")).toBe("Bir.");
    expect(firstSentence("Noktasız metin")).toBe("Noktasız metin");
    expect(heroMobileLead({ lead: "A cümlesi.\nB cümlesi.", mobileLead: "  " })).toBe("A cümlesi.");
  });

  it("eski yayın (mobileLead yok) yüklenir; alan tek satırdır", () => {
    const old = JSON.parse(JSON.stringify(defaultSiteContent())) as { hero: Record<string, unknown> };
    delete old.hero.mobileLead;
    expect(parseSiteContent(old)?.hero.mobileLead).toBe("");
    const c = defaultSiteContent();
    c.hero.mobileLead = "iki\nsatır";
    expect(validateSiteContent(c).issues.some((i) => i.path === "hero.mobileLead" && i.level === "error")).toBe(true);
  });
});

describe("akıllı alt çubuk sözleşmesi", () => {
  it("ana sayfa çubuğu akıllı modda; IntersectionObserver ile, kaydırma dinleyicisi olmadan", () => {
    expect(readFileSync("src/app/page.tsx", "utf8")).toContain("<SiteFooter smartCta");
    const root = readFileSync("src/components/marketing/motion-root.tsx", "utf8");
    expect(root).toContain(".mk-sticky-cta[data-smart]");
    expect(root).not.toMatch(/addEventListener\(\s*["']scroll/);
    const css = readFileSync("src/app/marketing-sections.css", "utf8");
    expect(css).toMatch(/\.mk-sticky-cta\[data-smart\]\s*\{[^}]*visibility:\s*hidden/);
    expect(css).toContain("env(safe-area-inset-bottom");
  });
});
