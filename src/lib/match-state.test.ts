import { describe, expect, it } from "vitest";
import { isHiddenMatchState, matchStateBadge, mergeMatchState, wasSent, type MatchStateRow } from "./match-state";

const row = (over: Partial<MatchStateRow> = {}): MatchStateRow => ({
  demand_id: "d1",
  property_id: "p1",
  state: "suggested",
  dismiss_reason: null,
  dismissed_at: null,
  sent_at: null,
  send_count: 0,
  channel: null,
  share_token: null,
  updated_at: "2026-10-10T00:00:00Z",
  ...over,
});
const NOW = Date.parse("2026-10-13T12:00:00Z");

describe("mergeMatchState (CRM-G4)", () => {
  it("sistem önerisi var olan durumu ezmez", () => {
    expect(mergeMatchState(null, { kind: "suggest" })).toBe("suggested");
    expect(mergeMatchState({ state: "sent", sent_at: "x" }, { kind: "suggest" })).toBe("sent");
    expect(mergeMatchState({ state: "dismissed", sent_at: null }, { kind: "suggest" })).toBe("dismissed");
  });
  it("gönderim gizlemeyi kaldırır ama ileri durumu geri düşürmez", () => {
    expect(mergeMatchState({ state: "dismissed", sent_at: null }, { kind: "send" })).toBe("sent");
    expect(mergeMatchState({ state: "shown", sent_at: "x" }, { kind: "send" })).toBe("shown");
    expect(mergeMatchState({ state: "suggested", sent_at: null }, { kind: "send" })).toBe("sent");
  });
  it("geri al: gönderildiyse sent, yoksa suggested", () => {
    expect(mergeMatchState({ state: "dismissed", sent_at: "2026-10-01" }, { kind: "restore" })).toBe("sent");
    expect(mergeMatchState({ state: "dismissed", sent_at: null }, { kind: "restore" })).toBe("suggested");
  });
  it("görüldü yalnız ileri gider; gizlenmiş çifte dokunmaz", () => {
    expect(mergeMatchState({ state: "sent", sent_at: "x" }, { kind: "view" })).toBe("viewed");
    expect(mergeMatchState({ state: "liked", sent_at: "x" }, { kind: "view" })).toBe("liked");
    expect(mergeMatchState({ state: "dismissed", sent_at: null }, { kind: "view" })).toBe("dismissed");
  });
});

describe("matchStateBadge", () => {
  it("öneri rozetsizdir", () => {
    expect(matchStateBadge(row(), NOW)).toBeNull();
    expect(matchStateBadge(null, NOW)).toBeNull();
  });
  it("gönderim: gün, kanal, tekrar ve açılma", () => {
    const b = matchStateBadge(row({ state: "sent", sent_at: "2026-10-10T09:00:00Z", channel: "whatsapp", send_count: 2 }), NOW, { opened: true });
    expect(b?.label).toBe("3 gün önce WhatsApp ile gönderildi · 2. gönderim · açıldı");
    expect(b?.tone).toBe("success");
  });
  it("uygun değil gerekçesiyle", () => {
    expect(matchStateBadge(row({ state: "dismissed", dismiss_reason: "price" }), NOW)?.label).toBe("Uygun değil · Fiyat uymuyor");
  });
  it("gizli durumlar ve gönderim bilgisi", () => {
    expect(isHiddenMatchState("dismissed")).toBe(true);
    expect(isHiddenMatchState("disliked")).toBe(true);
    expect(isHiddenMatchState("sent")).toBe(false);
    expect(wasSent(row({ sent_at: "x", send_count: 1 }))).toBe(true);
    expect(wasSent(row())).toBe(false);
  });
});
