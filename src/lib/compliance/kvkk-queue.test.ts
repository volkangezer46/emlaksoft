import { describe, expect, it } from "vitest";
import { kvkkDaysLeft, kvkkDaysLeftLabel, kvkkDeadlineIso, kvkkFlowHref, kvkkTone, parseKvkkFilters } from "./kvkk-queue";

const DAY = 86_400_000;

describe("KVKK kalan gün (TR takvim günü)", () => {
  it("son tarih = oluşturma + 30 gün", () => {
    expect(kvkkDeadlineIso("2026-10-01T10:00:00.000Z")).toBe("2026-10-31T10:00:00.000Z");
  });
  it("TR gün sınırı: UTC'de aynı gün olsa da TR'de ertesi gün sayılır", () => {
    // 2026-09-13 22:30 UTC = 14 Eylül 01:30 TR → son tarih 14 Ekim (TR). Şimdi 13 Ekim 12:00 TR → 1 gün kaldı.
    const now = Date.parse("2026-10-13T09:00:00Z");
    expect(kvkkDaysLeft("2026-09-13T22:30:00Z", "open", now)).toBe(1);
    // 2026-09-13 20:00 UTC = 13 Eylül 23:00 TR → son tarih 13 Ekim (TR) → son gün bugün.
    expect(kvkkDaysLeft("2026-09-13T20:00:00Z", "open", now)).toBe(0);
  });
  it("gecikmiş negatif, kapalı talepte sayaç yok", () => {
    const now = Date.parse("2026-10-13T09:00:00Z");
    expect(kvkkDaysLeft(new Date(now - 35 * DAY).toISOString(), "in_progress", now)).toBe(-5);
    expect(kvkkDaysLeft(new Date(now - 35 * DAY).toISOString(), "completed", now)).toBeNull();
    expect(kvkkDaysLeft(new Date(now - 35 * DAY).toISOString(), "rejected", now)).toBeNull();
  });
  it("ton ve etiket: gecikmiş kırmızı, ≤7 sarı", () => {
    expect(kvkkTone(-1)).toBe("late");
    expect(kvkkTone(0)).toBe("warn");
    expect(kvkkTone(7)).toBe("warn");
    expect(kvkkTone(8)).toBe("ok");
    expect(kvkkTone(null)).toBe("closed");
    expect(kvkkDaysLeftLabel(-3)).toBe("3 gün gecikti");
    expect(kvkkDaysLeftLabel(0)).toBe("Son gün bugün");
    expect(kvkkDaysLeftLabel(12)).toBe("12 gün kaldı");
  });
});

describe("KVKK kuyruk süzgeci ve akış bağlantısı", () => {
  it("bilinmeyen değer yok sayılır", () => {
    expect(parseKvkkFilters({ tur: "erasure", durum: "acik", sure: "gecikmis", sayfa: "2" })).toEqual({ tur: "erasure", durum: "acik", sure: "gecikmis", sayfa: 2 });
    expect(parseKvkkFilters({ tur: "x", durum: "y", sure: "z" })).toEqual({ tur: undefined, durum: undefined, sure: undefined, sayfa: 1 });
  });
  it("kapanış/dışa aktarma Yönetim'e, diğerleri Yasal sekmesine", () => {
    expect(kvkkFlowHref("t1", "account_closure")).toBe("/admin/tenants/t1?sekme=yonetim");
    expect(kvkkFlowHref("t1", "data_export")).toBe("/admin/tenants/t1?sekme=yonetim");
    expect(kvkkFlowHref("t1", "erasure")).toBe("/admin/tenants/t1?sekme=yasal");
  });
});
