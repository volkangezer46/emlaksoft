import { describe, expect, it } from "vitest";
import { emptyOwnerInfo, evaluateOwnerInfo, isMissingSchemaError, isOwnerInfoBlank, parseOwnerInfoForm, type OwnerInfoInput } from "./info";

const full: OwnerInfoInput = {
  ...emptyOwnerInfo(),
  ownerName: "Ayşe Yılmaz",
  ownerPhone: "05321234567",
  relation: "malik",
  deedStatus: "kat_mulkiyeti",
  authorizationType: "exclusive",
  authorizationStart: "2026-10-01",
  authorizationEnd: "2027-01-01",
  listingSource: "Tavsiye / referans",
  kvkkConsent: true,
  minPrice: 4_000_000,
  customerNotes: "Acele satış",
};

describe("ilan sahibi bilgi tamamlama", () => {
  it("tam bilgi 100 puan ve tamamdır", () => {
    const e = evaluateOwnerInfo(full);
    expect(e.score).toBe(100);
    expect(e.complete).toBe(true);
    expect(e.missing).toEqual([]);
  });

  it("boş form 0 tamamlama; zorunlu eksikler listelenir", () => {
    const e = evaluateOwnerInfo(emptyOwnerInfo());
    expect(e.complete).toBe(false);
    expect(e.missing.map((m) => m.key)).toEqual(["owner", "phone", "relation", "deed", "authType", "source", "kvkk"]);
    // authDates serbest/boş türde zorunlu değil ama puana yazılır
    expect(e.score).toBe(10);
  });

  it("tek yetkide tarihler zorunlu; bitiş başlangıçtan önceyse eksik sayılır", () => {
    expect(evaluateOwnerInfo({ ...full, authorizationEnd: "" }).missing.map((m) => m.key)).toEqual(["authDates"]);
    expect(evaluateOwnerInfo({ ...full, authorizationEnd: "2026-09-01" }).complete).toBe(false);
    expect(evaluateOwnerInfo({ ...full, authorizationType: "open", authorizationStart: "", authorizationEnd: "" }).complete).toBe(true);
  });

  it("mevcut müşteri seçimi kimlik ve (kayıtlı) telefonu karşılar", () => {
    const base = { ...full, ownerName: "", ownerPhone: "", ownerCustomerId: "c1" };
    expect(evaluateOwnerInfo({ ...base, existingOwnerHasPhone: true }).complete).toBe(true);
    expect(evaluateOwnerInfo({ ...base, existingOwnerHasPhone: false }).missing.map((m) => m.key)).toEqual(["phone"]);
  });

  it("KVKK onayı olmadan tamamlanmaz; telefon yalnız ad girilmeden sayılmaz", () => {
    expect(evaluateOwnerInfo({ ...full, kvkkConsent: false }).missing.map((m) => m.key)).toEqual(["kvkk"]);
    expect(evaluateOwnerInfo({ ...full, ownerName: "" }).missing.map((m) => m.key)).toEqual(["owner", "phone"]);
  });
});

describe("ilan sahibi form okuma", () => {
  const fd = (o: Record<string, string>) => (n: string) => o[n];

  it("geçersiz enum değerleri boşa düşer; kvkk yalnız '1' ile açılır", () => {
    const { value } = parseOwnerInfoForm(fd({ owner_relation: "hacker", deed_status: "tapu_yok", kvkk_consent: "on" }));
    expect(value.relation).toBe("");
    expect(value.deedStatus).toBe("tapu_yok");
    expect(value.kvkkConsent).toBe(false);
    expect(parseOwnerInfoForm(fd({ kvkk_consent: "1" })).value.kvkkConsent).toBe(true);
  });

  it("sayı ve tarih doğrulaması", () => {
    expect(parseOwnerInfoForm(fd({ min_price: "abc" })).error).toMatch(/minimum/);
    expect(parseOwnerInfoForm(fd({ negotiation_margin_pct: "150" })).error).toMatch(/Pazarlık/);
    expect(parseOwnerInfoForm(fd({ min_price: "4.500.000", negotiation_margin_pct: "5,5" })).value).toMatchObject({ minPrice: 4_500_000, negotiationMarginPct: 5.5 });
    expect(parseOwnerInfoForm(fd({ authorization_start: "2026-10-05", authorization_end: "2026-10-01" })).error).toMatch(/bitiş/);
  });

  it("boş form blank sayılır (eski akış bozulmaz)", () => {
    expect(isOwnerInfoBlank(parseOwnerInfoForm(fd({})).value)).toBe(true);
    expect(isOwnerInfoBlank(parseOwnerInfoForm(fd({ owner_name: "A" })).value)).toBe(false);
  });
});

describe("şema yok hatası", () => {
  it("bilinen kodlar", () => {
    expect(isMissingSchemaError({ code: "42P01" })).toBe(true);
    expect(isMissingSchemaError({ code: "PGRST205" })).toBe(true);
    expect(isMissingSchemaError({ code: "23505" })).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
    expect(isMissingSchemaError({ message: 'relation "x" does not exist' })).toBe(true);
  });
});
