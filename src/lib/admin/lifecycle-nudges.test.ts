import { describe, expect, it } from "vitest";
import { DAY_MS } from "@/lib/clock";
import { decideNudge, kindTrace, nudgeNote, WEEKLY_CAP, type NudgeFacts, type NudgeHistory } from "./lifecycle-nudges";

const NOW = Date.UTC(2026, 9, 15, 0, 0, 0);
const ago = (d: number) => new Date(NOW - d * DAY_MS).toISOString();
const ahead = (d: number) => new Date(NOW + d * DAY_MS).toISOString();
const F = (over: Partial<NudgeFacts>): NudgeFacts => ({
  tenantId: "t",
  name: "Ofis",
  status: "trial",
  createdAt: ago(1.5),
  trialEndsAt: ahead(12),
  properties: 0,
  customers: 0,
  matches: 0,
  members: 1,
  planSeats: 5,
  stuck: null,
  ...over,
});
const H = (over: Partial<{ keys: string[]; kinds: string[]; recent7d: number }> = {}): NudgeHistory => ({
  keys: new Set(over.keys ?? []),
  kinds: new Set(over.kinds ?? []),
  recent7d: over.recent7d ?? 0,
});

describe("aktivasyon dürtmesi (saf)", () => {
  it("1. gün: portföy yoksa ilk portföy", () => {
    expect(decideNudge(F({}), H(), NOW)).toMatchObject({ key: "d1", kind: "first_property", template: "nudge_first_property", href: "/app/portfoyler/yeni" });
  });

  it("1. gün portföy varsa takılan adım; ilk gün (24 saat dolmadan) hiçbir şey", () => {
    const stuck = { id: "portals", title: "Vitrin ve portallar", description: "Portalları işaretle" };
    expect(decideNudge(F({ properties: 2, stuck }), H(), NOW)).toMatchObject({ key: "d1", kind: "next_step", stepId: "portals", href: "/app/baslangic?adim=portals", vars: { adim: "Vitrin ve portallar" } });
    expect(decideNudge(F({ createdAt: ago(0.5) }), H(), NOW)).toBeNull();
  });

  it("3. gün: tek kullanıcıysa ekip daveti; tek kişilik pakette davet önerilmez", () => {
    expect(decideNudge(F({ createdAt: ago(4), properties: 3 }), H({ keys: ["d1"] }), NOW)).toMatchObject({ key: "d3", kind: "team_invite", template: "nudge_team_invite" });
    expect(decideNudge(F({ createdAt: ago(4), properties: 3, planSeats: 1 }), H({ keys: ["d1"] }), NOW)).toBeNull();
  });

  it("aynı tür ikinci kez gönderilmez, aynı anahtar tekrar etmez; haftalık üst sınır", () => {
    expect(decideNudge(F({ createdAt: ago(4) }), H({ keys: ["d1"], kinds: ["first_property", "team_invite"] }), NOW)).toBeNull();
    expect(decideNudge(F({}), H({ keys: ["d1"] }), NOW)).toBeNull();
    expect(decideNudge(F({}), H({ recent7d: WEEKLY_CAP }), NOW)).toBeNull();
  });

  it("takılan adım 'team' ise ekip daveti türü kullanılır (çift dürtme yok)", () => {
    const d = decideNudge(F({ createdAt: ago(8), properties: 1, members: 1, stuck: { id: "team", title: "Ekibini davet et", description: "" } }), H({ keys: ["d1", "d3"], kinds: ["first_property"] }), NOW);
    expect(d).toMatchObject({ key: "d7", kind: "team_invite" });
    expect(kindTrace("next_step", "portals")).toBe("next_step:portals");
  });

  it("deneme değer özeti: bitişe 4-6 gün kala ve veri varsa, sayılarla", () => {
    const d = decideNudge(F({ createdAt: ago(9), trialEndsAt: ahead(5), properties: 7, customers: 3, matches: 2 }), H({ keys: ["d1", "d3", "d7"] }), NOW);
    expect(d).toMatchObject({ key: "trial_recap", template: "trial_value_recap", href: "/app/abonelik", vars: { gun: 5, portfoy_sayisi: 7, musteri_sayisi: 3, eslesme_sayisi: 2 } });
    expect(decideNudge(F({ createdAt: ago(9), trialEndsAt: ahead(5) }), H({ keys: ["d1", "d3", "d7"] }), NOW)).toBeNull();
  });

  it("geri kazanım: bitişten 7-13 gün sonra, gecikmiş/askıda ofis, bir kez", () => {
    const base = F({ status: "suspended", createdAt: ago(25), trialEndsAt: ago(8), properties: 4, customers: 1 });
    expect(decideNudge(base, H(), NOW)).toMatchObject({ key: "win_back", template: "trial_win_back", vars: { portfoy_sayisi: 4, musteri_sayisi: 1 } });
    expect(decideNudge(base, H({ keys: ["win_back"] }), NOW)).toBeNull();
    expect(decideNudge({ ...base, trialEndsAt: ago(3) }, H(), NOW)).toBeNull();
    expect(decideNudge({ ...base, status: "cancelled" }, H(), NOW)).toBeNull();
  });

  it("heartbeat özeti", () => {
    expect(nudgeNote({ skipped: false, sent: { d1: 2, win_back: 1 }, inApp: 3, emails: 2, error: null })).toBe("3 ofis (3 bildirim, 2 e-posta)");
    expect(nudgeNote({ skipped: true, sent: {}, inApp: 0, emails: 0, error: null })).toBe("atlandı");
  });
});
