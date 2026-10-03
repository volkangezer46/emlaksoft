import { describe, expect, it } from "vitest";
import {
  buildLimitRows,
  buildOfficeTimeline,
  limitPercent,
  limitText,
  officeAccess,
  resolveOfficeTab,
  visibleTabs,
  type TimelineInput,
} from "./office-360";

const empty = (over: Partial<TimelineInput>): TimelineInput => ({
  tenantId: "t1",
  tenantCreatedAt: "2026-01-01T00:00:00Z",
  tenantName: "Ofis",
  access: officeAccess("super_admin"),
  actorNames: new Map(),
  audit: [],
  platformAudit: [],
  sub: null,
  invoices: [],
  captures: [],
  tickets: [],
  logins: [],
  consents: [],
  iys: [],
  erasures: [],
  profiles: [],
  ...over,
});

describe("office-360", () => {
  it("rol bazlı sekme görünürlüğü: operasyon faturayı göremez", () => {
    expect(visibleTabs(officeAccess("ops"))).not.toContain("abonelik");
    expect(visibleTabs(officeAccess("ops"))).not.toContain("fatura");
    expect(visibleTabs(officeAccess("billing"))).toContain("abonelik");
    expect(visibleTabs(officeAccess("billing"))).not.toContain("ekip");
    expect(resolveOfficeTab("abonelik", visibleTabs(officeAccess("ops")))).toBe("zaman");
  });

  it("IP yalnız süper admin olayında görünür", () => {
    const audit = [{ id: "a", action: "settings.update", actor_id: null, ip: "1.2.3.4", created_at: "2026-02-01T10:00:00Z" }];
    const sa = buildOfficeTimeline(empty({ audit })).find((e) => e.id === "audit-a");
    const ops = buildOfficeTimeline(empty({ audit, access: officeAccess("ops") })).find((e) => e.id === "audit-a");
    expect(sa?.ip).toBe("1.2.3.4");
    expect(ops?.ip).toBeUndefined();
  });

  it("impersonation olayı salt okunur başlığıyla gelir", () => {
    const audit = [{ id: "i", action: "ops.impersonate.start", actor_id: "s1", ip: null, created_at: "2026-02-01T10:00:00Z" }];
    const e = buildOfficeTimeline(empty({ audit, actorNames: new Map([["s1", "Ayşe (EmlakSoft)"]]) })).find((x) => x.id === "audit-i");
    expect(e?.title).toContain("salt okunur");
    expect(e?.actor).toBe("Ayşe (EmlakSoft)");
  });

  it("faturasız rol ödeme/iade olayı görmez", () => {
    const invoices = [{ id: "1", invoice_no: "F-1", status: "paid", total_try: 990, due_at: null, paid_at: "2026-02-02T00:00:00Z", created_at: "2026-02-01T00:00:00Z" }];
    const ev = buildOfficeTimeline(empty({ invoices, access: officeAccess("ops") }));
    expect(ev.some((e) => e.category === "odeme")).toBe(false);
    expect(buildOfficeTimeline(empty({ invoices })).filter((e) => e.category === "odeme")).toHaveLength(2);
  });

  it("limit satırları: sınırsız ve yüzde", () => {
    const rows = buildLimitRows("office", { seats: 3, properties: 10, customers: 5, branches: 1 });
    expect(limitText(rows[0])).toBe("3 / 5");
    expect(limitPercent(rows[0])).toBe(60);
    expect(limitText(rows[1])).toBe("10 / sınırsız");
    expect(limitPercent(rows[1])).toBeNull();
  });
});
