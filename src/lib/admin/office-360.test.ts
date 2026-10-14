import { describe, expect, it } from "vitest";
import { getPlan } from "@/lib/billing/plans";
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

  it("limit satırları: adminden eklenen paket katalogdan (Ofis'e düşmez)", () => {
    const custom = { ...getPlan("office"), id: "ofis_plus", tier: "office" as const, custom: true, limits: { seats: 10, customers: null, activeProperties: null, branches: 6 } };
    const rows = buildLimitRows("ofis_plus", { seats: 3, properties: 10, customers: 5, branches: 1 }, undefined, [custom]);
    expect(limitText(rows[0])).toBe("3 / 10");
    expect(rows[3]!.limit).toBe(6);
  });

  it("limit satırları: etkin sınır = plan + AD1 istisnası + ek koltuk (süresi dolan/geri alınan sayılmaz)", () => {
    const nowMs = Date.parse("2026-10-14T12:00:00Z");
    const ov = (id: string, key: "seats" | "customers" | "branches" | "active_properties", delta: number | null, value: number | null, extra: Partial<{ expiresAtMs: number; revokedAtMs: number }> = {}) => ({
      id,
      key,
      delta,
      value,
      expiresAtMs: extra.expiresAtMs ?? null,
      revokedAtMs: extra.revokedAtMs ?? null,
      createdAtMs: nowMs - 1000,
    });
    const overrides = [
      ov("a", "seats", 3, null),
      ov("b", "customers", null, 5000),
      ov("c", "branches", 4, null, { expiresAtMs: nowMs - 1 }),
      ov("d", "seats", 10, null, { revokedAtMs: nowMs - 1 }),
    ];
    const rows = buildLimitRows("office", { seats: 3, properties: 10, customers: 5, branches: 1 }, undefined, undefined, { extraSeats: 2, overrides, nowMs });
    // Ofis: 5 koltuk + 3 istisna + 2 ek koltuk = 10.
    expect(rows[0]).toMatchObject({ limit: 10, planLimit: 5, extra: "+2 ek koltuk · 1 istisna" });
    expect(limitText(rows[0]!)).toBe("3 / 10");
    // Sınırsız aktif ilan istisnayla sınırlanmaz.
    expect(rows[1]).toMatchObject({ limit: null, planLimit: null });
    expect(rows[1]!.extra).toBeUndefined();
    // Süresi dolan şube istisnası sayılmaz.
    expect(rows[3]!.limit).toBe(rows[3]!.planLimit);
    // Katalogdaki (admin düzenlemeli) taban paket limiti kod tanımının önüne geçer.
    const edited = { ...getPlan("office"), limits: { ...getPlan("office").limits, seats: 7 } };
    expect(buildLimitRows("office", { seats: 1, properties: 0, customers: 0, branches: 0 }, undefined, [edited])[0]!.limit).toBe(7);
  });
});

describe("Ofis 360 tahsilat (dunning) olayları", () => {
  it("dunning günlüğü 'tahsilat' kategorisinde, faturaya bağlı; fatura yetkisi yoksa görünmez", () => {
    const dunning = [
      { id: 1, invoice_id: "inv1", stage: "stage1", channel: "email", result: "channel_disabled", detail: "kanal kapalı", sent_at: "2026-10-01T09:00:00Z" },
      { id: 2, invoice_id: "inv1", stage: "suspend", channel: "system", result: "suspended", detail: null, sent_at: "2026-10-09T09:00:00Z" },
    ];
    const dun = buildOfficeTimeline(empty({ dunning })).filter((e) => e.category === "tahsilat");
    expect(dun).toHaveLength(2);
    expect(dun[0]).toMatchObject({ title: "1. tahsilat hatırlatması", href: "/admin/billing/faturalar/inv1", tone: "warn" });
    expect(dun[0].detail).toContain("kanal kapalı");
    expect(dun[1]).toMatchObject({ tone: "danger" });
    const noBilling = buildOfficeTimeline(empty({ dunning, access: officeAccess("ops") }));
    expect(noBilling.some((e) => e.category === "tahsilat")).toBe(false);
  });
});
