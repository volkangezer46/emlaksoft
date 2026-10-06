import { describe, expect, it } from "vitest";
import {
  activationFunnel,
  arpaSeries,
  churnReasons,
  embeddedCount,
  linearForecast,
  monthShortOfKey,
  monthlyUsage,
  moduleAdoption,
  nextMonthLabels,
  trialConversion,
} from "./platform-metrics";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("moduleAdoption", () => {
  it("SQL anahtarlarını Türkçe etikete çevirir, oranı hesaplar ve sıralar", () => {
    const rows = moduleAdoption([{ module: "deals", offices: 2 }, { module: "customers", offices: "4" }], 4);
    expect(rows[0]).toEqual({ id: "customers", label: "Müşteriler", offices: 4, pct: 100 });
    expect(rows[1]).toEqual({ id: "deals", label: "Anlaşmalar", offices: 2, pct: 50 });
    expect(rows.find((r) => r.id === "network")?.offices).toBe(0);
  });
  it("payda 0 ise bölme hatası yok", () => {
    expect(moduleAdoption([{ module: "tasks", offices: 1 }], 0).find((r) => r.id === "tasks")?.pct).toBe(100);
  });
});

describe("activationFunnel", () => {
  it("ardışık alt küme: anlaşması olup portföyü olmayan ofis 3. aşamaya girmez", () => {
    const f = activationFunnel([
      { properties: 3, deals: 1 },
      { properties: 1, deals: 0 },
      { properties: 0, deals: 2 },
      { properties: 0, deals: 0 },
    ]);
    expect(f).toEqual({ registered: 4, withProperty: 2, withDeal: 1 });
  });
  it("embeddedCount PostgREST gömülü sayımını okur", () => {
    expect(embeddedCount([{ count: 7 }])).toBe(7);
    expect(embeddedCount([])).toBe(0);
    expect(embeddedCount({ count: 2 })).toBe(2);
    expect(embeddedCount(null)).toBe(0);
  });
});

describe("trialConversion", () => {
  const rows = [
    { id: "a", status: "active", trial_ends_at: iso(NOW - 5 * DAY) },
    { id: "b", status: "active", trial_ends_at: iso(NOW - 10 * DAY) }, // aktif ama ödeyen değil (elle açılmış)
    { id: "c", status: "cancelled", trial_ends_at: iso(NOW - 20 * DAY) },
    { id: "d", status: "trial", trial_ends_at: iso(NOW + 3 * DAY) }, // henüz bitmedi
    { id: "e", status: "active", trial_ends_at: iso(NOW - 60 * DAY) }, // pencere dışı
    { id: "f", status: "active", trial_ends_at: null },
  ];
  it("yalnız penceresinde denemesi biten ve ücretli aktif aboneliği olanları sayar", () => {
    expect(trialConversion(rows, new Set(["a", "e"]), NOW, 30)).toEqual({ ended: 3, converted: 1, rate: 33 });
  });
  it("biten deneme yoksa oran null", () => {
    expect(trialConversion(rows, new Set(), NOW, 1)).toEqual({ ended: 0, converted: 0, rate: null });
  });
});

describe("arpaSeries", () => {
  it("aktif ofis yoksa null", () => {
    expect(arpaSeries([{ label: "Eyl", mrr: 0, offices: 0 }, { label: "Eki", mrr: 9980, offices: 4 }]).map((p) => p.arpa)).toEqual([null, 2495]);
  });
});

describe("linearForecast", () => {
  it("en az 3 gerçek ay yoksa tahmin yok", () => {
    expect(linearForecast([0, 0, 0, 100, 200])).toBeNull();
    expect(linearForecast([])).toBeNull();
    expect(linearForecast([0, 0])).toBeNull();
  });
  it("doğrusal artışı sürdürür; baştaki sıfırlar atılır", () => {
    const f = linearForecast([0, 0, 100, 200, 300, 400], 2);
    expect(f).toEqual({ values: [500, 600], slope: 100, basis: 4 });
  });
  it("düşüşte 0'ın altına inmez; pencere son 6 ay", () => {
    const f = linearForecast([900, 900, 900, 600, 300, 200, 100, 50], 3);
    expect(f!.basis).toBe(6);
    expect(f!.values.every((v) => v >= 0)).toBe(true);
  });
  it("ay etiketleri TR takvimi", () => {
    expect(nextMonthLabels(NOW, 3)).toEqual(["Kas", "Ara", "Oca"]);
    expect(monthShortOfKey("2026-02")).toBe("Şub");
  });
});

describe("churnReasons", () => {
  it("kırpar, büyük/küçük harfi yok sayar, boşu 'Neden belirtilmedi' yapar", () => {
    const r = churnReasons([
      { cancel_reason: "Fiyat yüksek" },
      { cancel_reason: "  fiyat   YÜKSEK " },
      { cancel_reason: null },
      { cancel_reason: "" },
      { cancel_reason: "Kullanmıyoruz" },
    ]);
    expect(r).toEqual([
      { reason: "Fiyat yüksek", count: 2 },
      { reason: "Neden belirtilmedi", count: 2 },
      { reason: "Kullanmıyoruz", count: 1 },
    ]);
  });
});

describe("monthlyUsage", () => {
  it("son 6 TR ayına birim bazında |amount| toplar; pencere dışı ve bilinmeyen birim atlanır", () => {
    const u = monthlyUsage(
      [
        { unit: "ai", amount: -2.5, available_at: "2026-10-01T00:30:00Z" },
        { unit: "ai", amount: "-1.5", available_at: "2026-09-30T22:30:00Z" }, // TR'de 1 Ekim 01:30
        { unit: "ef", amount: 3, available_at: "2026-05-10T10:00:00Z" },
        { unit: "ef", amount: 9, available_at: "2026-04-10T10:00:00Z" }, // pencere dışı
        { unit: "try", amount: 100, available_at: "2026-10-02T10:00:00Z" }, // bilinmeyen birim
      ],
      ["ai", "ef"],
      NOW,
    );
    expect(u.months.map((m) => m.label)).toEqual(["May", "Haz", "Tem", "Ağu", "Eyl", "Eki"]);
    expect(u.byUnit.ai).toEqual([0, 0, 0, 0, 0, 4]);
    expect(u.byUnit.ef).toEqual([3, 0, 0, 0, 0, 0]);
    expect(u.total).toBe(7);
  });
});
