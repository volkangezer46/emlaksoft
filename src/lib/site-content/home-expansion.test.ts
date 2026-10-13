import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PLANS } from "@/lib/billing/plans";
import { defaultSiteContent } from "./defaults";

vi.mock("next/font/google", () => ({
  Caveat: () => ({ className: "font-caveat", variable: "--font-hand", style: { fontFamily: "Caveat" } }),
}));
vi.mock("@/lib/billing/plan-definitions", async () => {
  const mod = await import("@/lib/billing/plans");
  return { getPublicPlanDefinitions: async () => mod.PLANS };
});

import { HeroSection } from "@/components/marketing/hero/hero-section";
import { Highlights } from "@/components/marketing/highlights";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { SecurityBand } from "@/components/marketing/security-band";
import { Testimonials } from "@/components/marketing/testimonials";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { ValueCards } from "@/components/marketing/value-cards";
import { LANDING_IDS, newCardId, normalizeLayout } from "./schema-core";
import { hasErrors, parseSiteContent, validateSiteContent, visibleSections, type SiteContent, type Testimonial } from "./schema";
import { CARD_TONES, toneClass } from "./tones";

const clone = (): SiteContent => structuredClone(defaultSiteContent());
const html = async (el: ReactElement | null | Promise<ReactElement | null>) => {
  const node = await el;
  return node ? renderToStaticMarkup(node) : "";
};
const errorsAt = (cfg: unknown, path: string) => validateSiteContent(cfg).issues.filter((i) => i.level === "error" && i.path === path);

/** Bu paketten ÖNCEKİ yayın biçimi: portal şeridi, yorumlar ve düzende "testimonials" yok. */
function legacyConfig(): Record<string, unknown> {
  const c = clone() as unknown as Record<string, unknown>;
  const hero = { ...(c.hero as Record<string, unknown>) };
  delete hero.portalStrip;
  delete c.testimonials;
  return { ...c, hero, layout: (c.layout as Array<{ id: string }>).filter((s) => s.id !== "testimonials") };
}

describe("şema yükseltme (eski yayın -> yeni şema)", () => {
  it("eski yayın, varsayılanla BİREBİR aynı içeriğe yükselir (portal şeridi bugünkü metin, yorumlar boş ve gizli)", () => {
    const up = parseSiteContent(legacyConfig());
    expect(up).not.toBeNull();
    expect(up).toEqual(defaultSiteContent());
  });

  it("eski düzende eksik yorum bölümü sona GİZLİ eklenir; diğer eksik bölümler görünür eklenir", () => {
    const out = normalizeLayout([{ id: "deger", hidden: false }]);
    expect(out.at(-1)).toEqual({ id: "testimonials", hidden: true });
    expect(out.filter((s) => s.id !== "testimonials").every((s) => !s.hidden)).toBe(true);
    expect(out.map((s) => s.id).sort()).toEqual([...LANDING_IDS].sort());
  });

  it("varsayılan içerik hatasız ve yorum bölümü görünür bölümlerde değil", () => {
    const { config, issues } = validateSiteContent(defaultSiteContent());
    expect(config).not.toBeNull();
    expect(hasErrors(issues)).toBe(false);
    expect(visibleSections(defaultSiteContent())).not.toContain("testimonials");
  });
});

