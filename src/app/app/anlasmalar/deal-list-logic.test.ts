import { describe, expect, it } from "vitest";
import { dealStageTone, parseStageParam, sumDeals, updatedAgoLabel, winRate } from "./deal-list-logic";

describe("anlaşma liste mantığı", () => {
  it("aşama paramı bilinen değer ya da 'acik'", () => {
    expect(parseStageParam("won")).toBe("won");
    expect(parseStageParam("acik")).toBe("acik");
    expect(parseStageParam("x")).toBe("");
    expect(parseStageParam(undefined)).toBe("");
  });
  it("tonlar: kazanıldı success, kayıp danger, pazarlık warning", () => {
    expect(dealStageTone("won")).toBe("success");
    expect(dealStageTone("lost")).toBe("danger");
    expect(dealStageTone("negotiation")).toBe("warning");
    expect(dealStageTone("?")).toBe("neutral");
  });
  it("toplamlar: açık hat, olasılık ağırlığı (boşsa %20), kazanılan; kayıp sayılmaz", () => {
    const sums = sumDeals(
      [
        { stage: "new", deal_value: 1000, probability: null },
        { stage: "negotiation", deal_value: 1000, probability: 50 },
        { stage: "won", deal_value: 500, probability: 100 },
        { stage: "lost", deal_value: 9999, probability: 0 },
      ],
      100,
    );
    expect(sums).toEqual({ openValue: 2000, weighted: 700, wonValue: 500 });
  });
  it("tarama tavana dayanırsa toplam yok (null)", () => {
    expect(sumDeals([{ stage: "new", deal_value: 1, probability: 1 }], 1)).toBeNull();
  });
  it("kazanma oranı sonuçlananlar içinde; payda 0 → null", () => {
    expect(winRate(3, 1)).toBe(75);
    expect(winRate(0, 0)).toBeNull();
  });
  it("güncelleme etiketi", () => {
    expect(updatedAgoLabel(0)).toBe("Bugün");
    expect(updatedAgoLabel(1)).toBe("Dün");
    expect(updatedAgoLabel(9)).toBe("9 gün önce");
  });
});
