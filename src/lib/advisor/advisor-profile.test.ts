import { describe, expect, it } from "vitest";
import {
  collectDocAlerts,
  dayDiff,
  diffByKey,
  docExpiryStatus,
  formatDocCountdown,
  isValidDay,
  parseWorkProfile,
  pausedUntilIso,
  recordGetter,
  regionKey,
  specialtyKey,
  validateRegions,
  validateSpecialties,
  type RegionRow,
  type SpecialtyRow,
} from "./advisor-profile";

const TODAY = "2026-10-04";

describe("tarih ve belge bitişi", () => {
  it("takvim günü doğrulaması taşmayı reddeder", () => {
    expect(isValidDay("2026-02-28")).toBe(true);
    expect(isValidDay("2026-02-31")).toBe(false);
    expect(isValidDay("2026-13-01")).toBe(false);
    expect(isValidDay("04.10.2026")).toBe(false);
    expect(dayDiff("2026-10-04", "2026-11-03")).toBe(30);
    expect(dayDiff("2026-12-31", "2027-01-01")).toBe(1);
  });
  it("durum sınırları: dolmuş, 7, 30 ve geçerli", () => {
    expect(docExpiryStatus(null, TODAY).state).toBe("none");
    expect(docExpiryStatus("bozuk", TODAY).state).toBe("none");
    expect(docExpiryStatus("2026-10-03", TODAY)).toEqual({ state: "expired", daysLeft: -1 });
    expect(docExpiryStatus("2026-10-04", TODAY)).toEqual({ state: "week", daysLeft: 0 });
    expect(docExpiryStatus("2026-10-11", TODAY)).toEqual({ state: "week", daysLeft: 7 });
    expect(docExpiryStatus("2026-10-12", TODAY)).toEqual({ state: "month", daysLeft: 8 });
    expect(docExpiryStatus("2026-11-03", TODAY)).toEqual({ state: "month", daysLeft: 30 });
    expect(docExpiryStatus("2026-11-04", TODAY)).toEqual({ state: "ok", daysLeft: 31 });
  });
  it("geri sayım metni", () => {
    expect(formatDocCountdown({ state: "expired", daysLeft: -3 })).toBe("3 gün önce doldu");
    expect(formatDocCountdown({ state: "week", daysLeft: 0 })).toBe("Bugün bitiyor");
    expect(formatDocCountdown({ state: "month", daysLeft: 20 })).toBe("20 gün kaldı");
  });
  it("uyarı toplama: yalnız dolmuş/30 gün içi, en acil önce", () => {
    const alerts = collectDocAlerts(
      [
        { profile_id: "a", authority_cert_expires_on: "2026-10-20", spk_cert_expires_on: "2027-01-01" },
        { profile_id: "b", authority_cert_expires_on: "2026-09-01", spk_cert_expires_on: "2026-10-06" },
        { profile_id: "c", authority_cert_expires_on: null, spk_cert_expires_on: null },
      ],
      TODAY,
    );
    expect(alerts.map((a) => `${a.profileId}:${a.kind}:${a.state}`)).toEqual(["b:authority:expired", "b:spk:week", "a:authority:month"]);
  });
});

describe("iş profili ayrıştırma", () => {
  const base = { employment_type: "kadrolu", hired_at: "2024-01-15", work_days: ["1", "2", "3"], work_start: "09:00", work_end: "18:00", accepts_pool: "1" };
  it("geçerli girdiyi normalleştirir", () => {
    const r = parseWorkProfile(recordGetter({ ...base, max_active_listings: "40", authority_cert_expires_on: "2027-03-01", pool_paused_until: "2026-10-10" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.work_days).toEqual([1, 2, 3]);
      expect(r.value.max_active_listings).toBe(40);
      expect(r.value.max_active_demands).toBeNull();
      expect(r.value.accepts_pool).toBe(true);
      expect(pausedUntilIso(r.value.pool_paused_until_day)).toBe("2026-10-10T23:59:59+03:00");
    }
  });
  it("hatalı girdileri reddeder", () => {
    const bad = (extra: Record<string, string | string[]>) => parseWorkProfile(recordGetter({ ...base, ...extra }));
    expect(bad({ employment_type: "x" }).ok).toBe(false);
    expect(bad({ hired_at: "2024-02-31" }).ok).toBe(false);
    expect(bad({ left_at: "2023-12-31" }).ok).toBe(false);
    expect(bad({ max_active_listings: "-1" }).ok).toBe(false);
    expect(bad({ max_active_demands: "1.5" }).ok).toBe(false);
    expect(bad({ work_start: "25:00" }).ok).toBe(false);
    expect(bad({ work_end: "" }).ok).toBe(false);
    expect(bad({ work_start: "18:00", work_end: "09:00" }).ok).toBe(false);
    expect(bad({ work_days: ["8"] }).ok).toBe(false);
    expect(bad({ accepts_pool: "evet" }).ok).toBe(false);
  });
  it("boş girdi tüm alanları null yapar, havuz varsayılan açık", () => {
    const r = parseWorkProfile(recordGetter({}));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.employment_type).toBeNull();
      expect(r.value.work_days).toEqual([]);
      expect(r.value.accepts_pool).toBe(true);
    }
  });
});

