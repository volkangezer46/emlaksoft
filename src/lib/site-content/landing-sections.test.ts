import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { withGateBadge } from "@/lib/marketing-plan-badge";
import { defaultSiteContent } from "./defaults";
import { LANDING_SECTIONS, hasErrors, normalizeLayout, parseSiteContent, upgradeSiteContent, validateSiteContent, visibleSections, type SiteContent } from "./schema";
import { tx } from "./tokens";

vi.mock("@/lib/billing/plan-definitions", async () => {
  const mod = await import("@/lib/billing/plans");
  return { getPublicPlanDefinitions: async () => mod.PLANS };
});

import { BentoGrid } from "@/components/marketing/bento/bento-grid";
import { ProductTour } from "@/components/marketing/product-tour/product-tour";
import { Why } from "@/components/marketing/why";

const clone = (): SiteContent => structuredClone(defaultSiteContent());
const html = async (el: Promise<React.ReactElement | null>) => {
  const n = await el;
  return n ? renderToStaticMarkup(n) : "";
};

describe("ana sayfa bölümleri admin'den yönetilir", () => {
  it("eski yayın (yeni anahtarlar yok) varsayılana DÜŞMEZ: kendi metni korunur, eksikler varsayılandan gelir", () => {
    const old = clone() as Record<string, unknown>;
    for (const k of ["tour", "bento", "why", "efSection", "layout"]) delete old[k];
    (old.hero as SiteContent["hero"]).badge = "Özel rozet";
    const parsed = parseSiteContent(old);
    expect(parsed).not.toBeNull();
    expect(parsed!.hero.badge).toBe("Özel rozet");
    expect(parsed!.tour).toEqual(defaultSiteContent().tour);
    expect(parsed!.layout.map((s) => s.id)).toEqual(LANDING_SECTIONS.map((s) => s.id));
    expect(hasErrors(validateSiteContent(old).issues)).toBe(false);
  });

  it("düzen: bilinmeyen/yinelenen kimlik atılır, eksik bölüm sona görünür eklenir", () => {
    const out = normalizeLayout([{ id: "sss", hidden: true }, { id: "yok" }, { id: "sss", hidden: false }]);
    expect(out[0]).toEqual({ id: "sss", hidden: true });
    expect(out).toHaveLength(LANDING_SECTIONS.length);
    expect(new Set(out.map((s) => s.id)).size).toBe(LANDING_SECTIONS.length);
    expect((upgradeSiteContent({ v: 1, layout: [] }) as { layout: unknown[] }).layout).toHaveLength(LANDING_SECTIONS.length);
  });

  it("varsayılan sıra bugünkü ana sayfa sırasıdır; gizleme ve değerleme bayrağı uygulanır", () => {
    const c = clone();
    expect(visibleSections(c)).toEqual(["deger", "guven", "tur", "ozellikler", "degerleme", "emlakfiyati", "diger", "neden", "nasil", "guvenlik", "fiyat", "sss", "son"]);
    c.layout = c.layout.map((s) => (s.id === "neden" ? { ...s, hidden: true } : s));
    c.valuation.hidden = true;
    const v = visibleSections(c);
    expect(v).not.toContain("neden");
    expect(v).not.toContain("degerleme");
    const moved = clone();
    moved.layout = [moved.layout[11]!, ...moved.layout.filter((_, i) => i !== 11)];
    expect(visibleSections(moved)[0]).toBe("sss");
  });

  it("ana sayfa bölümleri düzene göre çizer ve FAQPage verisi SSS gizliyken basılmaz", () => {
    const page = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(page).toContain("visibleSections(content)");
    expect(page).toMatch(/shown\.includes\("sss"\) \? faqForJsonLd\(faqs\) : \[\]/);
  });

  it("ürün turu: metin içerikten, gizli sekme çizilmez, {gorev} cron envanterinden", async () => {
    const c = clone();
    c.tour[0]!.label = "Bugünüm";
    c.tour[1]!.hidden = true;
    const out = await html(ProductTour({ items: c.tour }));
    expect(out).toContain("Bugünüm");
    expect(out).not.toContain(">Müşteriler</label>");
    expect(out).toContain(`${CRON_JOBS.length} otomatik görev`);
    expect(out).toContain('id="tt6"');
    expect(out).not.toContain('id="tt7"');
    c.tour.forEach((t) => (t.hidden = true));
    expect(await html(ProductTour({ items: c.tour }))).toBe("");
  });

  it("özellik ızgarası ve karşılaştırma: metin içerikten, gizli kart/satır çizilmez", async () => {
    const c = clone();
    c.bento.tiles[3]!.title = "Asistana sorun";
    c.bento.tiles[6]!.hidden = true;
    const bento = await html(BentoGrid({ content: c.bento }));
    expect(bento).toContain("Asistana sorun");
    expect(bento).not.toContain('id="vitrin"');
    expect(validateSiteContent(c).issues.some((i) => i.level === "warn" && i.path === "bento.tiles.6")).toBe(true);
    c.why.rows[0]!.hidden = true;
    c.why.newLabel = "Biz";
    const why = await html(Why({ content: c.why }));
    expect(why).not.toContain("Müşteri ve talep");
    expect(why).toContain('data-label="Biz"');
  });

  it("paket rozeti noktadan önce eklenir; rozet yoksa metin aynen", () => {
    expect(withGateBadge("Kaçak karnesi.", "")).toBe("Kaçak karnesi.");
    const badged = withGateBadge("Kaçak karnesi.", "/app/kayip-kacak");
    expect(badged).toMatch(/^Kaçak karnesi \(.+ ve üzeri\)\.$/);
    expect(withGateBadge("İmza", "/app/sozlesmeler")).toMatch(/^İmza \(.+ ve üzeri\)$/);
  });

  it("paket rozeti yolu yalnız /app/... biçimindedir; {gorev} değişkeni tanınır", () => {
    const c = clone();
    c.why.rows[0]!.gate = "javascript:alert(1)";
    expect(validateSiteContent(c).config).toBeNull();
    expect(tx("{gorev} görev", { plans: [] })).toBe(`${CRON_JOBS.length} görev`);
  });
});
