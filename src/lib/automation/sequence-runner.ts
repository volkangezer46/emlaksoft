import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { executeSequenceAction } from "@/lib/automation-engine";
import { getDisabledModulesByTenant, isDisabledFor } from "@/lib/modules/state";
import {
  decideExistingClaim,
  inSequenceSendWindow,
  nextDueAt,
  stepToAction,
  trDayStartIso,
} from "@/lib/automation/sequence-rules";

/**
 * Takip dizisi çalıştırıcısı (COM-05) — YENİ CRON YOK: mevcut `gorev-hatirlat` cron'unun (2 saatte bir) bağımsız adımıdır;
 * istemciyi o kapalı iş seçicisi verir (yeni service_role kullanımı doğmaz).
 *
 * İDEMPOTENT: her adım önce `message_sequence_step_runs (enrollment_id, step_index)` UNIQUE satırıyla sahiplenilir;
 * aynı adım iki kez GÖNDERİLMEZ (eşzamanlı iki çalıştırma, yeniden deneme, çöken çalıştırma dahil). Kayıt ilerletme
 * iyimser kilitlidir (`next_step` eşitliği). Sessiz saat (TR 09:00-20:00) dışında hiçbir adım çalışmaz. Dizi başına
 * günlük tavan (`daily_cap`) aşılırsa kalan adımlar ertesi çalıştırmaya kalır. Mesaj adımları otomasyonla AYNI
 * uygulayıcıdan geçer (kiracı sağlayıcısı + İYS kapısı + örnek kayıt freni).
 */

export type SequenceRunSummary = {
  due: number;
  executed: number;
  skipped: number;
  failed: number;
  completed: number;
  stopped: number;
  outsideWindow: boolean;
  timedOut: boolean;
  missingTables: boolean;
};

type DueRow = {
  id: string;
  tenant_id: string;
  sequence_id: string;
  customer_id: string;
  next_step: number;
  sequence: { id: string; name: string; is_active: boolean; daily_cap: number } | null;
  customer: { id: string; full_name: string | null; assigned_to: string | null; deleted_at: string | null; blacklist: boolean | null } | null;
};

type StepRow = { id: string; sort_order: number; delay_days: number; step_type: string; config: Record<string, unknown> };

const BATCH = 200;

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

async function finish(admin: SupabaseClient, row: DueRow, status: "completed" | "stopped", reason: string, lastResult?: unknown) {
  const ts = new Date().toISOString();
  await admin
    .from("message_sequence_enrollments")
    .update({ status, stop_reason: reason, finished_at: ts, next_due_at: null, updated_at: ts, ...(lastResult ? { last_result: lastResult } : {}) })
    .eq("id", row.id)
    .eq("tenant_id", row.tenant_id)
    .eq("status", "active");
}

