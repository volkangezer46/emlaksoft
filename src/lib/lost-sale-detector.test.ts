import { describe, expect, it } from "vitest";
import { computeFragileDealType } from "./lost-sale-detector";

function deal(stage: string, deal_type: string | null) {
  return { stage, deal_type };
}

describe("computeFragileDealType", () => {
  it("kayıp oranı %50 ve üzeri, en az 4 kapanışı olan türü döner", () => {
    const deals = [
      deal("lost", "sale"), deal("lost", "sale"), deal("won", "sale"), deal("won", "sale"),
      deal("won", "rent"), deal("won", "rent"), deal("won", "rent"), deal("won", "rent"),
    ];
    expect(computeFragileDealType(deals)).toBe("sale");
  });

  it("4'ten az kapanışı olan türü kırılgan saymaz (yetersiz veri)", () => {
    const deals = [deal("lost", "rent"), deal("lost", "rent"), deal("won", "rent")];
    expect(computeFragileDealType(deals)).toBeNull();
  });

  it("kayıp oranı %50'nin altındaysa kırılgan saymaz", () => {
    const deals = [
      deal("lost", "sale"), deal("won", "sale"), deal("won", "sale"), deal("won", "sale"), deal("won", "sale"),
    ];
    expect(computeFragileDealType(deals)).toBeNull();
  });

  it("her iki tür de eşiği geçerse daha yüksek kayıp oranına sahip olanı döner", () => {
    const deals = [
      // sale: 2/4 = %50
      deal("lost", "sale"), deal("lost", "sale"), deal("won", "sale"), deal("won", "sale"),
      // rent: 3/4 = %75
      deal("lost", "rent"), deal("lost", "rent"), deal("lost", "rent"), deal("won", "rent"),
    ];
    expect(computeFragileDealType(deals)).toBe("rent");
  });

  it("geçersiz/eksik deal_type kayıtlarını yok sayar", () => {
    const deals = [
      deal("lost", null), deal("won", "diğer"),
      deal("lost", "sale"), deal("lost", "sale"), deal("won", "sale"), deal("won", "sale"),
    ];
    expect(computeFragileDealType(deals)).toBe("sale");
  });

  it("hiç kapanış yoksa null döner", () => {
    expect(computeFragileDealType([])).toBeNull();
  });
});
