import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SLA_HOURS,
  autoApprovalReason,
  canDecide,
  isDelegationActive,
  isOverdue,
  slaHours,
} from "@/lib/approvals";
import { getSettingDef } from "@/lib/settings/registry";
import { APPROVAL_AUTO_KEYS, approvalSlaKey } from "@/lib/settings/registry/tenant";

const on = { autoMaxCommissionPoints: 0.5, autoMaxExpenseTry: 2000, autoMaxPriceDropPct: 3 };

describe("onay politikası (OA12)", () => {
  it("ayar varsayılanları koddaki sabitlerle aynı; otomatik onay varsayılan kapalı", () => {
    for (const [kind, hours] of Object.entries(DEFAULT_SLA_HOURS)) {
      expect(getSettingDef(approvalSlaKey(kind as keyof typeof DEFAULT_SLA_HOURS))!.default).toBe(hours);
    }
    expect(getSettingDef(APPROVAL_AUTO_KEYS.commissionPoints)!.default).toBe(0);
    expect(getSettingDef(APPROVAL_AUTO_KEYS.expenseTry)!.default).toBe(0);
    expect(getSettingDef(APPROVAL_AUTO_KEYS.priceDropPct)!.default).toBe(0);
    expect(autoApprovalReason({ kind: "gider", current: null, requested: 10, amount: 10 }, DEFAULT_APPROVAL_POLICY)).toBeNull();
  });

  it("SLA ofis politikasından gelir; bozuk değer varsayılana düşer", () => {
    const policy = { slaHours: { ...DEFAULT_SLA_HOURS, gider: 4 } };
    expect(slaHours("gider", policy)).toBe(4);
    expect(slaHours("gider")).toBe(48);
    expect(slaHours("bilinmeyen", policy)).toBe(DEFAULT_SLA_HOURS.diger);
    expect(slaHours("gider", { slaHours: { ...DEFAULT_SLA_HOURS, gider: Number.NaN } })).toBe(48);
    const created = Date.parse("2026-10-15T08:00:00Z");
    expect(isOverdue(created, "gider", created + 5 * 3_600_000, policy)).toBe(true);
    expect(isOverdue(created, "gider", created + 5 * 3_600_000)).toBe(false);
  });

  it("komisyon: yalnız sınır içi İNDİRİM otomatik onaylanır", () => {
    expect(autoApprovalReason({ kind: "komisyon_indirimi", current: 3, requested: 2.5, amount: null }, on)).toMatch(/0,5 puan/);
    expect(autoApprovalReason({ kind: "komisyon_indirimi", current: 3, requested: 2.4, amount: null }, on)).toBeNull();
    expect(autoApprovalReason({ kind: "komisyon_indirimi", current: 3, requested: 3.5, amount: null }, on)).toBeNull();
    expect(autoApprovalReason({ kind: "komisyon_indirimi", current: null, requested: 2.5, amount: null }, on)).toBeNull();
  });

  it("gider ve fiyat sınırları; özel izin ve ofis kontrolü talepleri hiçbir zaman", () => {
    expect(autoApprovalReason({ kind: "gider", current: null, requested: 1500, amount: 1500 }, on)).not.toBeNull();
    expect(autoApprovalReason({ kind: "gider", current: null, requested: 2500, amount: 2500 }, on)).toBeNull();
    expect(autoApprovalReason({ kind: "fiyat_degisikligi", current: 1_000_000, requested: 980_000, amount: null }, on)).not.toBeNull();
    expect(autoApprovalReason({ kind: "fiyat_degisikligi", current: 1_000_000, requested: 960_000, amount: null }, on)).toBeNull();
    expect(autoApprovalReason({ kind: "fiyat_degisikligi", current: 1_000_000, requested: 1_010_000, amount: null }, on)).toBeNull();
    expect(autoApprovalReason({ kind: "ozel_izin", current: 1, requested: 0, amount: null }, on)).toBeNull();
    expect(
      autoApprovalReason(
        { kind: "fiyat_degisikligi", current: 1_000_000, requested: 990_000, amount: null, description: "[oversight:price_drop:x] Fiyat" },
        on,
      ),
    ).toBeNull();
  });

  it("vekalet bitiş günü dahil; vekil kademe şartı olmadan karar verir ama kendi talebini onaylayamaz", () => {
    expect(isDelegationActive({ delegate_id: "u", until_on: "2026-10-15" }, "2026-10-15")).toBe(true);
    expect(isDelegationActive({ delegate_id: "u", until_on: "2026-10-14" }, "2026-10-15")).toBe(false);
    expect(isDelegationActive(null, "2026-10-15")).toBe(false);
    expect(canDecide({ role: "advisor", status: "bekliyor", requestedBy: "a", userId: "b" }).ok).toBe(false);
    expect(canDecide({ role: "advisor", status: "bekliyor", requestedBy: "a", userId: "b", delegate: true }).ok).toBe(true);
    expect(canDecide({ role: "advisor", status: "bekliyor", requestedBy: "b", userId: "b", delegate: true }).ok).toBe(false);
  });
});