describe("listelere öğe ekleme: bilinmeyen kimlik düşmez", () => {
  it("yeni kimlik c_<kısa id> biçiminde, benzersiz ve şemadan geçer", () => {
    const id = newCardId(["c_aaaaaa"]);
    expect(id).toMatch(/^c_[a-z0-9]{6}$/);
    const c = clone();
    c.valueCards.push({ id, title: "Yeni kart", text: "Açıklama", href: "/fiyatlar", hidden: false, icon: "Rocket", tone: "amber" });
    expect(hasErrors(validateSiteContent(c).issues)).toBe(false);
  });

  it("değer kartı: yeni kart seçilen ikon/tonla, ikon/ton yoksa varsayılan görünümle çizilir; bilinen kart görünümü aynı", async () => {
    const base = defaultSiteContent().valueCards;
    const out = await html(
      createElement(ValueCards, {
        plans: PLANS,
        content: [...base, { id: "c_abc123", title: "Yeni kart", text: "Yeni metin", href: "/fiyatlar", hidden: false, tone: "emerald" }, { id: "c_def456", title: "Düz kart", text: "x", href: "/kayit", hidden: false }],
      }),
    );
    expect(out).toContain("Yeni kart");
    expect(out).toContain("Düz kart");
    expect(out.match(/<li>/g)).toHaveLength(base.length + 2);
    expect(out).toContain('class="mk-value-ico mk-tint-mint"><svg');
    // Bilinen kartlar bugünkü sırayla aynı ton sınıflarını korur.
    const tints = [...out.matchAll(/mk-value-ico (mk-tint-[a-z]+)/g)].map((m) => m[1]);
    expect(tints).toEqual(["mk-tint-mint", "mk-tint-violet", "mk-tint-amber", "mk-tint-blue", "mk-tint-rose", "mk-tint-mint", "mk-tint-blue"]);
  });

  it("güven şeridi: eklenen öğe sayısız (yalnız ikon + etiket) çizilir, sahte değer üretilmez", async () => {
    const content = [...defaultSiteContent().trust, { id: "c_trust1", label: "Türkçe destek", href: "/#sss", hidden: false }];
    const out = await html(createElement(TrustStrip, { trialDays: 30, content }));
    expect(out).toContain('data-count="6"');
    expect(out).toContain("<span><b>Türkçe destek</b></span>");
  });

  it("adımlar, güvenlik maddeleri ve ayrıntılar: bilinmeyen kimlik çizilir", async () => {
    const c = clone();
    c.steps.push({ id: "c_step01", title: "Dördüncü adım", text: "Metin", hidden: false });
    c.security.items.push({ id: "c_sec001", title: "Yedekleme", text: "Metin", hidden: false, icon: "Lock" });
    c.highlights.push({ id: "c_hl0001", title: "Yeni ayrıntı", text: "Metin", hidden: false, tone: "rose" });
    const steps = await html(createElement(HowItWorks, { plans: PLANS, steps: c.steps }));
    expect(steps).toContain("Dördüncü adım");
    expect(steps.match(/class="mk-step mk-reveal"/g)).toHaveLength(4);
    const sec = await html(createElement(SecurityBand, { plans: PLANS, content: c.security }));
    expect(sec).toContain("Yedekleme");
    const hl = await html(Highlights({ content: c.highlights }));
    expect(hl).toContain("Yeni ayrıntı");
    expect(hl).toContain('id="c_hl0001"');
    expect(hl).toContain("mk-value-ico mk-tint-rose");
  });

  it("liste başına en çok 12 öğe", () => {
    const c = clone();
    c.valueCards = Array.from({ length: 13 }, (_, i) => ({ id: `c_v${i}`, title: "K", text: "", href: "/kayit", hidden: false }));
    expect(validateSiteContent(c).config).toBeNull();
    c.valueCards = c.valueCards.slice(0, 12);
    expect(hasErrors(validateSiteContent(c).issues)).toBe(false);
  });

  it("görünen yeni kartın başlığı boş olamaz", () => {
    const c = clone();
    c.valueCards.push({ id: "c_empty1", title: "", text: "", href: "/kayit", hidden: false });
    expect(errorsAt(c, `valueCards.${c.valueCards.length - 1}.title`)).toHaveLength(1);
  });
});

describe("ton ve ikon: yalnız kapalı liste", () => {
  it("ton yalnız enum kabul eder; serbest renk/sınıf reddedilir", () => {
    for (const bad of ["red", "#ff0000", "mk-tint-blue", "brand; color:red", ""]) {
      const c = clone() as unknown as { valueCards: Array<Record<string, unknown>> };
      c.valueCards[0]!.tone = bad;
      expect(validateSiteContent(c).config, bad).toBeNull();
    }
    for (const ok of CARD_TONES) {
      const c = clone();
      c.valueCards[0]!.tone = ok;
      expect(validateSiteContent(c).config, ok).not.toBeNull();
    }
  });

  it("ton sınıfı koda sabit; bilinmeyen değer varsayılana düşer (sınıf enjeksiyonu yok)", () => {
    expect(toneClass("amber")).toBe("mk-tint-amber");
    expect(toneClass("x onclick=alert(1)")).toBe("mk-tint-blue");
    expect(toneClass(undefined, "rose")).toBe("mk-tint-rose");
  });

  it("ikon yalnız site menüsünün kontrollü listesinden", () => {
    const c = clone() as unknown as { highlights: Array<Record<string, unknown>> };
    c.highlights[0]!.icon = "NotAnIcon";
    expect(validateSiteContent(c).config).toBeNull();
    c.highlights[0]!.icon = "Bot";
    expect(validateSiteContent(c).config).not.toBeNull();
  });
});

