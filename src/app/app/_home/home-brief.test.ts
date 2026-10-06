import { describe, expect, it } from "vitest";
import type { Insight } from "@/lib/insights/types";
import { buildCallRows, evidenceChips, leadReasons, pickBriefing, scheduleWarnings, scheduleWarningText, sortInsights } from "./home-brief";

function ins(over: Partial<Insight> & { id: string }): Insight {
  return {
    kind: "deal_risk",
    ruleId: "deal_risk@1",
    severity: "orta",
    priority: 50,
    title: "Başlık",
    why: "Neden",
    evidence: [],
    href: "/app/anlasmalar",
    entityType: null,
    entityId: null,
    isForecast: false,
    confidence: null,
    state: "new",
    snoozedUntil: null,
    validUntil: "2099-01-01T00:00:00Z",
    createdAt: "2026-10-01T00:00:00Z",
    narrative: null,
    narrativeSource: "rule",
    ...over,
  };
}

describe("pickBriefing", () => {
  it("içgörü yoksa kural tabanlı geri dönüş (sahte içgörü üretmez)", () => {
    expect(pickBriefing([])).toEqual({ mode: "fallback", focus: null, rows: [], total: 0 });
  });
  it("en yüksek öncelik odak olur, kalanlar en çok 4 kompakt satır", () => {
    const list = [ins({ id: "a", priority: 10 }), ins({ id: "b", priority: 90 }), ...["c", "d", "e", "f", "g"].map((id, i) => ins({ id, priority: 40 - i }))];
    const b = pickBriefing(list, 12);
    expect(b.mode).toBe("insight");
    expect(b.focus?.id).toBe("b");
    expect(b.rows.map((r) => r.id)).toEqual(["c", "d", "e", "f"]);
    expect(b.total).toBe(12);
  });
  it("toplam, listeden küçük verilirse listeye yükseltilir", () => {
    expect(pickBriefing([ins({ id: "a" }), ins({ id: "b" })], 0).total).toBe(2);
  });
  it("özet (digest) odak olmaz, ama başka içgörü varsa satırlarda kalır", () => {
    const b = pickBriefing([ins({ id: "d", kind: "digest", priority: 99 }), ins({ id: "x", priority: 5 })]);
    expect(b.focus?.id).toBe("x");
    expect(b.rows.map((r) => r.id)).toEqual(["d"]);
  });
  it("öncelik eşitse şiddet, o da eşitse okuyucu sırası", () => {
    const s = sortInsights([ins({ id: "1", severity: "bilgi" }), ins({ id: "2", severity: "yuksek" }), ins({ id: "3", severity: "yuksek" })]);
    expect(s.map((x) => x.id)).toEqual(["2", "3", "1"]);
  });
});

describe("evidenceChips", () => {
  it("boş etiket/değeri eler ve sınırlar", () => {
    const chips = evidenceChips({ evidence: [{ label: "A", value: "1" }, { label: " ", value: "2" }, { label: "B", value: "" }, { label: "C", value: "3" }] }, 2);
    expect(chips.map((c) => c.label)).toEqual(["A", "C"]);
  });
});

describe("buildCallRows (nedenli arama listesi)", () => {
  const leads = [
    { id: "c1", fullName: "Ayşe Yılmaz", phone: "05320000000", reasons: ["Açık talep"] },
    { id: "c2", fullName: "Mehmet Kaya", phone: null, reasons: [] },
  ];
  it("call_priority içgörüsü önce gelir, kanıtları neden olur, sıcak liste tekrar edilmez", () => {
    const call = ins({
      id: "i1",
      kind: "call_priority",
      title: "Ayşe Yılmaz ile görüş",
      entityType: "customer",
      entityId: "c1",
      href: "/app/musteriler/c1",
      evidence: [
        { label: "Sessizlik", value: "21 gün" },
        { label: "Açık talep", value: "2" },
      ],
    });
    const rows = buildCallRows(leads, [call]);
    expect(rows.map((r) => r.key)).toEqual(["i-i1", "l-c2"]);
    expect(rows[0]).toMatchObject({ name: "Ayşe Yılmaz", phone: "05320000000", source: "insight", reasons: ["Sessizlik: 21 gün", "Açık talep: 2"] });
    expect(rows[1]).toMatchObject({ source: "lead", reasons: ["Sıcak müşteri"], href: "/app/musteriler/c2" });
  });
  it("her satırın nedeni vardır (skor değil gerekçe) ve sınır uygulanır", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, fullName: `M${i}`, phone: null, reasons: [] }));
    const rows = buildCallRows(many, [], 6);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.reasons.length > 0)).toBe(true);
  });
  it("içgörü müşteriye bağlı değilse yine de satır olur (href içgörüden)", () => {
    const rows = buildCallRows([], [ins({ id: "z", kind: "call_priority", title: "Veli ile görüş", href: "/app/talepler" })]);
    expect(rows[0]).toMatchObject({ customerId: null, name: "Veli", href: "/app/talepler" });
  });
});

describe("leadReasons", () => {
  it("önemsiz bileşenleri eler, puana göre sıralar, yakın etkileşimi ekler", () => {
    const r = leadReasons([
      { label: "Telefon var", points: 12 },
      { label: "Kaynak kalitesi", points: 15 },
      { label: "Açık talep", points: 20 },
      { label: "Randevu", points: 9 },
      { label: "Güncellik", points: 14 },
    ]);
    expect(r).toEqual(["Açık talep", "Randevu", "Yakın zamanda etkileşim"]);
  });
  it("hiç anlamlı bileşen yoksa boş", () => {
    expect(leadReasons([{ label: "Telefon var", points: 12 }])).toEqual([]);
  });
});

describe("scheduleWarnings (rota uyarısı)", () => {
  const T = (h: number, m = 0) => Date.UTC(2026, 9, 6, h, m);
  it("45 dakikadan kısa ardışık randevuyu uyarır", () => {
    const w = scheduleWarnings([T(10), T(10, 30), T(14)]);
    expect(w).toEqual([{ fromIndex: 0, toIndex: 1, gapMin: 30 }]);
    expect(scheduleWarningText(w[0]!)).toContain("30 dk");
  });
  it("sırasız girdide de doğru çifti bulur; aynı saat ayrı mesaj", () => {
    const w = scheduleWarnings([T(11), T(9), T(11)]);
    expect(w).toHaveLength(1);
    expect(scheduleWarningText(w[0]!)).toBe("Aynı saatte iki randevu var");
  });
  it("tek/boş program uyarı üretmez", () => {
    expect(scheduleWarnings([])).toEqual([]);
    expect(scheduleWarnings([T(9)])).toEqual([]);
  });
});
