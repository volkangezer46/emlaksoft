import { describe, expect, it } from "vitest";
import {
  STALE_DAYS,
  daysInStageLabel,
  dealStageTone,
  parseStageParam,
  stageAgeTone,
  stageStaleDays,
  staleOrClause,
  sumDeals,
  uniformStaleDays,
  updatedAgoLabel,
  winRate,
} from "./deal-list-logic";

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

describe("SP1 aşamaya özel bayatlık", () => {
  it("aşama ayarı > 0 ise o, değilse genel eşik", () => {
    expect(stageStaleDays(14, { negotiation: 7, new: 0, qualified: "x" })).toEqual({ new: 14, qualified: 14, negotiation: 7 });
    expect(stageStaleDays(0, {})).toEqual({ new: STALE_DAYS, qualified: STALE_DAYS, negotiation: STALE_DAYS });
  });

  it("ton: eşikte uyarı, iki katında geç; kapanmış aşama her zaman ok", () => {
    const t = { new: 10, qualified: 10, negotiation: 5 };
    expect(stageAgeTone("negotiation", 4, t)).toBe("ok");
    expect(stageAgeTone("negotiation", 5, t)).toBe("warn");
    expect(stageAgeTone("negotiation", 10, t)).toBe("late");
    expect(stageAgeTone("won", 400, t)).toBe("ok");
  });

  it("or ifadesi her açık aşama için kendi kesim anını taşır", () => {
    const clause = staleOrClause({ new: 1, qualified: 2, negotiation: 3 }, (d) => `T${d}`);
    expect(clause).toBe("and(stage.eq.new,stage_changed_at.lt.T1),and(stage.eq.qualified,stage_changed_at.lt.T2),and(stage.eq.negotiation,stage_changed_at.lt.T3)");
    expect(uniformStaleDays({ new: 3, qualified: 3, negotiation: 3 })).toBe(3);
    expect(uniformStaleDays({ new: 3, qualified: 4, negotiation: 3 })).toBeNull();
    expect(daysInStageLabel(0)).toBe("Bu aşamaya bugün geçti");
  });
});

