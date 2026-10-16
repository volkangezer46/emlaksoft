import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETING_NAV, allNavLinks } from "@/lib/marketing-nav";
import { HERO_LEAD } from "@/lib/site-content/defaults";
import { MAX_TOUR_STEPS, TOURS } from "@/lib/product-tour-data";
import { SETUP_FOCUS_CSS } from "@/app/app/baslangic/focus-mode";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Sadeleştirme planı paket B7 (C27–C29, C31) statik kabul ölçütleri. Tarayıcıda ölçülenler `e2e/setup-content.spec.ts`'te.
 */
describe("C27 kurulum sihirbazı", () => {
  const wizard = read("src/app/app/baslangic/setup-wizard.tsx");

  it("adım şeridi yok; 'Adım x / n' ve ilerleme çubuğu var; tek çıkış 'Kurulumdan çık'", () => {
    expect(wizard).toContain("Adım ${pos.index} / ${pos.total}");
    expect(wizard).toContain("Kurulumdan çık");
    expect(wizard).not.toContain("Kurulum adımları\">"); // eski çip şeridi (nav aria-label)
    expect(wizard).not.toContain("ActiveChipIntoView");
  });

  it("odak modu: yan menü, üst çubuk ve mobil alt çubuk sihirbazda gizli", () => {
    expect(wizard).toContain("<SetupFocusMode />");
    for (const sel of ["aside.shell-aside", "header.glass-bar", 'nav[aria-label="Mobil hızlı gezinme"]']) expect(SETUP_FOCUS_CSS).toContain(sel);
    // Seçiciler kabukta gerçekten var (kabuk değişirse bu test uyarır).
    expect(read("src/components/app/app-sidebar.tsx")).toContain("shell-aside");
    expect(read("src/components/app/app-sidebar.tsx")).toContain('aria-label="Mobil hızlı gezinme"');
    // Üst çubuk v4'te `AppTopbar` bileşeninde (layout onu çizer).
    expect(read("src/app/app/layout.tsx")).toContain("<AppTopbar");
    expect(read("src/components/app/app-topbar.tsx")).toContain('<header className="glass-bar');
  });

  it("tur kendiliğinden başlamaz; 2. adım hazır modül düzenini kullanır", () => {
    expect(wizard).toContain("<FinishTourStarter auto={false} />");
    const step = read("src/app/app/baslangic/steps/ofis-tipi-step.tsx");
    expect(step).toContain("applyModulePreset");
    expect(step).toContain("answerPropertyManagement");
    expect(read("src/app/app/baslangic/step-bodies.tsx")).toContain("computePresetChanges(");
  });
});

describe("C28 içe aktarma", () => {
  const page = read("src/app/app/ice-aktarma/page.tsx");

  it("KPI ve açıklama kartı yok; 'Ayarlara dön' yerine geldiği yere dönüş", () => {
    for (const gone of ["Kayıtlı müşteri", "Son 30 günde", "kpis", "guarantees", "Ayarlara dön"]) expect(page, gone).not.toContain(gone);
    expect(page).toContain("resolveImportBack(");
    expect(page).toContain("initialTarget=");
  });

  it("üç büyük hedef kartı üstte, diğer türler katlı", () => {
    const wizard = read("src/app/app/ice-aktarma/import-wizard.tsx");
    expect(wizard).toContain("Ne taşıyorsunuz?");
    expect(wizard).toContain('data-testid="ice-aktarma-hedefler"');
    expect(wizard).toContain("Diğer türler");
  });
});

describe("C29 yardım ve tur", () => {
  it("her tur en çok 5 adım", () => {
    for (const t of TOURS) expect(t.steps.length, t.id).toBeLessThanOrEqual(MAX_TOUR_STEPS);
  });

  it("yalnız rolün turu kart olarak; diğerleri katlı; destek kartı sayfanın başında; kurulum listesi kopyası yok", () => {
    const picker = read("src/app/app/yardim/restart-tour-button.tsx");
    expect(picker).toContain("Diğer turlar");
    expect((picker.match(/data-tour-card=/g) ?? []).length).toBe(1);
    const page = read("src/app/app/yardim/page.tsx");
    expect(page.indexOf("<SupportCard")).toBeLessThan(page.indexOf('aria-label="Yardım bölümleri"'));
    expect(page).not.toContain("İlk 30 dakikada");
  });
});

describe("C31 pazarlama ve kayıt", () => {
  it("üst menü en çok 15 bağlantı, en çok 3 grup", () => {
    expect(allNavLinks().length).toBeLessThanOrEqual(15);
    expect(MARKETING_NAV.length).toBeLessThanOrEqual(3);
  });

  it("hero açıklaması tek cümle ve jargonsuz", () => {
    expect(HERO_LEAD.match(/[.!?](\s|$)/g)?.length).toBe(1);
    expect(HERO_LEAD).not.toMatch(/işletim sistemi|motoru|otomatik görev/);
  });

  it("kayıtta sonraki adım satırı ve isteğe bağlı ekip büyüklüğü sorusu", () => {
    const form = read("src/app/kayit/register-form.tsx");
    expect(form).toContain("Sonraki adım: 4 kısa soru");
    expect(form).toContain("Kaç kişisiniz?");
    expect(form).toContain("name={TEAM_BAND_FIELD}");
    expect(read("src/lib/registration/provision-office.ts")).toContain("applySignupTeamBand(admin");
  });
});
