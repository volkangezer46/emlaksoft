import { describe, expect, it } from "vitest";
import { buildControlReport, reportPeriodKey } from "./report-digest";

const base = { open: 0, overdue: 0, opened: 0, resolved: 0, topTypeLabel: null, topTypeCount: 0 };

describe("buildControlReport", () => {
  it("hiç veri yoksa rapor üretilmez", () => {
    expect(buildControlReport("daily", base)).toBeNull();
    expect(buildControlReport("weekly", base)).toBeNull();
  });
  it("süresi geçmiş uyarı varsa uyarı tonu ve kuyruk bağlantısı", () => {
    const r = buildControlReport("daily", { ...base, open: 5, overdue: 2, opened: 3, resolved: 1, topTypeLabel: "Portal ilanı kayıp", topTypeCount: 4 })!;
    expect(r.kind).toBe("warning");
    expect(r.href).toBe("/app/ilan-kontrol/anomaliler");
    expect(r.body).toContain("5 açık uyarı");
    expect(r.body).toContain("2 süresi geçmiş");
    expect(r.body).toContain("son 24 saatte 3 yeni, 1 çözüldü");
  });
  it("yalnız çözülen varsa da rapor üretilir ve rapor sayfasına gider", () => {
    const r = buildControlReport("weekly", { ...base, resolved: 2 })!;
    expect(r.title).toBe("Haftalık İlan Kontrol özeti");
    expect(r.href).toBe("/app/ilan-kontrol/rapor");
  });
});

describe("reportPeriodKey", () => {
  it("aynı gün/hafta aynı anahtar, ertesi gün farklı", () => {
    const t = Date.UTC(2026, 9, 6, 8);
    expect(reportPeriodKey("daily", t)).toBe(reportPeriodKey("daily", t + 3_600_000));
    expect(reportPeriodKey("daily", t)).not.toBe(reportPeriodKey("daily", t + 86_400_000));
    expect(reportPeriodKey("weekly", t)).toBe(reportPeriodKey("weekly", t + 86_400_000));
  });
});
