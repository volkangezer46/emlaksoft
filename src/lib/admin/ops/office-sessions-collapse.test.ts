import { describe, expect, it } from "vitest";
import { DEVICE_GROUPS_PER_USER, collapseUserSessions, toOfficeSessionRow, type OfficeSessionRow } from "./office-sessions";

/** F6 (ui): Ofis oturumları — aynı cihaz + IP katlanır (sayı + son görülme), kullanıcı başına en çok N grup görünür. */
const NOW = Date.parse("2026-10-27T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const row = (o: Partial<OfficeSessionRow>): OfficeSessionRow => ({
  sessionId: "s",
  userId: "u1",
  name: "Demo Danışman",
  role: "advisor",
  tenantId: "t1",
  tenantName: "Demo Emlak Ofisi",
  tenantInternal: true,
  createdAt: iso(86_400_000),
  lastActiveAt: iso(3_600_000),
  aal: "aal1",
  ipMasked: "10.0.x.x",
  userAgent: "node",
  expiresAt: null,
  ...o,
});

describe("collapseUserSessions", () => {
  it("195 'node' oturumu tek satıra katlanır: sayı, en son etkinlik, en eski açılış", () => {
    const rows = Array.from({ length: 195 }, (_, i) => row({ sessionId: `s${i}`, lastActiveAt: iso(60_000 * (i + 1)), createdAt: iso(86_400_000 + i) }));
    const r = collapseUserSessions(rows);
    expect(r.groups).toBe(1);
    expect(r.shown).toHaveLength(1);
    expect(r.more).toHaveLength(0);
    expect(r.shown[0]).toMatchObject({ device: "Uygulama / API", ipMasked: "10.0.x.x", count: 195, lastActiveAt: iso(60_000) });
    expect(r.shown[0]!.firstCreatedAt).toBe(iso(86_400_000 + 194));
    expect(r.shown[0]!.sessions[0]!.sessionId).toBe("s0");
  });

  it("farklı cihaz ya da IP ayrı gruptur; en yeni N grup görünür, kalanı açılır listede", () => {
    const rows = [
      row({ sessionId: "a", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120", lastActiveAt: iso(1_000) }),
      row({ sessionId: "b", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/121", lastActiveAt: iso(2_000), aal: "aal2" }),
      row({ sessionId: "c", userAgent: "Mozilla/5.0 (iPhone) Safari/604", lastActiveAt: iso(5_000) }),
      row({ sessionId: "d", ipMasked: "85.105.x.x", lastActiveAt: iso(9_000) }),
      row({ sessionId: "e", lastActiveAt: iso(20_000) }),
    ];
    const r = collapseUserSessions(rows);
    expect(DEVICE_GROUPS_PER_USER).toBe(3);
    expect(r.groups).toBe(4);
    expect(r.shown.map((g) => g.device)).toEqual(["Chrome · Windows", "Safari · iPhone", "Uygulama / API"]);
    expect(r.shown[0]).toMatchObject({ count: 2, aal2: 1 });
    expect(r.shown[2]!.ipMasked).toBe("85.105.x.x");
    expect(r.more.map((g) => g.sessions.map((s) => s.sessionId))).toEqual([["e"]]);
    expect(collapseUserSessions(rows, 10).more).toHaveLength(0);
  });

  it("RPC satırı demo/test ofisi işaretini taşır", () => {
    expect(toOfficeSessionRow({ session_id: "s", user_id: "u", tenant_id: "t", tenant_internal: true })?.tenantInternal).toBe(true);
    expect(toOfficeSessionRow({ session_id: "s", user_id: "u", tenant_id: "t" })?.tenantInternal).toBe(false);
  });
});
