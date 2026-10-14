import { describe, expect, it } from "vitest";
import { parseFilters } from "./filters";
import { getReport, TENANT_REPORT_LIST, PLATFORM_REPORT_LIST } from "./registry";
import { cleanViewFilters, savedViewHref, storedViewFilters } from "./saved-views";
import { reportChartFromTable } from "./chart";
import {
  isoWeekday,
  isSchedulable,
  nextRunDay,
  periodRange,
  runDayStartIso,
  scheduledFilters,
  subscriptionInputSchema,
  trKeyOf,
} from "./schedule";

describe("zamanlama (TR takvim günü)", () => {
  it("ISO hafta günü", () => {
    expect(isoWeekday("2026-10-19")).toBe(1); // Pazartesi
    expect(isoWeekday("2026-10-25")).toBe(7); // Pazar
  });

  it("haftalık: sonraki uygun gün, aynı gün DAHİL değil", () => {
    expect(nextRunDay({ frequency: "weekly", weekday: 1, monthDay: null }, "2026-10-14")).toBe("2026-10-19");
    expect(nextRunDay({ frequency: "weekly", weekday: 1, monthDay: null }, "2026-10-19")).toBe("2026-10-26");
  });

  it("günlük ve aylık (ay günü 1-28, ay/yıl geçişi)", () => {
    expect(nextRunDay({ frequency: "daily", weekday: null, monthDay: null }, "2026-12-31")).toBe("2027-01-01");
    expect(nextRunDay({ frequency: "monthly", weekday: null, monthDay: 3 }, "2026-10-14")).toBe("2026-11-03");
    expect(nextRunDay({ frequency: "monthly", weekday: null, monthDay: 28 }, "2027-02-28")).toBe("2027-03-28");
  });

  it("next_run_at TR gece yarısıdır; TR gününe geri döner", () => {
    expect(runDayStartIso("2026-10-19")).toBe("2026-10-18T21:00:00.000Z");
    expect(trKeyOf(Date.parse(runDayStartIso("2026-10-19")))).toBe("2026-10-19");
    expect(trKeyOf(Date.parse("2026-10-18T22:30:00Z"))).toBe("2026-10-19");
  });

  it("göreli dönem: dün / son 7 gün / geçen takvim ayı", () => {
    expect(periodRange("daily", "2026-10-19")).toEqual({ from: "2026-10-18", to: "2026-10-18" });
    expect(periodRange("weekly", "2026-10-19")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(periodRange("monthly", "2026-03-03")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("monthly", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("teslim filtreleri: göreli dönem tarih aralığını değiştirir, diğer filtreler korunur", () => {
    const def = getReport("tenant", "musteriler")!;
    const f = scheduledFilters(def, { type: "Alıcı", from: "2020-01-01", to: "2020-01-31" }, { frequency: "weekly", relativeRange: true }, "2026-10-19");
    expect(f).toEqual({ type: "Alıcı", from: "2026-10-12", to: "2026-10-18" });
    expect(scheduledFilters(def, { from: "2020-01-01" }, { frequency: "weekly", relativeRange: false }, "2026-10-19")).toEqual({ from: "2020-01-01" });
  });
});

describe("zamanlanabilir raporlar", () => {
  it("kiracıda yalnız sorgu kaynaklı (açık kiracı+aktör süzgeçli) raporlar; platformda hepsi", () => {
    for (const def of TENANT_REPORT_LIST) expect(isSchedulable(def)).toBe(def.source.kind === "query");
    for (const def of PLATFORM_REPORT_LIST) expect(isSchedulable(def)).toBe(true);
    expect(TENANT_REPORT_LIST.filter(isSchedulable).length).toBeGreaterThan(20);
  });
});

describe("abonelik girdisi", () => {
  const base = { reportId: "musteriler", name: "Haftalık müşteri", format: "xlsx", recipientIds: ["22222222-2222-4222-8222-222222222222"] };
  it("haftalık gün ister, aylık ay günü ister", () => {
    expect(subscriptionInputSchema.safeParse({ ...base, frequency: "weekly" }).success).toBe(false);
    expect(subscriptionInputSchema.safeParse({ ...base, frequency: "monthly", monthDay: 31 }).success).toBe(false);
    const ok = subscriptionInputSchema.parse({ ...base, frequency: "weekly", weekday: 1, monthDay: 5 });
    expect(ok.monthDay).toBeNull();
    expect(ok.weekday).toBe(1);
  });
  it("alıcı 1-10, tekilleşir; biçim yalnız xlsx/pdf/csv", () => {
    expect(subscriptionInputSchema.safeParse({ ...base, frequency: "daily", recipientIds: [] }).success).toBe(false);
    const many = Array.from({ length: 11 }, (_, i) => `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`);
    expect(subscriptionInputSchema.safeParse({ ...base, frequency: "daily", recipientIds: many }).success).toBe(false);
    expect(subscriptionInputSchema.safeParse({ ...base, frequency: "daily", format: "docx" }).success).toBe(false);
    const dup = subscriptionInputSchema.parse({ ...base, frequency: "daily", recipientIds: [base.recipientIds[0], base.recipientIds[0].toUpperCase()] });
    expect(dup.recipientIds).toHaveLength(1);
  });
});

describe("kayıtlı görünüm: açılınca filtreler AYNEN gelir", () => {
  it("kaydet → sakla (jsonb) → aç (URL) → rapor filtreleri birebir aynı", () => {
    const def = getReport("tenant", "musteriler")!;
    const applied = { q: "Ayşe Yılmaz", type: "Alıcı", from: "2026-09-01", to: "2026-09-30", assigned: "33333333-3333-4333-8333-333333333333" };
    const saved = cleanViewFilters(def, applied);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const stored = JSON.parse(JSON.stringify(saved.filters)); // jsonb gidiş-dönüşü
    const reopened = storedViewFilters(def, stored);
    const href = savedViewHref("tenant", def.id, reopened);
    const url = new URL(href, "https://emlaksoft.com.tr");
    expect(url.pathname).toBe("/app/raporlar");
    expect(url.searchParams.get("sekme")).toBe("merkez");
    expect(url.searchParams.get("rapor")).toBe("musteriler");
    const parsed = parseFilters(def, url.searchParams);
    expect(parsed).toEqual({ ok: true, filters: applied });
  });

  it("tanımda olmayan anahtar atılır, geçersiz kayıt boş filtreye düşer (rapor yine açılır)", () => {
    const def = getReport("tenant", "musteriler")!;
    expect(storedViewFilters(def, { type: "Alıcı", sayfa: "3", hack: "x" })).toEqual({ type: "Alıcı" });
    expect(cleanViewFilters(def, { type: "olmayan-tur" }).ok).toBe(false);
    expect(storedViewFilters(def, { from: "2026-02-30" })).toEqual({});
    expect(storedViewFilters(def, null)).toEqual({});
  });
});

describe("önizleme grafiği", () => {
  const cols = [
    { key: "d", label: "Danışman", type: "text" as const },
    { key: "t", label: "Tutar", type: "money" as const, total: true },
  ];
  it("kategoriye göre toplar, büyükten küçüğe", () => {
    const c = reportChartFromTable({ columns: cols, rows: [["Ali", 10], ["Veli", 30], ["Ali", 5]] });
    expect(c?.bars).toEqual([{ label: "Veli", value: 30 }, { label: "Ali", value: 15 }]);
    expect(c?.format).toBe("money");
  });
  it("tek kategori ya da tek satırda grafik yok", () => {
    expect(reportChartFromTable({ columns: cols, rows: [["Ali", 10], ["Ali", 5]] })).toBeNull();
    expect(reportChartFromTable({ columns: cols, rows: [["Ali", 10]] })).toBeNull();
  });
  it("tarih sütununda kronolojik, sayı sütunu yoksa kayıt sayısı", () => {
    const c = reportChartFromTable({ columns: [{ key: "a", label: "Kayıt", type: "date" }], rows: [["2026-03-02"], ["2026-01-05"], ["2026-03-09"]] });
    expect(c?.valueLabel).toBe("Kayıt sayısı");
    expect(c?.bars.map((b) => b.value)).toEqual([1, 2]);
  });
});
