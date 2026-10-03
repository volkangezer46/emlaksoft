import { describe, expect, it } from "vitest";
import {
  advisorShareOf,
  buildLossNote,
  initialStep,
  isReadyToWin,
  isStepUnlocked,
  outcomeForStage,
  splitsError,
  splitsTotal,
  wonReadiness,
} from "./kapanis-model";

describe("kapanis-model", () => {
  it("aşamadan sonuç ve başlangıç adımı", () => {
    expect(outcomeForStage("negotiation")).toBeNull();
    expect(outcomeForStage("won")).toBe("won");
    expect(initialStep("won", "won")).toBe("paylar");
    expect(initialStep("won", "negotiation")).toBe("tutar");
    expect(initialStep("lost", "negotiation")).toBe("neden");
    expect(initialStep("lost", "lost")).toBe("takip");
  });

  it("kazanmadan önce yalnız tutar ve onay açık", () => {
    expect(isStepUnlocked("won", "onay", "negotiation")).toBe(true);
    expect(isStepUnlocked("won", "paylar", "negotiation")).toBe(false);
    expect(isStepUnlocked("won", "paylar", "won")).toBe(true);
    expect(isStepUnlocked("lost", "takip", "negotiation")).toBe(false);
    expect(isStepUnlocked("lost", "takip", "lost")).toBe(true);
  });

  it("kazanma ön koşulları", () => {
    const base = { dealType: "sale", hasProperty: true, hasCustomer: true, dealValue: 5_000_000, commissionRate: 2 };
    const ids = { dealId: "d1", propertyId: "p1" };
    expect(isReadyToWin(wonReadiness(base, ids))).toBe(true);
    expect(isReadyToWin(wonReadiness({ ...base, commissionRate: null }, ids))).toBe(false);
    expect(isReadyToWin(wonReadiness({ ...base, dealValue: 0 }, ids))).toBe(false);
    expect(isReadyToWin(wonReadiness({ ...base, dealType: "rent" }, ids))).toBe(false);
  });

  it("kayıp notu: birleştirir, ayırıcıyı temizler, uzunluğu keser", () => {
    expect(buildLossNote("Ahmet Emlak", "%5 düşük")).toBe("Rakip: Ahmet Emlak · Fiyat: %5 düşük");
    expect(buildLossNote("A | B", "")).toBe("Rakip: A / B");
    expect(buildLossNote("x".repeat(400), "").length).toBe(300);
    expect(buildLossNote("", "")).toBe("");
  });

  it("pay doğrulaması", () => {
    expect(splitsTotal([{ label: "a", rate: "60" }, { label: "b", rate: "40" }])).toBe(100);
    expect(splitsError([{ label: "a", rate: "60" }, { label: "b", rate: "50" }])).toMatch(/aşamaz/);
    expect(splitsError([{ label: "", rate: "" }])).toMatch(/En az bir/);
    expect(splitsError([{ label: "Danışman", rate: "50" }, { label: "Ofis", rate: "50" }])).toBeNull();
  });

  it("danışman payı", () => {
    expect(advisorShareOf([{ label: "Danışman", rate: 60 }, { label: "Ofis", rate: 40 }])).toBe(60);
    expect(advisorShareOf([{ label: "Ofis", rate: 100 }])).toBeNull();
    expect(advisorShareOf(null)).toBeNull();
  });
});
