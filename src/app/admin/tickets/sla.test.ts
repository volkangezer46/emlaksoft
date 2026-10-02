import { describe, expect, it } from "vitest";
import { slaStateOf, slaSortRank } from "./sla";

const CREATED = "2026-07-31T08:00:00.000Z";

describe("support ticket SLA state", () => {
  it("kalıcı hedef tarihi öncelik fallback'inden önce kullanır", () => {
    const state = slaStateOf({
      status: "open",
      createdAt: CREATED,
      priority: "low",
      hasStaffReply: false,
      firstResponseDueAt: "2026-07-31T09:00:00.000Z",
      now: Date.parse("2026-07-31T09:01:00.000Z"),
    });
    expect(state.tracked).toBe(true);
    expect(state.phase).toBe("first_response");
    expect(state.breached).toBe(true);
    expect(state.dueAt).toBe("2026-07-31T09:00:00.000Z");
  });

  it("kalıcı hedef yoksa urgent için 1 takvim saati kullanır", () => {
    const state = slaStateOf({
      status: "open",
      createdAt: CREATED,
      priority: "urgent",
      hasStaffReply: false,
      now: Date.parse("2026-07-31T09:01:00.000Z"),
    });
    expect(state.breached).toBe(true);
  });

  it("ilk personel yanıtından sonra kalıcı çözüm hedefini izler", () => {
    const state = slaStateOf({
      status: "waiting",
      createdAt: CREATED,
      priority: "normal",
      hasStaffReply: true,
      firstResponseAt: "2026-07-31T08:20:00.000Z",
      resolutionDueAt: "2026-07-31T10:00:00.000Z",
      now: Date.parse("2026-07-31T09:30:00.000Z"),
    });
    expect(state.tracked).toBe(true);
    expect(state.phase).toBe("resolution");
    expect(state.warning).toBe(true);
    expect(state.breached).toBe(false);
    expect(state.dueAt).toBe("2026-07-31T10:00:00.000Z");
  });

  it("geçmiş ihlali tarihçe olarak korur ama yeni çevrimi güncel hedeften hesaplar", () => {
    const state = slaStateOf({
      status: "in_progress",
      createdAt: CREATED,
      priority: "normal",
      hasStaffReply: true,
      resolutionDueAt: "2026-08-02T08:00:00.000Z",
      resolutionBreachedAt: "2026-07-31T09:00:00.000Z",
      now: Date.parse("2026-07-31T10:00:00.000Z"),
    });
    expect(state.phase).toBe("resolution");
    expect(state.breached).toBe(false);
  });

  it("geçmiş ihlal kaydı varken güncel hedef de geçtiyse ihlali gösterir", () => {
    const state = slaStateOf({
      status: "in_progress",
      createdAt: CREATED,
      priority: "normal",
      hasStaffReply: true,
      resolutionDueAt: "2026-07-31T09:00:00.000Z",
      resolutionBreachedAt: "2026-07-30T09:00:00.000Z",
      now: Date.parse("2026-07-31T10:00:00.000Z"),
    });
    expect(state.breached).toBe(true);
  });

  it("urgent ilk yanıt uyarısını hedefin son yüzde 25'inde başlatır", () => {
    const beforeWindow = slaStateOf({
      status: "open",
      createdAt: CREATED,
      priority: "urgent",
      hasStaffReply: false,
      now: Date.parse("2026-07-31T08:44:00.000Z"),
    });
    const inWindow = slaStateOf({
      status: "open",
      createdAt: CREATED,
      priority: "urgent",
      hasStaffReply: false,
      now: Date.parse("2026-07-31T08:45:00.000Z"),
    });
    expect(beforeWindow.warning).toBe(false);
    expect(inWindow.warning).toBe(true);
  });

  it("kapanmış durumda SLA takibini bitirir", () => {
    expect(
      slaStateOf({ status: "resolved", createdAt: CREATED, hasStaffReply: false }).tracked,
    ).toBe(false);
  });

  it("acil ve ihlal edilmiş talebi sıralamada en öne taşır", () => {
    const breached = slaStateOf({
      status: "open",
      createdAt: CREATED,
      priority: "urgent",
      hasStaffReply: false,
      now: Date.parse("2026-07-31T10:00:00.000Z"),
    });
    expect(slaSortRank("urgent", breached)).toBe(0);
  });
});
