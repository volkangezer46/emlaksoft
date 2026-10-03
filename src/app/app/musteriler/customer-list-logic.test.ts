import { describe, expect, it } from "vitest";
import { countCustomerTypes, customerTypeTone, heatTone, relativeFromDays } from "./customer-list-logic";

describe("heatTone", () => {
  it("segment → ton", () => {
    expect(heatTone("sicak")).toBe("warning");
    expect(heatTone("ilgili")).toBe("success");
    expect(heatTone("soguk")).toBe("info");
    expect(heatTone("uykuda")).toBe("neutral");
  });
});

describe("customerTypeTone", () => {
  it("bilinen tipler renkli, özel tip nötr (büyük/küçük harf duyarsız)", () => {
    expect(customerTypeTone("Alıcı")).toBe("info");
    expect(customerTypeTone("MÜLK SAHİBİ")).toBe("success");
    expect(customerTypeTone("Yatırımcı")).toBe("warning");
    expect(customerTypeTone("Kiracı")).toBe("neutral");
  });
});

describe("relativeFromDays", () => {
  it("gün/ay/yıl", () => {
    expect(relativeFromDays(0)).toBe("Bugün");
    expect(relativeFromDays(1)).toBe("Dün");
    expect(relativeFromDays(12)).toBe("12 gün önce");
    expect(relativeFromDays(65)).toBe("2 ay önce");
    expect(relativeFromDays(800)).toBe("2 yıl önce");
  });
});

describe("countCustomerTypes", () => {
  it("çoklu tipli müşteri her tipte bir kez sayılır, boşlar atlanır", () => {
    expect(
      countCustomerTypes([
        { customer_types: ["Alıcı", "Yatırımcı", "Alıcı"] },
        { customer_types: ["Alıcı"] },
        { customer_types: null },
        { customer_types: [" "] },
      ]),
    ).toEqual({ Alıcı: 2, Yatırımcı: 1 });
  });
});
