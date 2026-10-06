/**
 * Ana ekran anlık görüntüsü: üç RPC (get_insights_snapshot / get_metrics_snapshot / get_tasks_snapshot) tek turda,
 * istek başına bir kez (React `cache()`). `_home/data.ts` yükleyicileri ve `insight-veri.ts` ÖNCE buradan okur;
 * RPC yoksa (migration henüz uygulanmadı; 60 sn yoklama ile tekrar denenmez), hata verirse ya da örnek-veri kararı
 * kodun kararıyla uyuşmazsa ilgili alan `null` kalır ve yükleyici mevcut sorgularına düşer. Sahte sıfır üretilmez.
 *
 * Migration: supabase/migrations/20261006000410_dashboard_snapshot_rpcs.sql (imzalar birebir).
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";
import { measure } from "@/lib/server-timing";
import {
  parseInsightsSnapshot,
  parseMetricsSnapshot,
  parseTasksSnapshot,
  type InsightsSnapshot,
  type MetricsSnapshot,
  type TasksSnapshot,
} from "./snapshot-core";

export interface DashboardSnapshot {
  insights: InsightsSnapshot | null;
  metrics: MetricsSnapshot | null;
  tasks: TasksSnapshot | null;
}

export const EMPTY_SNAPSHOT: DashboardSnapshot = { insights: null, metrics: null, tasks: null };

const RPC = {
  insights: "get_insights_snapshot",
  metrics: "get_metrics_snapshot",
  tasks: "get_tasks_snapshot",
} as const;

type RpcResult = { data: unknown; error: { code?: string | null; message?: string | null } | null };

async function callRpc<T>(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult> },
  name: string,
  args: Record<string, unknown>,
  parse: (raw: unknown) => T | null,
): Promise<T | null> {
  if (rpcKnownMissing(name)) return null;
  try {
    const res = await supabase.rpc(name, args);
    recordRpcOutcome(name, res.error);
    if (res.error || res.data == null) return null;
    return parse(res.data);
  } catch (e) {
    console.error(`dashboard snapshot ${name}`, e);
    return null;
  }
}

/**
 * Üç RPC paralel; her biri bağımsız başarısız olabilir (alan null → o yükleyici eski yola düşer).
 * Anahtar (tenantId, userId): `cache()` aynı istekte tekilleştirir.
 */
export const loadDashboardSnapshot = cache(async (tenantId: string, userId: string): Promise<DashboardSnapshot> => {
  if (!tenantId || !userId) return EMPTY_SNAPSHOT;
  try {
    const supabase = await createClient();
    const [insights, metrics, tasks] = await measure("home-snapshot", () => Promise.all([
      callRpc(supabase, RPC.insights, { p_tenant_id: tenantId }, parseInsightsSnapshot),
      callRpc(supabase, RPC.metrics, { p_tenant_id: tenantId, p_user_id: userId }, parseMetricsSnapshot),
      callRpc(supabase, RPC.tasks, { p_tenant_id: tenantId, p_user_id: userId }, parseTasksSnapshot),
    ]));
    return { insights, metrics, tasks };
  } catch {
    // İstemci kurulamadı (oturum yok vb.): yükleyiciler kendi sorgularına düşer.
    return EMPTY_SNAPSHOT;
  }
});

/** Ön yükleme (await etmeden): sayfa, blokları çizmeye başlamadan RPC turunu başlatır. */
export function preloadDashboardSnapshot(tenantId: string | null, userId: string): void {
  if (tenantId && userId) void loadDashboardSnapshot(tenantId, userId);
}
