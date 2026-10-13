import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/notify-batch", () => ({ insertNotifications: vi.fn(async (_a: unknown, rows: unknown[]) => rows.length) }));

import { runExpireActiveToPastDue } from "./subscription-lifecycle";

type Call = { table: string; op: string; args: unknown[] };

/** Zincirleme sahte istemci: her çağrıyı kaydeder; select/update sonuçları tabloya göre sabittir. */
function fakeAdmin() {
  const calls: Call[] = [];
  const builder = (table: string) => {
    let op = "select";
    const chain: Record<string, unknown> = {};
    const rec = (name: string) => (...args: unknown[]) => {
      calls.push({ table, op: name, args });
      if (name === "update") op = "update";
      return chain;
    };
    for (const m of ["select", "eq", "lt", "is", "in", "order", "limit", "update"]) chain[m] = rec(m);
    chain.then = (resolve: (v: unknown) => unknown) => {
      if (table === "subscriptions" && op === "select") return resolve({ data: [{ id: "s1", tenant_id: "t1" }], error: null });
      if (table === "subscriptions" && op === "update") return resolve({ data: [{ id: "s1", tenant_id: "t1" }], error: null });
      if (table === "tenants" && op === "update") return resolve({ data: [{ id: "t1" }], error: null });
      return resolve({ data: [], error: null });
    };
    return chain;
  };
  return { admin: { from: (t: string) => builder(t) } as unknown as SupabaseClient, calls };
}

const NOW = "2026-10-13T00:00:00.000Z";

describe("runExpireActiveToPastDue (billing.expire_to_past_due)", () => {
  it("ayar KAPALIYKEN hiçbir okuma/yazma yapmaz", async () => {
    const { admin, calls } = fakeAdmin();
    const out = await runExpireActiveToPastDue(admin, NOW, { enabled: false });
    expect(out).toEqual({ enabled: false, candidates: 0, expired: 0, tenants: 0, error: null });
    expect(calls).toHaveLength(0);
  });

  it("ayar AÇIKKEN dönemi bitmiş aktif aboneliği ve aktif ofisi past_due yapar (koşul tekrarlanır)", async () => {
    const { admin, calls } = fakeAdmin();
    const out = await runExpireActiveToPastDue(admin, NOW, { enabled: true });
    expect(out).toMatchObject({ enabled: true, candidates: 1, expired: 1, tenants: 1, error: null });
    const updates = calls.filter((c) => c.op === "update");
    expect(updates.map((u) => u.table)).toEqual(["subscriptions", "tenants"]);
    expect(updates[0]!.args[0]).toMatchObject({ status: "past_due" });
    // Yarış güvenliği: güncelleme status=active + dönem geçmiş koşulunu tekrarlar
    const subUpdateIdx = calls.findIndex((c) => c.op === "update" && c.table === "subscriptions");
    const after = calls.slice(subUpdateIdx).filter((c) => c.table === "subscriptions");
    expect(after.some((c) => c.op === "eq" && c.args[0] === "status" && c.args[1] === "active")).toBe(true);
    expect(after.some((c) => c.op === "lt" && c.args[0] === "current_period_end")).toBe(true);
    // Duraklatılmış ve dönem sonu iptali bekleyenler aday değildir
    expect(calls.some((c) => c.op === "is" && c.args[0] === "pause_started_at")).toBe(true);
    expect(calls.some((c) => c.op === "eq" && c.args[0] === "cancel_at_period_end" && c.args[1] === false)).toBe(true);
  });
});
