import { describe, expect, it } from "vitest";
import {
  OUTCOME_PARAM,
  advisorShareOf,
  buildLossNote,
  closingTabHref,
  initialOutcome,
  initialStep,
  isReadyToWin,
  isStepUnlocked,
  outcomeForStage,
  parseOutcomeParam,
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

  it("panodan gelen sonuc parametresi ilgili akışı ön seçer", () => {
    expect(closingTabHref("d1", "won")).toBe("/app/anlasmalar/d1?sekme=kapanis&sonuc=kazanildi");
    expect(closingTabHref("d1", "lost")).toBe("/app/anlasmalar/d1?sekme=kapanis&sonuc=kaybedildi");
    expect(parseOutcomeParam(OUTCOME_PARAM.won)).toBe("won");
    expect(parseOutcomeParam("kaybedildi")).toBe("lost");
    expect(parseOutcomeParam(["kazanildi", "kaybedildi"])).toBe("won");
    expect(parseOutcomeParam(" Kazanildi ")).toBe("won");
    expect(parseOutcomeParam("won")).toBeNull();
    expect(parseOutcomeParam("")).toBeNull();
    expect(parseOutcomeParam(undefined)).toBeNull();

    // Açık anlaşma: istek ön seçilir ve akışın ilk adımı açılır; istek yoksa seçim ekranı.
    expect(initialOutcome("negotiation", "won")).toBe("won");
    expect(initialStep(initialOutcome("negotiation", "won"), "negotiation")).toBe("tutar");
    expect(initialOutcome("new", "lost")).toBe("lost");
    expect(initialStep(initialOutcome("new", "lost"), "new")).toBe("neden");
    expect(initialOutcome("negotiation", null)).toBeNull();
    expect(initialOutcome("negotiation", undefined)).toBeNull();
  });

  it("kapanmış anlaşmada sonuc parametresi yok sayılır; aşama belirler", () => {
    expect(initialOutcome("won", "lost")).toBe("won");
    expect(initialOutcome("lost", "won")).toBe("lost");
    expect(initialStep(initialOutcome("won", "lost"), "won")).toBe("paylar");
  });

  it("ön seçim kilitleri açmaz: kazanılmadan paylar, kaybedilmeden takip kapalı", () => {
    expect(isStepUnlocked("won", "paylar", "negotiation")).toBe(false);
    expect(isStepUnlocked("lost", "takip", "new")).toBe(false);
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
