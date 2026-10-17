import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VITRIN_DEFAULTS,
  VITRIN_INTRO_MAX,
  VITRIN_SEO_DESCRIPTION_MAX,
  VITRIN_SEO_TITLE_MAX,
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

  it("elle SEO başlığı/açıklaması: boşluk sadeleşir, boş null olur, sınır (70/160) aşılırsa reddedilir", () => {
    const base = { intro: "", enabled: "on", showPhone: "on", showLeadForm: "on", showValuation: "on", seoOptin: null };
    const ok = validateVitrinInput({ ...base, seoTitle: "  Kadıköy\n satılık  ", seoDescription: "   " });
    expect(ok.ok && ok.settings.seoTitle).toBe("Kadıköy satılık");
    expect(ok.ok && ok.settings.seoDescription).toBeNull();
    expect(validateVitrinInput({ ...base, seoTitle: "a".repeat(VITRIN_SEO_TITLE_MAX) }).ok).toBe(true);
    expect(validateVitrinInput({ ...base, seoTitle: "a".repeat(VITRIN_SEO_TITLE_MAX + 1) }).ok).toBe(false);
    expect(validateVitrinInput({ ...base, seoDescription: "a".repeat(VITRIN_SEO_DESCRIPTION_MAX + 1) }).ok).toBe(false);
    expect(settingsFromRow({ vitrin_seo_title: " Başlık ", vitrin_seo_description: null })).toMatchObject({ seoTitle: "Başlık", seoDescription: null });
  });

  it("SEO metni sınırları migration CHECK'iyle aynı", () => {
    const sql = read("supabase/migrations/20261016120400_tenant_vitrin_seo_meta.sql");
    expect(sql).toContain(`char_length(vitrin_seo_title) <= ${VITRIN_SEO_TITLE_MAX}`);
    expect(sql).toContain(`char_length(vitrin_seo_description) <= ${VITRIN_SEO_DESCRIPTION_MAX}`);
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
  it("sitemap-data opt-in'i ofis ayarından besler (ortak küme: included-offices.ts)", () => {
    expect(read("src/lib/seo/sitemap-data.ts")).toContain("loadIncludedOffices(admin, sm)");
    const src = read("src/lib/seo/included-offices.ts");
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

  it("migration (2026-10-05 terfi): arama onayı varsayılan false, sütunu yalnız bu migration ekler", () => {
    const own = "20260825001200_tenant_vitrin_sections_seo_optin.sql";
    const draft = read(`supabase/migrations/${own}`);
    expect(draft).toMatch(/vitrin_seo_optin boolean not null default false/);
    const dir = path.join(root, "supabase/migrations");
    for (const f of readdirSync(dir)) {
      if (f === own) continue;
      expect(readFileSync(path.join(dir, f), "utf8").includes("vitrin_seo_optin"), f).toBe(false);
    }
  });

  it("kaydetme action'ı yetki kapılı ve audit yazar", () => {
    const src = read("src/app/actions/vitrin-settings.ts");
    expect(src).toContain('requirePermission("settings", "edit")');
    expect(src).toContain("logActivity");
  });
});
