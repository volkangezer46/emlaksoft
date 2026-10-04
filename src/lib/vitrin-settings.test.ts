import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VITRIN_DEFAULTS,
  VITRIN_INTRO_MAX,
  isMissingColumnError,
  resolveOptInSlugs,
  settingsFromRow,
  validateVitrinInput,
} from "./vitrin-settings-logic";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("vitrin ayarları mantığı", () => {
  it("varsayılan: vitrin açık, arama onayı KAPALI", () => {
    expect(VITRIN_DEFAULTS.enabled).toBe(true);
    expect(VITRIN_DEFAULTS.seoOptin).toBe(false);
    expect(settingsFromRow(null)).toEqual(VITRIN_DEFAULTS);
    expect(settingsFromRow({})).toEqual(VITRIN_DEFAULTS);
  });

  it("satırdan ayarları okur, bozuk alanı varsayılana düşürür", () => {
    const s = settingsFromRow({ vitrin_intro: "  Merhaba  ", vitrin_enabled: false, vitrin_seo_optin: "evet" });
    expect(s.intro).toBe("Merhaba");
    expect(s.enabled).toBe(false);
    expect(s.seoOptin).toBe(false);
  });

  it("form: anahtarlar yalnız açıkça 'on' ise açık; işaretsiz arama onayı kapalı", () => {
    const v = validateVitrinInput({ intro: "", enabled: "on", showPhone: null, showLeadForm: "on", showValuation: null, seoOptin: null });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.settings).toMatchObject({ intro: null, enabled: true, showPhone: false, showLeadForm: true, showValuation: false, seoOptin: false });
    }
    const on = validateVitrinInput({ intro: "x", enabled: "on", showPhone: "on", showLeadForm: "on", showValuation: "on", seoOptin: "on" });
    expect(on.ok && on.settings.seoOptin).toBe(true);
  });

  it("tanıtım metni sınırı aşılırsa reddeder", () => {
    const v = validateVitrinInput({ intro: "a".repeat(VITRIN_INTRO_MAX + 1), enabled: "on", showPhone: "on", showLeadForm: "on", showValuation: "on", seoOptin: null });
    expect(v.ok).toBe(false);
  });

  it("eksik sütun hatasını tanır", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumnError({ message: "column tenants.vitrin_intro does not exist" })).toBe(true);
    expect(isMissingColumnError({ code: "XX000", message: "boom" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});

describe("sitemap opt-in: ofis anahtarı tek kaynak", () => {
  const tenants = [
    { slug: "a", seoOptin: true },
    { slug: "b", seoOptin: false },
    { slug: null, seoOptin: true },
  ];

  it("sütun varken yalnız anahtarı açık ofisler girer; elle liste yok sayılır", () => {
    expect(resolveOptInSlugs({ columnAvailable: true, manualSlugs: ["b", "z"], tenants })).toEqual(["a"]);
  });

  it("sütun yokken eski elle liste geçerlidir", () => {
    expect(resolveOptInSlugs({ columnAvailable: false, manualSlugs: ["z"], tenants: [] })).toEqual(["z"]);
  });
});

describe("vitrin ayarı kaynak sözleşmeleri", () => {
  it("sitemap-data opt-in'i ofis ayarından besler", () => {
    const src = read("src/lib/seo/sitemap-data.ts");
    expect(src).toContain("resolveOptInSlugs");
    expect(src).toContain("vitrin_seo_optin");
    expect(src).toContain("tenantInSitemap(smEff, slug)");
  });

  it("ayar ekranı tablo/sütun yokken 'etkin değil' uyarısı gösterir", () => {
    const src = read("src/app/app/ayarlar/vitrin/page.tsx");
    expect(src).toContain("state.available");
    expect(src).toContain("henüz etkin değil");
  });

  it("public vitrin ayarı ayrı sorguyla okur (ana tenant select'i değişmez) ve kapalıysa 404 verir", () => {
    const src = read("src/app/vitrin/[slug]/page.tsx");
    expect(src).toContain("loadVitrinSettings(admin, tenant.id)");
    expect(src).toContain("if (!vitrinCfg.enabled) notFound();");
    expect(src).not.toMatch(/\.select\("id, name, status[^"]*vitrin_/);
  });

  it("taslak migration: arama onayı varsayılan false, uygulanmış migration'larda yok", () => {
    const draft = read("supabase/proposed/20260819010700_tenant_vitrin_sections_seo_optin.sql");
    expect(draft).toMatch(/vitrin_seo_optin boolean not null default false/);
    const dir = path.join(root, "supabase/migrations");
    for (const f of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, f), "utf8").includes("vitrin_seo_optin"), f).toBe(false);
    }
  });

  it("kaydetme action'ı yetki kapılı ve audit yazar", () => {
    const src = read("src/app/actions/vitrin-settings.ts");
    expect(src).toContain('requirePermission("settings", "edit")');
    expect(src).toContain("logActivity");
  });
});