describe("portal şeridi", () => {
  it("varsayılan: bugünkü metin ve portallar", async () => {
    const out = await html(createElement(HeroSection, { trialDays: 30, content: defaultSiteContent().hero }));
    expect(out).toContain('<div class="mk-portals">');
    expect(out).toContain("<li>Hürriyet Emlak</li><li>RE/MAX</li><li class=\"mk-chip-more\">+ diğer portallar</li>");
  });

  it("Gizle ile şerit hiç çizilmez; içerik değişince yeni metin görünür", async () => {
    const c = clone();
    c.hero.portalStrip.hidden = true;
    expect(await html(createElement(HeroSection, { trialDays: 30, content: c.hero }))).not.toContain("mk-portals");
    c.hero.portalStrip = { ...c.hero.portalStrip, hidden: false, title: "Portallarınız tek yerde", portals: [{ name: "Sahibinden" }] };
    const out = await html(createElement(HeroSection, { trialDays: 30, content: c.hero }));
    expect(out).toContain("Portallarınız tek yerde");
    expect(out).not.toContain("Zingat");
  });

  it("en çok 10 portal; boş portal adı hata", () => {
    const c = clone();
    c.hero.portalStrip.portals = Array.from({ length: 11 }, (_, i) => ({ name: `P${i}` }));
    expect(validateSiteContent(c).config).toBeNull();
    c.hero.portalStrip.portals = [{ name: "" }];
    expect(validateSiteContent(c).config).toBeNull();
  });
});

describe("kanıtlı müşteri yorumları", () => {
  const item = (over: Partial<Testimonial> = {}): Testimonial => ({
    id: "c_yorum1",
    quote: "Kaçan komisyonu artık görüyoruz.",
    name: "Ayşe Yılmaz",
    role: "Ofis sahibi",
    office: "Örnek Emlak",
    city: "İzmir",
    consentDate: "2026-10-01",
    source: "e-posta onayı 2026-10-01",
    hidden: false,
    ...over,
  });

  it("onay tarihi ve kaynağı zorunlu; geçersiz tarih reddedilir", () => {
    for (const bad of [{ consentDate: "" }, { consentDate: "2026-02-30" }, { consentDate: "01.10.2026" }, { source: "" }, { source: "   " }, { quote: "" }, { name: "" }]) {
      const c = clone();
      c.testimonials.items = [item(bad)];
      expect(validateSiteContent(c).config, JSON.stringify(bad)).toBeNull();
    }
    const c = clone();
    c.testimonials.items = [item()];
    expect(hasErrors(validateSiteContent(c).issues)).toBe(false);
  });

  it("puan alanı yok: şema bilinmeyen anahtarı (rating) reddeder", () => {
    const c = clone() as unknown as { testimonials: { items: Array<Record<string, unknown>> } };
    c.testimonials.items = [{ ...item(), rating: 5 }];
    expect(validateSiteContent(c).config).toBeNull();
  });

  it("riskli kelime denetimi yorumlara da uygulanır", () => {
    const c = clone();
    c.testimonials.items = [item({ quote: "Garanti sonuç aldık." })];
    const { issues } = validateSiteContent(c);
    expect(issues.some((i) => i.path === "testimonials.items.0.quote" && i.level === "warn")).toBe(true);
  });

  it("öğe yoksa bölüm çizilmez; varsa puansız, JSON-LD'siz saf HTML", async () => {
    expect(await html(Testimonials({ content: defaultSiteContent().testimonials }))).toBe("");
    const c = clone();
    c.testimonials.items = [item(), item({ id: "c_yorum2", hidden: true, name: "Gizli Kişi" })];
    const out = await html(Testimonials({ content: c.testimonials }));
    expect(out).toContain("Ayşe Yılmaz");
    expect(out).toContain("Ofis sahibi · Örnek Emlak · İzmir");
    expect(out).not.toContain("Gizli Kişi");
    expect(out).not.toMatch(/ld\+json|AggregateRating|Review|★|rating/i);
    // Onay kanıtı iç kayıttır, sayfada gösterilmez.
    expect(out).not.toContain("e-posta onayı");
  });

  it("bölüm açık ama görünen yorum yok: uyarı (engellemez)", () => {
    const c = clone();
    c.layout = c.layout.map((s) => (s.id === "testimonials" ? { ...s, hidden: false } : s));
    const { issues } = validateSiteContent(c);
    expect(issues.some((i) => i.path === "testimonials" && i.level === "warn")).toBe(true);
    expect(hasErrors(issues)).toBe(false);
  });
});
