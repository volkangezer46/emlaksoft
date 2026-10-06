import { describe, expect, it } from "vitest";
import {
  evaluateCronErrors,
  evaluateEfDrift,
  evaluatePaymentFailures,
  evaluateRiskyOffices,
  evaluateTrialIdle,
} from "./platform";

const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
const DAY = 86_400_000;

describe("platform kuralları: veri yoksa içgörü yok", () => {
  it("olgu boş/yetersiz ise taslak üretmez", () => {
    expect(evaluatePaymentFailures(null, NOW)).toEqual([]);
    expect(evaluatePaymentFailures({ recent: 2, previous: 0, windowDays: 7 }, NOW)).toEqual([]);
    expect(evaluateEfDrift(null, NOW)).toEqual([]);
    expect(evaluateCronErrors([], NOW)).toEqual([]);
    expect(evaluateRiskyOffices([], NOW)).toEqual([]);
    expect(evaluateTrialIdle([], NOW)).toEqual([]);
  });
});

describe("ödeme başarısızlığı artışı", () => {
  it("en az 3 ve önceki dönemin 2 katı ise üretir; gözlem etiketli (tahmin değil)", () => {
    const [d] = evaluatePaymentFailures({ recent: 4, previous: 1, windowDays: 7 }, NOW);
    expect(d.kind).toBe("payment_risk");
    expect(d.isForecast).toBe(false);
    expect(d.href.startsWith("/admin")).toBe(true);
  });
  it("önceki dönem de yüksekse (artış yok) üretmez", () => {
    expect(evaluatePaymentFailures({ recent: 4, previous: 4, windowDays: 7 }, NOW)).toEqual([]);
  });
  it("aynı hafta aynı anahtar (tekrar çalışma ikinci içgörü üretmez)", () => {
    const a = evaluatePaymentFailures({ recent: 4, previous: 0, windowDays: 7 }, NOW)[0];
    const b = evaluatePaymentFailures({ recent: 6, previous: 0, windowDays: 7 }, NOW + DAY / 2)[0];
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });
});

describe("EF mutabakat sapması", () => {
  const run = { id: "r1", status: "drift", runAt: new Date(NOW - DAY).toISOString(), diffDegerleme: 3, diffPdf: -1 };
  it("taze drift için üretir, ok/eski için üretmez", () => {
    expect(evaluateEfDrift(run, NOW)).toHaveLength(1);
    expect(evaluateEfDrift({ ...run, status: "ok" }, NOW)).toEqual([]);
    expect(evaluateEfDrift({ ...run, runAt: new Date(NOW - 5 * DAY).toISOString() }, NOW)).toEqual([]);
  });
});

describe("hata veren cron", () => {
  it("tek içgörüde toplanır; 3+ iş yüksek şiddet", () => {
    const rows = ["a", "b", "c"].map((job) => ({ job, lastRunAt: new Date(NOW).toISOString() }));
    const [d] = evaluateCronErrors(rows, NOW);
    expect(d.severity).toBe("yuksek");
    expect(d.title).toContain("3");
  });
});

describe("riskli ofis ve deneme", () => {
  it("riskli ofis üst sınırı 10", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ tenantId: `t${i}`, name: `Ofis ${i}` }));
    expect(evaluateRiskyOffices(rows, NOW)).toHaveLength(10);
  });
  it("deneme bitimi yaklaşan ve etkileşimsiz ofis TAHMİN etiketli üretilir", () => {
    const [d] = evaluateTrialIdle([{ tenantId: "t1", name: "Demo", trialEndsAt: new Date(NOW + 2 * DAY).toISOString(), activity7d: 1 }], NOW);
    expect(d.isForecast).toBe(true);
    expect(d.confidence).toBe("dusuk");
  });
  it("etkileşimli ya da uzak bitişli deneme için üretmez", () => {
    expect(evaluateTrialIdle([{ tenantId: "t1", name: "A", trialEndsAt: new Date(NOW + 2 * DAY).toISOString(), activity7d: 50 }], NOW)).toEqual([]);
    expect(evaluateTrialIdle([{ tenantId: "t1", name: "A", trialEndsAt: new Date(NOW + 10 * DAY).toISOString(), activity7d: 0 }], NOW)).toEqual([]);
  });
});
