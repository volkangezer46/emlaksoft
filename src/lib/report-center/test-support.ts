/**
 * Test yardımcıları (üretim kodu DEĞİL): sorgu çağrılarını kaydeden sahte Supabase istemcisi ve bağlam kurucu.
 * Rapor kapsam sözleşmesi bunu kullanır: gerçek `build` / `run` çalışır, hangi süzgeçlerin uygulandığı kaydedilir.
 */
import { defaultStageLabels } from "@/lib/deal-stage-labels";
import type { ReportContext, ReportDb } from "./types";

export type Call = { table: string; method: string; args: unknown[] };

export const TENANT_ID = "11111111-1111-4111-8111-111111111111";
export const USER_ID = "22222222-2222-4222-8222-222222222222";
export const OTHER_ID = "33333333-3333-4333-8333-333333333333";

/** Zincirin her yöntemi kendini döndürür; `await` boş sonuç verir (veri yok). */
export function recordingDb(rows: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  const chain = (table: string): unknown =>
    new Proxy(function noop() {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null, count: (rows[table] ?? []).length });
        }
        if (prop === "maybeSingle" || prop === "single") {
          return () => Promise.resolve({ data: null, error: null });
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(prop), args });
          return chain(table);
        };
      },
    });
  const db = {
    from: (table: string) => {
      calls.push({ table, method: "from", args: [table] });
      return chain(table);
    },
    rpc: (fn: string, args: unknown) => {
      calls.push({ table: `rpc:${fn}`, method: "rpc", args: [args] });
      return chain(`rpc:${fn}`);
    },
  };
  return { db: db as unknown as ReportDb, calls };
}

export function testCtx(over: Partial<ReportContext> = {}, rows: Record<string, unknown[]> = {}) {
  const { db, calls } = recordingDb(rows);
  const ctx: ReportContext = {
    scope: "tenant",
    supabase: db,
    tenantId: TENANT_ID,
    userId: USER_ID,
    role: "advisor",
    officeWide: false,
    seeAllEarnings: false,
    perms: {},
    listScope: { kind: "none" },
    officeName: "Test Gayrimenkul",
    sample: { include: true, counts: { realCustomers: 0, realProperties: 0 }, seeded: true, label: null, values: [true, false], apply: <Q,>(q: Q) => q },
    names: new Map(),
    memo: new Map([["stageNames", Object.fromEntries(Object.entries(defaultStageLabels()).map(([k, v]) => [k, v.label]))]]),
    ...over,
  };
  return { ctx, calls };
}

export const eqCalls = (calls: Call[]) => calls.filter((c) => c.method === "eq").map((c) => [String(c.args[0]), c.args[1]] as const);
