import { describe, expect, it } from "vitest";
import { activityStatus, buildGoalView, deltaOf, monthEndEstimate, postSetupKind, heroSentence, heroSentenceParts, heroStatusCounts, salesSeries, salesSummary, setupChecklist, type SalesRow } from "./core";

// 16 Ekim 2026 12:00 TR (09:00 UTC)
const NOW = Date.UTC(2026, 9, 16, 9);
const at = (m: number, d: number) => new Date(Date.UTC(2026, m, d, 9)).toISOString();

describe("satış performansı serisi", () => {
  const rows: SalesRow[] = [
    { value: 3_000_000, createdAt: at(9, 7), closedAt: at(9, 7) },
    { value: 3_455_000, createdAt: at(9, 7), closedAt: at(9, 7) },
    { value: 1_000_000, createdAt: at(8, 1), closedAt: at(8, 20) },
  ];
  it("'Bu ay' haftalık kova toplamı — birikimli merdiven değil", () => {
    const s = salesSeries(rows, "ay", NOW);
    expect(s.map((x) => x.label)).toEqual(["1–7 Eki", "8–14 Eki", "15–16 Eki"]);
    expect(s.map((x) => x.value)).toEqual([6_455_000, 0, 0]);
  });
  it("'Son 6 ay' aylık kova", () => {
    const s = salesSeries(rows, "6ay", NOW);
    expect(s).toHaveLength(6);
    expect(s.at(-1)).toEqual({ label: "Eki", value: 6_455_000 });
    expect(s.at(-2)).toEqual({ label: "Eyl", value: 1_000_000 });
  });
  it("aynı gün açılıp kapanan satışlar '0 gün' üretmez: süre yok + açıklama", () => {
    const s = salesSummary(rows, "ay", NOW);
    expect(s.avgDays).toBeNull();
    expect(s.avgNote).toBeTruthy();
    expect(s.avgDelta).toBeNull();
  });
});

describe("deltaOf", () => {
  it("tek kural: önceki 0 → yeni; çok küçük taban → yeni; asla %6300", () => {
    expect(deltaOf(64, 0)!.text).toBe("yeni");
    expect(deltaOf(64, 1)!.text).toBe("yeni");
    expect(deltaOf(261_500, 146_000)!.text).toBe("%79");
  });
});

describe("v4 kahraman ve paneller (saf)", () => {
  it("özet cümlesi parçaları heroSentence ile aynı metni verir; sayılar kalın", () => {
    const i = { appointments: 3, demands: 5, listingUpdates: 9, mine: false };
    const parts = heroSentenceParts(i);
    expect(parts.map((p) => p.text).join("")).toBe(heroSentence(i));
    expect(parts.filter((p) => p.strong).map((p) => p.text)).toEqual(["3", "5", "9"]);
    expect(heroSentenceParts({ appointments: 0, demands: null, listingUpdates: null, mine: true })).toHaveLength(1);
  });
  it("durum hapları: acil kalemlerin toplamı + onay sayısı; tutar kalemi (count yok) sayılmaz", () => {
    expect(
      heroStatusCounts([
        { id: "tahsilat", level: "acil", count: 7 },
        { id: "gorev", level: "acil", count: 5 },
        { id: "onay", level: "yuksek", count: 3 },
        { id: "komisyon", level: "orta" },
      ]),
    ).toEqual({ overdue: 12, approvals: 3 });
  });
  it("kurulum listesi: sıradaki adım kalır, önünde en çok 2 tamam, isteğe bağlı adım yok, en çok 4", () => {
    const steps = [
      { id: "a", done: true },
      { id: "b", done: true },
      { id: "c", done: true },
      { id: "o", done: false, optional: true },
      { id: "d", done: false },
      { id: "e", done: false },
      { id: "f", done: false },
    ];
    const list = setupChecklist(steps, "d");
    expect(list.map((s) => s.id)).toEqual(["b", "c", "d", "e"]);
    expect(list.find((s) => s.next)?.id).toBe("d");
  });
  it("faaliyet adı denetim kaydından; bilinmeyen kayıt uydurulmaz", () => {
    expect(activityStatus("property.update", "property")).toBe("İlan güncelliyor");
    expect(activityStatus("appointment.create", null)).toBe("Müşteri görüşmesi");
    expect(activityStatus("property_media.upload", "property_media")).toBe("Fotoğraf yüklüyor");
    expect(activityStatus("x.y", "zzz")).toBe("Sistemde çalışıyor");
  });
});

describe("kurulum sonrası kart (aynı yerde rol kartı)", () => {
  it("rol seçimi: yönetim ofis geneli → ofis hedefi; Benim işlerim / danışman → kişisel; muhasebe → ay sonu kapanışı", () => {
    expect(postSetupKind({ role: "owner", isManagement: true, scopeMine: false })).toBe("office-goal");
    expect(postSetupKind({ role: "gm", isManagement: true, scopeMine: false })).toBe("office-goal");
    expect(postSetupKind({ role: "owner", isManagement: true, scopeMine: true })).toBe("personal-goal");
    expect(postSetupKind({ role: "advisor", isManagement: false, scopeMine: true })).toBe("personal-goal");
    expect(postSetupKind({ role: "team_lead", isManagement: false, scopeMine: true })).toBe("personal-goal");
    expect(postSetupKind({ role: "accounting", isManagement: false, scopeMine: true })).toBe("month-close");
  });

  it("hedef yoksa yüzde/tahmin üretilmez (sahte ilerleme yok), kalan gün korunur", () => {
    const v = buildGoalView({ targetRevenue: null, targetDeals: 0, actualRevenue: 500_000, wonDeals: 2, canSeeMoney: true, elapsedPct: 50, daysLeft: 15 });
    expect(v).toEqual({ state: "no-target", daysLeft: 15 });
  });

  it("tutar hedefi: halka %, etiketli ay sonu tahmini (doğrusal), aşımda halka 100", () => {
    const v = buildGoalView({ targetRevenue: 3_000_000, targetDeals: 5, actualRevenue: 1_500_000, wonDeals: 2, canSeeMoney: true, elapsedPct: 50, daysLeft: 15 });
    expect(v).toMatchObject({ state: "tracking", metric: "revenue", pct: 50, ringPct: 50, estimate: 3_000_000, exceeded: false });
    const over = buildGoalView({ targetRevenue: 1_000_000, targetDeals: null, actualRevenue: 1_200_000, wonDeals: null, canSeeMoney: true, elapsedPct: 60, daysLeft: 12 });
    expect(over).toMatchObject({ pct: 120, ringPct: 100, exceeded: true });
  });

  it("komisyon görmeyen kullanıcıda kapanış hedefine düşer; tahmin yok", () => {
    const v = buildGoalView({ targetRevenue: 3_000_000, targetDeals: 4, actualRevenue: null, wonDeals: 1, canSeeMoney: false, elapsedPct: 50, daysLeft: 15 });
    expect(v).toMatchObject({ state: "tracking", metric: "deals", pct: 25, actual: 1, target: 4, estimate: null });
  });

  it("ay sonu tahmini ayın ilk %10'unda ve gerçekleşme yokken üretilmez", () => {
    expect(monthEndEstimate(100_000, 5)).toBeNull();
    expect(monthEndEstimate(0, 50)).toBeNull();
    expect(monthEndEstimate(100_000, 100)).toBeNull();
    expect(monthEndEstimate(100_000, 25)).toBe(400_000);
  });
});
