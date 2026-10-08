import { describe, expect, it } from "vitest";
import { DEFAULT_MATRIX } from "@/lib/permissions";
import { PLATFORM_ROLE_MODULES } from "@/lib/platform-access";
import { filterSchema, parseFilters, summarizeFilters } from "./filters";
import {
  ALL_REPORTS,
  PLATFORM_CATEGORIES,
  PLATFORM_REPORT_LIST,
  TENANT_CATEGORIES,
  TENANT_REPORT_LIST,
  getReport,
  platformReportAllowed,
  searchReports,
  tenantReportAllowed,
  visibleTenantReports,
} from "./registry";
import { REPORT_FORMATS, REPORT_ROW_LIMITS } from "./types";

const APP_MODULES = new Set(Object.values(DEFAULT_MATRIX).flatMap((m) => Object.keys(m)));
const PLATFORM_MODULES = new Set(Object.values(PLATFORM_ROLE_MODULES).flat());
const COLUMN_TYPES = new Set(["text", "date", "datetime", "money", "number", "percent", "bool"]);

describe("rapor kataloğu sözleşmesi", () => {
  it("katalog beklenen boyutta ve kimlikler tekil / kebab-case", () => {
    expect(TENANT_REPORT_LIST.length).toBeGreaterThanOrEqual(30);
    expect(PLATFORM_REPORT_LIST.length).toBeGreaterThanOrEqual(15);
    const ids = ALL_REPORTS.map((r) => `${r.scope}:${r.id}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ALL_REPORTS) expect(r.id, r.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it.each(ALL_REPORTS.map((r) => [`${r.scope}:${r.id}`, r] as const))("%s: başlık, açıklama, kategori, izin, kolon ve filtre tanımı eksiksiz", (_name, r) => {
    expect(r.title.trim().length).toBeGreaterThan(3);
    expect(r.description.trim().length).toBeGreaterThan(20);
    const cats = (r.scope === "tenant" ? TENANT_CATEGORIES : PLATFORM_CATEGORIES).map((c) => c.id);
    expect(cats, `${r.id} kategori`).toContain(r.category);
    if (r.scope === "tenant") {
      expect(r.module, `${r.id} modül`).toBeTruthy();
      expect(APP_MODULES.has(r.module!), `${r.id}: bilinmeyen modül ${r.module}`).toBe(true);
      expect(r.platformModule).toBeUndefined();
    } else {
      expect(r.platformModule, `${r.id} departman modülü`).toBeTruthy();
      expect(PLATFORM_MODULES.has(r.platformModule!)).toBe(true);
      expect(r.module).toBeUndefined();
    }
    // kolonlar
    expect(r.columns.length).toBeGreaterThanOrEqual(3);
    expect(new Set(r.columns.map((c) => c.key)).size, `${r.id} kolon anahtarı tekil`).toBe(r.columns.length);
    for (const c of r.columns) {
      expect(c.label.trim().length, `${r.id}.${c.key} başlık`).toBeGreaterThan(0);
      expect(COLUMN_TYPES.has(c.type), `${r.id}.${c.key} tür`).toBe(true);
      expect(typeof c.get).toBe("function");
      if (c.total) expect(["money", "number"], `${r.id}.${c.key} toplam yalnız sayısal`).toContain(c.type);
    }
    // filtreler
    const keys = r.filters.map((f) => f.key);
    expect(new Set(keys).size, `${r.id} filtre anahtarı tekil`).toBe(keys.length);
    for (const f of r.filters) {
      expect(f.label.trim().length).toBeGreaterThan(0);
      if (f.kind === "select") {
        expect(f.options.length, `${r.id}.${f.key} seçenek`).toBeGreaterThan(0);
        expect(new Set(f.options.map((o) => o.value)).size).toBe(f.options.length);
      }
    }
    // kaynak
    if (r.source.kind === "query") expect(typeof r.source.build).toBe("function");
    else expect(typeof r.source.run).toBe("function");
    // tarih aralığı çiftleri birlikte tanımlanır
    expect(keys.includes("from")).toBe(keys.includes("to"));
  });

  it("kişisel veri bayrağı olan raporlar ad/telefon/e-posta sütunu taşır, olmayanlar taşımaz (KVKK işareti tutarlı)", () => {
    const PII = /^(telefon|e-posta|ad soyad|müşteri|kiracı|taraf|karşı taraf|tavsiye edilen)$/i;
    for (const r of ALL_REPORTS) {
      const hasPii = r.columns.some((c) => PII.test(c.label));
      if (hasPii) expect(r.personalData, `${r.scope}:${r.id} kişisel veri bayrağı`).toBe(true);
    }
  });

  it("kazanç / rol kısıtlı raporlar yalnız yetkili görüntüleyene açılır", () => {
    const base = { perms: DEFAULT_MATRIX.owner, role: "owner", officeWide: true, seeAllEarnings: true };
    const advisor = { perms: DEFAULT_MATRIX.advisor, role: "advisor", officeWide: false, seeAllEarnings: false };
    const owner = visibleTenantReports(base).map((r) => r.id);
    const adv = visibleTenantReports(advisor).map((r) => r.id);
    expect(owner).toContain("kar-zarar");
    expect(adv).not.toContain("kar-zarar");
    expect(adv).not.toContain("uyum-kayit-defteri");
    expect(adv).not.toContain("ekip-kullanicilari");
    expect(adv).not.toContain("yetki-denetimi");
    expect(adv).toContain("musteriler");
    expect(tenantReportAllowed(getReport("tenant", "kar-zarar")!, { ...base, seeAllEarnings: false })).toBe(false);
    // danışman, modülü olmayan raporu göremez (readonly rolü satış hattı modüllerini görür; çağrı merkezi randevu görmez)
    const cc = { perms: DEFAULT_MATRIX.call_center, role: "call_center", officeWide: false, seeAllEarnings: false };
    expect(visibleTenantReports(cc).map((r) => r.id)).not.toContain("komisyonlar");
  });

  it("platform raporları departman modülüne göre görünür", () => {
    const tenants = getReport("platform", "ofisler")!;
    const invoices = getReport("platform", "faturalar")!;
    expect(platformReportAllowed(tenants, "super_admin")).toBe(true);
    expect(platformReportAllowed(invoices, "billing")).toBe(true);
    expect(platformReportAllowed(invoices, "support")).toBe(false);
    expect(platformReportAllowed(getReport("platform", "platform-denetim")!, "billing")).toBe(false);
    // kiracı raporu platform kapısından geçmez ve tersi
    expect(platformReportAllowed(getReport("tenant", "musteriler")!, "super_admin")).toBe(false);
  });

  it("filtre şeması: geçerli değer geçer, geçersiz tarih / seçim / kimlik reddedilir", () => {
    const def = getReport("tenant", "komisyonlar")!;
    expect(parseFilters(def, new URLSearchParams("durum=paid&from=2026-01-01&to=2026-03-31&bilinmeyen=1"))).toEqual({
      ok: true,
      filters: { durum: "paid", from: "2026-01-01", to: "2026-03-31" },
    });
    expect(parseFilters(def, { durum: "yok" }).ok).toBe(false);
    expect(parseFilters(def, { from: "2026-13-40" }).ok).toBe(false);
    expect(parseFilters(def, { from: "2026-05-01", to: "2026-04-01" })).toMatchObject({ ok: false });
    expect(parseFilters(def, { advisor: "abc" }).ok).toBe(false);
    expect(parseFilters(def, { advisor: "44444444-4444-4444-8444-444444444444" }).ok).toBe(true);
    // boş değerler yok sayılır
    expect(parseFilters(def, { durum: "", from: "  " })).toEqual({ ok: true, filters: {} });
    expect(filterSchema(def.filters).safeParse({}).success).toBe(true);
  });

  it("filtre özeti okunur etiket üretir", () => {
    const def = getReport("tenant", "komisyonlar")!;
    expect(summarizeFilters(def, { durum: "paid", from: "2026-01-05" }, new Map())).toEqual([
      { label: "Durum", value: "Tahsil edildi" },
      { label: "Başlangıç tarihi", value: "05.01.2026" },
    ]);
  });

  it("arama Türkçe karakterden bağımsızdır", () => {
    expect(searchReports(TENANT_REPORT_LIST, "musteri").map((r) => r.id)).toContain("musteriler");
    expect(searchReports(TENANT_REPORT_LIST, "MÜŞTERİ kaynak").map((r) => r.id)).toContain("musteri-kaynaklari");
    expect(searchReports(PLATFORM_REPORT_LIST, "tahsilat").length).toBeGreaterThan(0);
    expect(searchReports(TENANT_REPORT_LIST, "zzzyok")).toEqual([]);
  });

  it("biçim ve satır tavanları tanımlı", () => {
    expect(REPORT_FORMATS).toEqual(["xlsx", "pdf", "csv"]);
    for (const f of REPORT_FORMATS) expect(REPORT_ROW_LIMITS[f]).toBeGreaterThan(0);
    expect(REPORT_ROW_LIMITS.pdf).toBeLessThan(REPORT_ROW_LIMITS.xlsx);
  });
});
