import { describe, expect, it } from "vitest";
import { dueState, parseTaskTab, snoozeDueIso, sortOwnedAccounts, type OwnedAccount } from "./task-queue";

const NOW = Date.UTC(2026, 9, 15, 20, 30, 0); // 23:30 TSİ

describe("iş kuyruğu yardımcıları (PA-2)", () => {
  it("bilinmeyen sekme 'Bana atanan'a düşer", () => {
    expect(parseTaskTab("atanmamis")).toBe("atanmamis");
    expect(parseTaskTab("hack")).toBe("benim");
    expect(parseTaskTab(undefined)).toBe("benim");
  });

  it("erteleme TR takviminde N gün sonra 09:00 (gece yarısı hatırlatması yok)", () => {
    expect(snoozeDueIso(NOW, 1)).toBe("2026-10-16T06:00:00.000Z");
    expect(snoozeDueIso(NOW, 7)).toBe("2026-10-22T06:00:00.000Z");
  });

  it("vade durumu: geçmiş / bugün (TR) / sonra / yok", () => {
    expect(dueState(null, NOW)).toBe("none");
    expect(dueState("2026-10-15T10:00:00Z", NOW)).toBe("overdue");
    expect(dueState("2026-10-15T20:45:00Z", NOW)).toBe("today");
    expect(dueState("2026-10-15T21:30:00Z", NOW)).toBe("later");
  });

  it("ofislerim: iptal talebi ve düşük skor önce", () => {
    const A = (o: Partial<OwnedAccount>): OwnedAccount => ({ tenantId: "x", name: "X", status: "active", plan: null, score: 80, delta7: 0, periodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false, openTickets: 0, openTasks: 0, ...o });
    const sorted = sortOwnedAccounts([A({ tenantId: "ok", name: "Bir" }), A({ tenantId: "low", name: "Cem", score: 30 }), A({ tenantId: "cancel", name: "Dal", cancelAtPeriodEnd: true })]);
    expect(sorted.map((r) => r.tenantId)).toEqual(["cancel", "low", "ok"]);
  });
});
