/**
 * Ana ekran anlık görüntüsü — RPC'ler yokken/hata verirken zarif düşüş (sahte veri yok).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRpcProbes } from "@/lib/supabase/rpc-probe";

const db = vi.hoisted(() => ({
  calls: [] as string[],
  responses: {} as Record<string, { data: unknown; error: { code?: string; message?: string } | null }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc(fn: string, args: Record<string, unknown>) {
      db.calls.push(`${fn}:${JSON.stringify(args)}`);
      return Promise.resolve(db.responses[fn] ?? { data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    },
  }),
}));

import { EMPTY_SNAPSHOT, loadDashboardSnapshot } from "./data-batch";

afterEach(() => {
  db.calls = [];
  db.responses = {};
  resetRpcProbes();
});

describe("loadDashboardSnapshot", () => {
  it("RPC'ler yoksa (migration uygulanmadı) her alan null; sonraki çağrı yoklama sayesinde RPC'yi hiç çağırmaz", async () => {
    const snap = await loadDashboardSnapshot("t-yok", "u1");
    expect(snap).toEqual(EMPTY_SNAPSHOT);
    expect(db.calls).toHaveLength(3);
    db.calls = [];
    const again = await loadDashboardSnapshot("t-yok-2", "u1");
    expect(again).toEqual(EMPTY_SNAPSHOT);
    expect(db.calls).toHaveLength(0);
  });

  it("tek RPC başarısızsa yalnız o alan null kalır; diğerleri tiplenir ve imzalar birebir geçer", async () => {
    db.responses.get_tasks_snapshot = {
      data: { sample_included: false, mine: { due_today: 1, overdue: 0, open: [] }, office: { due_today: 4, overdue: 2, open: [] } },
      error: null,
    };
    db.responses.get_metrics_snapshot = { data: null, error: { code: "57014", message: "statement timeout" } };
    const snap = await loadDashboardSnapshot("t1", "u1");
    expect(snap.tasks?.office.dueToday).toBe(4);
    expect(snap.metrics).toBeNull();
    expect(snap.insights).toBeNull();
    expect(db.calls).toContain('get_insights_snapshot:{"p_tenant_id":"t1"}');
    expect(db.calls).toContain('get_metrics_snapshot:{"p_tenant_id":"t1","p_user_id":"u1"}');
    expect(db.calls).toContain('get_tasks_snapshot:{"p_tenant_id":"t1","p_user_id":"u1"}');
  });

  it("şekli bozuk yanıt null sayılır (yarım veri kullanılmaz)", async () => {
    db.responses.get_tasks_snapshot = { data: { mine: {} }, error: null };
    const snap = await loadDashboardSnapshot("t2", "u1");
    expect(snap.tasks).toBeNull();
  });
});