describe("uzmanlık doğrulama", () => {
  const allowed = { property_type: new Set(["Arsa", "Daire"]), segment: new Set(["Lüks konut"]) };
  const row = { kind: "property_type", value: "Arsa", transaction_type: "Satılık", level: 3, price_min: "1000000", price_max: 5000000, experience_years: 4 };
  it("geçerli satırı sayılara çevirir", () => {
    const r = validateSpecialties([row, { kind: "segment", value: "Lüks konut", transaction_type: "", level: 2 }], allowed);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]).toMatchObject({ price_min: 1_000_000, price_max: 5_000_000, level: 3, transaction_type: "Satılık" });
      expect(r.value[1]).toMatchObject({ transaction_type: null, price_min: null });
    }
  });
  it("tanımda olmayan değeri, kötü fiyat bandını, seviyeyi ve tekrarı reddeder", () => {
    expect(validateSpecialties([{ ...row, value: "Uzay" }], allowed).ok).toBe(false);
    expect(validateSpecialties([{ ...row, kind: "segment" }], allowed).ok).toBe(false);
    expect(validateSpecialties([{ ...row, price_min: 9, price_max: 1 }], allowed).ok).toBe(false);
    expect(validateSpecialties([{ ...row, price_min: -1 }], allowed).ok).toBe(false);
    expect(validateSpecialties([{ ...row, level: 4 }], allowed).ok).toBe(false);
    expect(validateSpecialties([{ ...row, transaction_type: "Devren" }], allowed).ok).toBe(false);
    expect(validateSpecialties([{ ...row, experience_years: 61 }], allowed).ok).toBe(false);
    expect(validateSpecialties([row, row], allowed).ok).toBe(false);
    expect(validateSpecialties("x", allowed).ok).toBe(false);
  });
  it("aynı tür farklı işlem türüyle iki kez eklenebilir", () => {
    expect(validateSpecialties([row, { ...row, transaction_type: "Kiralık" }], allowed).ok).toBe(true);
    expect(validateSpecialties([row, { ...row, transaction_type: null }], allowed).ok).toBe(true);
  });
});

describe("bölge doğrulama", () => {
  const P = "11111111-1111-4111-8111-111111111111";
  const D = "22222222-2222-4222-8222-222222222222";
  const N = "33333333-3333-4333-8333-333333333333";
  it("il > ilçe > mahalle hiyerarşisini zorlar", () => {
    expect(validateRegions([{ province_id: P, weight: 5 }]).ok).toBe(true);
    expect(validateRegions([{ province_id: P, district_id: D, weight: 4 }]).ok).toBe(true);
    expect(validateRegions([{ province_id: P, district_id: D, neighborhood_id: N, weight: 1 }]).ok).toBe(true);
    expect(validateRegions([{ province_id: P, neighborhood_id: N, weight: 3 }]).ok).toBe(false);
    expect(validateRegions([{ province_id: "x", weight: 3 }]).ok).toBe(false);
    expect(validateRegions([{ province_id: P, weight: 6 }]).ok).toBe(false);
    expect(validateRegions([{ province_id: P, weight: 0 }]).ok).toBe(false);
    expect(validateRegions([{ province_id: P }, { province_id: P }]).ok).toBe(false);
    expect(validateRegions([{ province_id: P }, { province_id: P, district_id: D }]).ok).toBe(true);
  });
});

describe("fark hesabı", () => {
  it("ekle / güncelle / sil ayrımı yapar (tam silme yok)", () => {
    const existing = [
      { id: "1", kind: "property_type", value: "Arsa", transaction_type: null, level: 2, price_min: null, price_max: null, experience_years: null },
      { id: "2", kind: "property_type", value: "Daire", transaction_type: null, level: 2, price_min: null, price_max: null, experience_years: null },
    ] as (SpecialtyRow & { id: string })[];
    const next: SpecialtyRow[] = [
      { ...existing[0]!, level: 3 },
      { kind: "segment", value: "Lüks konut", transaction_type: null, level: 1, price_min: null, price_max: null, experience_years: null },
    ];
    const d = diffByKey<SpecialtyRow>(existing, next, specialtyKey, (a, b) => a.level !== b.level);
    expect(d.update.map((u) => u.id)).toEqual(["1"]);
    expect(d.insert.map((r) => r.value)).toEqual(["Lüks konut"]);
    expect(d.remove).toEqual(["2"]);
  });
  it("bölge anahtarı il/ilçe/mahalleye göre ayırır", () => {
    const a: RegionRow = { province_id: "p", district_id: null, neighborhood_id: null, weight: 3 };
    expect(regionKey(a)).not.toBe(regionKey({ ...a, district_id: "d" }));
  });
});
