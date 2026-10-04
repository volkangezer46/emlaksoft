import { describe, expect, it } from "vitest";
import { OFFICE_ADMIN_ACTIONS, officeAdminCan } from "./office-admin-access";
import { parseOfficeCreateInput } from "./office-create-input";
import { confirmationMatches } from "./office-create-rules";
import { officeSlugCandidates, slugifyOffice, validateOfficeSlug } from "./office-slug";
import type { PlatformRole } from "@/lib/platform-access";

const ROLES: PlatformRole[] = ["super_admin", "ops", "billing", "support"];

describe("vitrin adresi", () => {
  it("Türkçe karakterleri dönüştürür", () => {
    expect(slugifyOffice("Çiğdem Emlak & Gayrimenkul İşleri")).toBe("cigdem-emlak-gayrimenkul-isleri");
    expect(slugifyOffice("ŞÖÜĞ Ofis")).toBe("soug-ofis");
    expect(slugifyOffice("  --  ")).toBe("");
  });
  it("48 karakteri aşmaz ve tireyle bitmez", () => {
    const s = slugifyOffice(`${"a".repeat(47)} b`);
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith("-")).toBe(false);
  });
  it("doğrulama", () => {
    expect(validateOfficeSlug("kadikoy-emlak").ok).toBe(true);
    expect(validateOfficeSlug("ab").ok).toBe(false);
    expect(validateOfficeSlug("Kadıköy").ok).toBe(false);
    expect(validateOfficeSlug("a--b").ok).toBe(false);
  });
  it("alternatif önerir", () => {
    expect(officeSlugCandidates("Yilmaz Emlak", "İstanbul")[0]).toBe("yilmaz-emlak-istanbul");
  });
});

describe("ofis oluşturma girdisi", () => {
  const base = { office_name: "Yılmaz Emlak", slug: "yilmaz-emlak", owner_name: "Ali Yılmaz", owner_email: "ALI@Example.com" };
  it("geçerli girdiyi normalize eder", () => {
    const r = parseOfficeCreateInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.ownerEmail).toBe("ali@example.com");
  });
  it("hatalı alanı alan adıyla bildirir", () => {
    const r = parseOfficeCreateInput({ ...base, owner_email: "gecersiz" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("owner_email");
    expect(parseOfficeCreateInput({ ...base, office_name: "" }).ok).toBe(false);
    expect(parseOfficeCreateInput({ ...base, tax_number: "123" }).ok).toBe(false);
    expect(parseOfficeCreateInput({ ...base, trial_days: "500" }).ok).toBe(false);
    expect(parseOfficeCreateInput({ ...base, plan: "yok" }).ok).toBe(false);
  });
});

describe("ofis yönetimi rol kapısı", () => {
  it("ofis açma kapısı demo dönüşümüyle aynı (sales modülü)", () => {
    expect(officeAdminCan("super_admin", "create")).toBe(true);
    expect(officeAdminCan("ops", "create")).toBe(true);
    expect(officeAdminCan("support", "create")).toBe(true);
    expect(officeAdminCan("billing", "create")).toBe(false);
  });
  it("yıkıcı eylemler yalnız süper admin", () => {
    for (const a of ["suspend", "archive", "restore", "change_slug", "transfer_ownership", "change_owner_email", "deactivate_user"] as const) {
      for (const r of ROLES) expect(officeAdminCan(r, a)).toBe(r === "super_admin");
    }
  });
  it("paket/deneme eylemleri faturalama yetkisi ister", () => {
    expect(officeAdminCan("billing", "plan_status")).toBe(true);
    expect(officeAdminCan("ops", "plan_status")).toBe(false);
    expect(officeAdminCan("billing", "extend_trial")).toBe(true);
  });
  it("süper admin her eylemi yapar", () => {
    for (const a of OFFICE_ADMIN_ACTIONS) expect(officeAdminCan("super_admin", a)).toBe(true);
  });
  it("onay metni ofis adıyla karşılaştırılır", () => {
    expect(confirmationMatches(" yılmaz  EMLAK ", "Yılmaz Emlak")).toBe(true);
    expect(confirmationMatches("", "Yılmaz Emlak")).toBe(false);
  });
});