export async function runDueSequenceSteps(
  admin: SupabaseClient,
  options: { deadlineMs?: number; nowMs?: number } = {},
): Promise<SequenceRunSummary> {
  const nowMs = options.nowMs ?? Date.now();
  const summary: SequenceRunSummary = {
    due: 0,
    executed: 0,
    skipped: 0,
    failed: 0,
    completed: 0,
    stopped: 0,
    outsideWindow: false,
    timedOut: false,
    missingTables: false,
  };
  if (!inSequenceSendWindow(nowMs)) {
    summary.outsideWindow = true;
    return summary;
  }
  const overDeadline = () => options.deadlineMs !== undefined && Date.now() >= options.deadlineMs;

  const { data, error } = await admin
    .from("message_sequence_enrollments")
    .select(
      "id, tenant_id, sequence_id, customer_id, next_step, " +
        "sequence:message_sequences!message_sequence_enrollments_sequence_tenant_fkey!inner(id, name, is_active, daily_cap), " +
        "customer:customers!message_sequence_enrollments_customer_tenant_fkey(id, full_name, assigned_to, deleted_at, blacklist)",
    )
    .eq("status", "active")
    .eq("sequence.is_active", true)
    .lte("next_due_at", new Date(nowMs).toISOString())
    .order("next_due_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    // 42P01: tablo yok (migration uygulanmadı) → boş çalıştırma, hata sayılmaz.
    if (error.code === "42P01" || error.code === "PGRST200" || error.code === "PGRST205") summary.missingTables = true;
    else summary.failed += 1;
    return summary;
  }
  const rows: DueRow[] = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as DueRow),
    sequence: one(r.sequence as DueRow["sequence"] | DueRow["sequence"][]),
    customer: one(r.customer as DueRow["customer"] | DueRow["customer"][]),
  }));
  summary.due = rows.length;
  if (rows.length === 0) return summary;

  const disabled = await getDisabledModulesByTenant(admin);
  const stepsCache = new Map<string, StepRow[]>();
  const sentToday = new Map<string, number>();
  const dayStart = trDayStartIso(nowMs);

  for (const row of rows) {
    if (overDeadline()) {
      summary.timedOut = true;
      break;
    }
    if (!row.sequence) continue;
    // Modül kapısı: "Otomasyon" kapalı ofisin dizileri bekler (silinmez, ilerlemez).
    if (isDisabledFor(disabled, row.tenant_id, "automation")) {
      summary.skipped += 1;
      continue;
    }
    if (!row.customer || row.customer.deleted_at || row.customer.blacklist) {
      await finish(admin, row, "stopped", "customer_removed");
      summary.stopped += 1;
      continue;
    }

    let steps = stepsCache.get(row.sequence_id);
    if (!steps) {
      const { data: s, error: sErr } = await admin
        .from("message_sequence_steps")
        .select("id, sort_order, delay_days, step_type, config")
        .eq("sequence_id", row.sequence_id)
        .eq("tenant_id", row.tenant_id)
        .order("sort_order", { ascending: true });
      if (sErr) {
        summary.failed += 1;
        continue;
      }
      steps = (s ?? []) as StepRow[];
      stepsCache.set(row.sequence_id, steps);
    }
    const step = steps[row.next_step];
    if (!step) {
      await finish(admin, row, "completed", "completed");
      summary.completed += 1;
      continue;
    }

    // Dizi başına günlük tavan (TR günü).
    let used = sentToday.get(row.sequence_id);
    if (used === undefined) {
      const { count } = await admin
        .from("message_sequence_step_runs")
        .select("id, enrollment:message_sequence_enrollments!inner(sequence_id)", { count: "exact", head: true })
        .eq("tenant_id", row.tenant_id)
        .eq("enrollment.sequence_id", row.sequence_id)
        .gte("created_at", dayStart);
      used = count ?? 0;
    }
    if (used >= row.sequence.daily_cap) {
      summary.skipped += 1;
      sentToday.set(row.sequence_id, used);
      continue;
    }

    // Sahiplen (UNIQUE). Çakışırsa: sonuçlanmış/eski sahiplenme → ilerle (yeniden gönderme yok), taze → bekle.
    const { data: claim, error: claimErr } = await admin
      .from("message_sequence_step_runs")
      .insert({ tenant_id: row.tenant_id, enrollment_id: row.id, step_index: row.next_step, step_type: step.step_type, result: "claimed" })
      .select("id")
      .single();
    let outcome: { result: "ok" | "skip" | "error"; detail?: string } | null = null;
    if (claimErr || !claim) {
      if (claimErr?.code !== "23505") {
        summary.failed += 1;
        continue;
      }
      const { data: existing } = await admin
        .from("message_sequence_step_runs")
        .select("result, created_at")
        .eq("enrollment_id", row.id)
        .eq("step_index", row.next_step)
        .maybeSingle();
      if (decideExistingClaim(existing as { result: string; created_at: string } | null, nowMs) === "wait") {
        summary.skipped += 1;
        continue;
      }
      outcome = { result: "skip", detail: "already_processed" };
    } else {
      sentToday.set(row.sequence_id, used + 1);
      const action = stepToAction(step);
      outcome = action
        ? await executeSequenceAction(
            admin,
            { ruleId: step.id, tenantId: row.tenant_id, name: row.sequence.name },
            action,
            {
              entityType: "customer",
              entityId: row.customer.id,
              customerId: row.customer.id,
              label: row.customer.full_name,
              assignedTo: row.customer.assigned_to,
            },
          )
        : { result: "skip", detail: "unsupported_step" };
      await admin
        .from("message_sequence_step_runs")
        .update({ result: outcome.result, detail: outcome.detail?.slice(0, 300) ?? null, updated_at: new Date().toISOString() })
        .eq("id", claim.id);
      if (outcome.result === "ok") summary.executed += 1;
      else if (outcome.result === "error") summary.failed += 1;
      else summary.skipped += 1;
    }

    // İlerle (iyimser kilit: yalnız hâlâ bu adımdaysa).
    const nextIndex = row.next_step + 1;
    const lastResult = { step: row.next_step, type: step.step_type, result: outcome.result, detail: outcome.detail ?? null, at: new Date().toISOString() };
    if (nextIndex >= steps.length) {
      const ts = new Date().toISOString();
      await admin
        .from("message_sequence_enrollments")
        .update({ status: "completed", stop_reason: "completed", finished_at: ts, next_due_at: null, next_step: nextIndex, last_result: lastResult, updated_at: ts })
        .eq("id", row.id)
        .eq("tenant_id", row.tenant_id)
        .eq("status", "active")
        .eq("next_step", row.next_step);
      summary.completed += 1;
    } else {
      await admin
        .from("message_sequence_enrollments")
        .update({ next_step: nextIndex, next_due_at: nextDueAt(nowMs, steps[nextIndex]!.delay_days), last_result: lastResult, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("tenant_id", row.tenant_id)
        .eq("status", "active")
        .eq("next_step", row.next_step);
    }
  }
  return summary;
}
