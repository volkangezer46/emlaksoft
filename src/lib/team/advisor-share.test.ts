import { describe, expect, it } from "vitest";
import { advisorShare, findAmbiguousNames, type ShareRow } from "./advisor-share";

const row = (over: Partial<ShareRow>): ShareRow => ({
  gross_amount: 100_000,
  status: "calculated",
  splits: [
    { label: "Ayşe Yılmaz", rate: 40 },
    { label: "Ofis", rate: 60 },
  ],
  deal: { assigned_to: "u1" },
  ...over,
});

describe("advisorShare etiket güvenliği (B7)", () => {
  it("başkasının anlaşmasındaki aynı adlı etiket payına sayılmaz", () => {
    // u2 profil adını 'Ayşe Yılmaz' yaptı; anlaşma u1'e atanmış
    expect(advisorShare(row({}), "Ayşe Yılmaz", "u2")).toBeNull();
  });
  it("kendi anlaşmasında etiket eşleşir; belirsiz adda uyarı eklenir", () => {
    const r = advisorShare(row({}), "Ayşe Yılmaz", "u1", { ambiguousNames: new Set(["Ayşe Yılmaz"]) });
    expect(r?.amount).toBe(40_000);
    expect(r?.note).toContain("aynı adlı kişi var");
  });
  it("profile_id varsa kesin kimlik: anlaşma atamasından bağımsız ve etiket yok sayılır", () => {
    const splits = [{ label: "Eski Ad", rate: 30, profile_id: "u2" }, { label: "Ayşe Yılmaz", rate: 40, profile_id: "u3" }];
    expect(advisorShare(row({ splits }), "Ayşe Yılmaz", "u2")?.amount).toBe(30_000);
    expect(advisorShare(row({ splits }), "Ayşe Yılmaz", "u1")).toBeNull();
  });
  it("findAmbiguousNames aynı adı büyük/küçük harf duyarsız yakalar", () => {
    expect([...findAmbiguousNames(["Ali Veli", "ali veli", "Zeynep"])].sort()).toEqual(["Ali Veli", "ali veli"]);
    expect(findAmbiguousNames(["A", "B", null]).size).toBe(0);
  });
});
