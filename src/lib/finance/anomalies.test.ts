import { describe, expect, it } from "vitest";
import { categorySpikes, daysInMonth, findDuplicatePayments, normalizeParty, rankAttention, searchTextFor, type PaymentRow } from "./anomalies";

const hist = (cat: Record<string, number>[]) => cat.map((byCategory, i) => ({ month: `2026-0${7 + i}-01`, byCategory }));

describe("categorySpikes", () => {
  const history = hist([{ kira: 20000, yemek: 3000 }, { kira: 20000, yemek: 3200 }, { kira: 20000, yemek: 2800 }]);

  it("gerçekleşen tutar ortalamanın belirgin üstündeyse kesin uyarı verir", () => {
    const res = categorySpikes([...history, { month: "2026-10-01", byCategory: { kira: 20000, yemek: 7000 } }], "2026-10");
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ category: "yemek", basis: "actual", baseline: 3000, ratio: 2.33, severity: "high" });
    expect(res[0]!.z).toBeGreaterThan(3);
  });

  it("ay ortasında ayda bir ödenen kalem (kira) oranlanıp sahte artış üretmez", () => {
    expect(categorySpikes([...history, { month: "2026-10", byCategory: { kira: 20000, yemek: 2600 } }], "2026-10")).toEqual([]);
  });

  it("önem: düzenli kalemde z-skoru yüksek; dalgalı kalemde oran 1.5-1.75 düşük, 1.75-2 orta", () => {
    const flat = hist([{ x: 10000 }, { x: 10000 }, { x: 10000 }]);
    expect(categorySpikes([...flat, { month: "2026-10", byCategory: { x: 16000 } }], "2026-10")[0]!.severity).toBe("high");
    const noisy = hist([{ x: 6000 }, { x: 10000 }, { x: 14000 }]);
    expect(categorySpikes([...noisy, { month: "2026-10", byCategory: { x: 16000 } }], "2026-10")[0]!.severity).toBe("low");
    expect(categorySpikes([...noisy, { month: "2026-10", byCategory: { x: 18000 } }], "2026-10")[0]!.severity).toBe("medium");
  });

  it("küçük farkları (minDiff altı) ve normal ayları uyarı saymaz", () => {
    const res = categorySpikes([...history, { month: "2026-10-01", byCategory: { kira: 20500, yemek: 3100 } }], "2026-10");
    expect(res).toEqual([]);
  });

  it("önceki aylarda olmayan büyük kalem 'yeni' sayılır", () => {
    const res = categorySpikes([...history, { month: "2026-10-01", byCategory: { reklam: 5000, kirtasiye: 300 } }], "2026-10");
    expect(res).toEqual([expect.objectContaining({ category: "reklam", basis: "new", baseline: 0, ratio: null, severity: "low" })]);
  });

  it("yeterli geçmiş yoksa ya da bu ay yoksa uyarı yok", () => {
    expect(categorySpikes([history[0]!, { month: "2026-10-01", byCategory: { yemek: 9000 } }], "2026-10")).toEqual([]);
    expect(categorySpikes(history, "2026-10")).toEqual([]);
  });

  it("gelecek ayları geçmiş saymaz", () => {
    const res = categorySpikes([...history, { month: "2026-10-01", byCategory: { yemek: 7000 } }, { month: "2026-11-01", byCategory: { yemek: 1 } }], "2026-10");
    expect(res[0]!.baseline).toBe(3000);
  });
});

describe("daysInMonth", () => {
  it("şubat ve artık yıl", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-10")).toBe(31);
  });
});

describe("findDuplicatePayments", () => {
  const row = (id: string, date: string, amount: number, counterparty: string | null, title = "Ödeme"): PaymentRow => ({ id, date, amount, currency: "TRY", title, counterparty, category: "ofis" });

  it("aynı tutar + aynı karşı taraf + 3 gün içinde → şüpheli grup", () => {
    const res = findDuplicatePayments([row("a", "2026-10-01", 1500, "Enerjisa A.Ş."), row("b", "2026-10-03", 1500, "enerjisa a.ş"), row("c", "2026-10-20", 1500, "Enerjisa A.Ş.")]);
    expect(res).toEqual([{ label: "Enerjisa A.Ş.", amount: 1500, currency: "TRY", ids: ["a", "b"], from: "2026-10-01", to: "2026-10-03", count: 2 }]);
  });

  it("farklı tutar, farklı para birimi, küçük tutar ve uzak tarih gruplanmaz", () => {
    const res = findDuplicatePayments([
      row("a", "2026-10-01", 1500, "X"),
      row("b", "2026-10-02", 1500.5, "X"),
      { ...row("c", "2026-10-02", 1500, "X"), currency: "USD" },
      row("d", "2026-10-01", 50, "Y"),
      row("e", "2026-10-01", 50, "Y"),
      row("f", "2026-10-09", 1500, "X"),
    ]);
    expect(res).toEqual([]);
  });

  it("karşı taraf yoksa açıklamaya bakar; zincirleme kümeler", () => {
    const res = findDuplicatePayments([row("a", "2026-10-01", 900, null, "Temizlik"), row("b", "2026-10-03", 900, null, "temizlik!"), row("c", "2026-10-06", 900, null, "Temizlik")]);
    expect(res[0]).toMatchObject({ ids: ["a", "b", "c"], count: 3, label: "Temizlik" });
  });
});

describe("yardımcılar", () => {
  it("normalizeParty Türkçe küçük harf ve noktalama", () => expect(normalizeParty("  İSTANBUL, Ofis (A.Ş.) ")).toBe("istanbul ofis a ş"));
  it("searchTextFor süzgeç karakterlerini atar", () => expect(searchTextFor("A,B (C)%_*")).toBe("A B C"));
  it("rankAttention önem ve tutara göre sıralar, sınırlar", () => {
    const res = rankAttention(
      [
        { key: "a", severity: "low", title: "", text: "", href: "/", amount: 9999 },
        { key: "b", severity: "high", title: "", text: "", href: "/", amount: 1 },
        { key: "c", severity: "medium", title: "", text: "", href: "/", amount: 5 },
        { key: "d", severity: "medium", title: "", text: "", href: "/", amount: 50 },
      ],
      3,
    );
    expect(res.map((r) => r.key)).toEqual(["b", "d", "c"]);
  });
});
