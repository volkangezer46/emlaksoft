import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
const logActivity = vi.fn(async () => ({ ok: true }));
let existing: { id: string; commission_rate: number | null } | null = null;
let updates: { patch: Record<string, unknown>; filters: Record<string, unknown> }[] = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...a) }));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...(a as [])) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (p: Record<string, unknown>) => {
          patch = p;
          return chain;
        },
        eq: (col: string, v: unknown) => {
          filters[col] = v;
          if (patch && col === "tenant_id") {
            updates.push({ patch, filters: { ...filters } });
            return Promise.resolve({ error: null });
          }
          return chain;
        },
        maybeSingle: async () => ({ data: existing, error: null }),
      };
      return chain;
    },
  }),
}));

import { updatePropertyCommissionRate } from "./property-commission-rate";

beforeEach(() => {
  requirePermission.mockReset();
  requirePermission.mockResolvedValue({ ok: true, tenantId: "t1", userId: "u1", role: "agent" });
  logActivity.mockClear();
  existing = { id: "p1", commission_rate: null };
  updates = [];
});

describe("updatePropertyCommissionRate", () => {
  it("properties.edit kapısını ister ve izinsiz kullanıcıyı reddeder", async () => {
    requirePermission.mockResolvedValue({ ok: false, error: "Bu işlem için yetkiniz yok." });
    const res = await updatePropertyCommissionRate("p1", 2.5);
    expect(requirePermission).toHaveBeenCalledWith("properties", "edit");
    expect(res).toEqual({ ok: false, error: "Bu işlem için yetkiniz yok." });
    expect(updates).toHaveLength(0);
  });

  it.each([101, -1, 0, "abc"])("%s oranını reddeder", async (bad) => {
    const res = await updatePropertyCommissionRate("p1", bad);
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("2,5 oranını kiracı sınırıyla yazar ve audit kaydı düşer", async () => {
    const res = await updatePropertyCommissionRate("p1", "2,5");
    expect(res).toEqual({ ok: true, rate: 2.5 });
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ commission_rate: 2.5 });
    expect(updates[0].filters).toMatchObject({ id: "p1", tenant_id: "t1" });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", actorId: "u1", action: "property.commission_rate", entityId: "p1" }),
    );
  });

  it("başka kiracının portföyü (bulunamadı) yazılmaz", async () => {
    existing = null;
    const res = await updatePropertyCommissionRate("p-baska", 2);
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("mevcut oranı düşürmez (onay kapısı portföy ekranında)", async () => {
    existing = { id: "p1", commission_rate: 3 };
    const res = await updatePropertyCommissionRate("p1", 2);
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
