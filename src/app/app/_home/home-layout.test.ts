import { describe, expect, it } from "vitest";
import { homeLayoutFor, homeVariantOf, riskShowsTeyit, showsSalesBlocks } from "./home-layout";

const ROLES = ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"] as const;

describe("homeVariantOf", () => {
  it("rolleri beş yerleşime eşler", () => {
    expect(homeVariantOf("owner")).toBe("management");
    expect(homeVariantOf("gm")).toBe("management");
    expect(homeVariantOf("branch_manager")).toBe("management");
    expect(homeVariantOf("team_lead")).toBe("team_lead");
    expect(homeVariantOf("advisor")).toBe("advisor");
    expect(homeVariantOf("accounting")).toBe("accounting");
    expect(homeVariantOf("call_center")).toBe("call_center");
  });
  it("bilinmeyen/boş rol danışman yerleşimine düşer (en az yetkili)", () => {
    expect(homeVariantOf("readonly")).toBe("advisor");
    expect(homeVariantOf(undefined)).toBe("advisor");
    expect(homeVariantOf("???")).toBe("advisor");
  });
});

describe("homeLayoutFor rol matrisi", () => {
  it("yönetim: brifing odağı, karar bekleyenler, ekip tablosu, ofis hunisi, ofis/ben anahtarı", () => {
    const l = homeLayoutFor("owner");
    expect(l).toMatchObject({ focus: "briefing", decisions: true, team: true, funnelTarget: "office", scopeSwitch: true, callList: false });
    expect(l.metrics).toEqual(["ciro", "aktif-anlasma", "yeni-talep", "teyit"]);
    expect(l.bottom).toEqual(["program", "gorevler", "risk"]);
  });
  it("danışman: sıradaki eylem odağı, nedenli arama listesi, kişisel hedef; ekip/karar YOK", () => {
    const l = homeLayoutFor("advisor");
    expect(l).toMatchObject({ focus: "next-action", callList: true, team: false, decisions: false, funnelTarget: null, scopeSwitch: false });
    expect(l.bottom).toContain("kisisel-hedef");
  });
  it("takım lideri: danışman yerleşimi + ekip satırı", () => {
    const l = homeLayoutFor("team_lead");
    const a = homeLayoutFor("advisor");
    expect(l.team).toBe(true);
    expect(l.focus).toBe(a.focus);
    expect(l.callList).toBe(true);
  });
  it("muhasebe: tahsilat odağı; satış/müşteri blokları ve arama listesi YOK", () => {
    const l = homeLayoutFor("accounting");
    expect(l.focus).toBe("collections");
    expect(showsSalesBlocks(l)).toBe(false);
    expect(l).toMatchObject({ team: false, callList: false, funnelTarget: null, decisions: false });
    expect(l.metrics).toEqual(["tahsil-edilen", "geciken-kira"]);
    expect(l.bottom).toEqual(["gider-ozeti"]);
    expect(l.more).toEqual([]);
  });
  it("arama merkezi: yalnız arama/yanıt süresi odaklı sade yerleşim", () => {
    const l = homeLayoutFor("call_center");
    expect(l.focus).toBe("calls");
    expect(showsSalesBlocks(l)).toBe(false);
    expect(l.metrics).toEqual(["arama", "yanit-suresi", "gorev"]);
    expect(l.team).toBe(false);
    expect(l.more).toEqual([]);
  });
  it("her rolde bir metrik ekranda bir kez (yineleme yok) ve en çok 4 metrik", () => {
    for (const r of ROLES) {
      const l = homeLayoutFor(r);
      expect(new Set(l.metrics).size, r).toBe(l.metrics.length);
      expect(l.metrics.length, r).toBeLessThanOrEqual(4);
      expect(new Set(l.bottom).size, r).toBe(l.bottom.length);
    }
  });
  it("her çağrı bağımsız kopya döner (dış mutasyon yerleşimi bozmaz)", () => {
    const a = homeLayoutFor("owner");
    a.metrics.pop();
    expect(homeLayoutFor("owner").metrics).toHaveLength(4);
  });
  it("teyit metrik şeridindeyse risk bloğu teyit sayısını tekrar etmez", () => {
    expect(riskShowsTeyit(homeLayoutFor("owner"))).toBe(false);
    expect(riskShowsTeyit(homeLayoutFor("accounting"))).toBe(true);
  });
});
