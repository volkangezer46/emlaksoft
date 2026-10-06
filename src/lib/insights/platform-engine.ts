import type { SupabaseClient } from "@supabase/supabase-js";
import { DAY_MS } from "@/lib/clock";
import { computePriority, explainPriority } from "@/lib/insights/priority";
import { isMissingSchemaError } from "@/lib/insights/facts";
import { platformInsightModule } from "@/lib/insights/platform-readable";
import {
  evaluateCronErrors,
  evaluateEfDrift,
  evaluatePaymentFailures,
  evaluateRiskyOffices,
  evaluateTrialIdle,
  TRIAL_WINDOW_DAYS,
  type CronErrorFact,
  type EfRunFact,
  type PastDueOfficeFact,
  type PaymentFailureFact,
  type PlatformDraft,
  type TrialIdleFact,
} from "@/lib/insights/rules/platform";
import { platformCanAccess, type PlatformRole } from "@/lib/platform-access";

/**
 * PLATFORM İÇGÖRÜ ÜRETİCİSİ: `platform_insights` tablosunu gerçek kurallarla doldurur.
 *
 * - `admin` (service_role) ÇAĞIRAN tarafından, kapalı iş seçiciyle verilir (`runBillingReconciliation(…, "platform_insights")`);
 *   bu dosya istemci OLUŞTURMAZ ve kabul listesine satır eklemez.
 * - HİÇBİR ŞEYİ DEĞİŞTİRMEZ: yalnız `platform_insights` satırı yazar. (staff_id, dedupe_key) çakışırsa satıra dokunulmaz
 *   (yoksayılmış/ertelenmiş içgörü yeniden açılmaz).
 * - Dürüstlük: olgu yoksa / tablo yoksa taslak üretilmez; olgu yükleyicisi hata verirse o kural atlanır (diğerleri sürer).
 * - Alıcı: aktif platform personeli; içgörü türünü görebilen rollere satır yazılır (okuma tarafıyla aynı süzgeç).
 */

export type PlatformEngineSummary = { inserted: number; staff: number; drafts: number; rulesUnavailable: string[]; tableMissing: boolean };

class FactsUnavailable extends Error {}

function check(error: { code?: string; message?: string } | null, what: string): void {
  if (!error) return;
  if (isMissingSchemaError(error)) throw new FactsUnavailable(what);
  throw new Error(`${what}: ${error.code ?? "hata"}`);
}

async function loadPaymentFailures(admin: SupabaseClient, nowMs: number): Promise<PaymentFailureFact> {
  const windowDays = 7;
  const bad = ["manual_review", "refund_required", "retry_pending"];
  const recentSince = new Date(nowMs - windowDays * DAY_MS).toISOString();
  const prevSince = new Date(nowMs - 2 * windowDays * DAY_MS).toISOString();
  const base = () => admin.from("billing_payment_captures").select("id", { count: "exact", head: true }).in("status", bad);
  const [recent, prev] = await Promise.all([base().gte("captured_at", recentSince), base().gte("captured_at", prevSince).lt("captured_at", recentSince)]);
  check(recent.error, "billing_payment_captures");
  check(prev.error, "billing_payment_captures");
  return { recent: recent.count ?? 0, previous: prev.count ?? 0, windowDays };
}

async function loadLatestEfRun(admin: SupabaseClient): Promise<EfRunFact | null> {
  const { data, error } = await admin
    .from("ef_reconciliation_runs")
    .select("id, status, run_at, diff_degerleme, diff_pdf")
    .order("run_at", { ascending: false })
    .limit(1);
  check(error, "ef_reconciliation_runs");
  const r = (data ?? [])[0] as { id: string; status: string; run_at: string; diff_degerleme: number | null; diff_pdf: number | null } | undefined;
  return r ? { id: r.id, status: r.status, runAt: r.run_at, diffDegerleme: r.diff_degerleme, diffPdf: r.diff_pdf } : null;
}

async function loadCronErrors(admin: SupabaseClient, nowMs: number): Promise<CronErrorFact[]> {
  const since = new Date(nowMs - 2 * DAY_MS).toISOString();
  const { data, error } = await admin.from("cron_heartbeats").select("job, last_run_at").eq("last_status", "error").gte("last_run_at", since).limit(100);
  check(error, "cron_heartbeats");
  return ((data ?? []) as { job: string; last_run_at: string }[]).map((r) => ({ job: r.job, lastRunAt: r.last_run_at }));
}

async function loadPastDueOffices(admin: SupabaseClient): Promise<PastDueOfficeFact[]> {
  const { data, error } = await admin.from("tenants").select("id, name").eq("status", "past_due").limit(200);
  check(error, "tenants");
  return ((data ?? []) as { id: string; name: string }[]).map((t) => ({ tenantId: t.id, name: t.name }));
}

async function loadTrialIdle(admin: SupabaseClient, nowMs: number): Promise<TrialIdleFact[]> {
  const { data, error } = await admin
    .from("tenants")
    .select("id, name, trial_ends_at")
    .eq("status", "trial")
    .gt("trial_ends_at", new Date(nowMs).toISOString())
    .lte("trial_ends_at", new Date(nowMs + TRIAL_WINDOW_DAYS * DAY_MS).toISOString())
    .limit(200);
  check(error, "tenants");
  const tenants = (data ?? []) as { id: string; name: string; trial_ends_at: string }[];
  const since = new Date(nowMs - 7 * DAY_MS).toISOString();
  const out: TrialIdleFact[] = [];
  for (const t of tenants) {
    // Etkileşim = denetim kaydı sayısı (son 7 gün); kayıt tablosu okunamazsa o ofis için olgu YOK (içgörü uydurulmaz).
    const { count, error: e } = await admin.from("audit_logs").select("id", { count: "exact", head: true }).eq("tenant_id", t.id).gte("created_at", since);
    if (e) continue;
    out.push({ tenantId: t.id, name: t.name, trialEndsAt: t.trial_ends_at, activity7d: count ?? 0 });
  }
  return out;
}

export async function runPlatformInsightEngine(admin: SupabaseClient, opts: { nowMs: number }): Promise<PlatformEngineSummary> {
  const { nowMs } = opts;
  const summary: PlatformEngineSummary = { inserted: 0, staff: 0, drafts: 0, rulesUnavailable: [], tableMissing: false };

  const { data: staffRows, error: staffError } = await admin.from("platform_staff").select("id, role").eq("is_active", true).limit(200);
  if (staffError) {
    summary.tableMissing = isMissingSchemaError(staffError);
    return summary;
  }
  const staff = (staffRows ?? []) as { id: string; role: PlatformRole }[];
  summary.staff = staff.length;
  if (staff.length === 0) return summary;

  const drafts: PlatformDraft[] = [];
  const attempt = async (ruleId: string, fn: () => Promise<PlatformDraft[]>) => {
    try {
      drafts.push(...(await fn()));
    } catch (e) {
      if (e instanceof FactsUnavailable) summary.rulesUnavailable.push(ruleId);
      else console.error("platform-insight rule", ruleId, e instanceof Error ? e.message : "hata");
    }
  };
  await attempt("platform_payment_failures@1", async () => evaluatePaymentFailures(await loadPaymentFailures(admin, nowMs), nowMs));
  await attempt("platform_ef_drift@1", async () => evaluateEfDrift(await loadLatestEfRun(admin), nowMs));
  await attempt("platform_cron_errors@1", async () => evaluateCronErrors(await loadCronErrors(admin, nowMs), nowMs));
  await attempt("platform_risky_office@1", async () => evaluateRiskyOffices(await loadPastDueOffices(admin), nowMs));
  await attempt("platform_trial_idle@1", async () => evaluateTrialIdle(await loadTrialIdle(admin, nowMs), nowMs));
  summary.drafts = drafts.length;
  if (drafts.length === 0) return summary;

  const rows = drafts.flatMap((d) => {
    const pr = computePriority({ severity: d.severity, urgencyDays: d.urgencyDays, impact: d.impact });
    const module = platformInsightModule(d.kind);
    return staff
      .filter((s) => platformCanAccess(s.role, module))
      .map((s) => ({
        staff_id: s.id,
        tenant_id: d.tenantId,
        kind: d.kind,
        rule_id: d.ruleId,
        severity: d.severity,
        priority: pr.priority,
        title: d.title.slice(0, 200),
        why: d.why.slice(0, 600),
        evidence: [...d.evidence, { label: "Sıra", value: explainPriority(pr) }].slice(0, 8),
        href: d.href,
        entity_type: d.entityType,
        entity_id: d.entityId,
        is_forecast: d.isForecast,
        confidence: d.confidence,
        dedupe_key: d.dedupeKey,
        valid_until: new Date(d.validUntilMs).toISOString(),
      }));
  });

  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await admin
      .from("platform_insights")
      .upsert(rows.slice(i, i + 200), { onConflict: "staff_id,dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) {
      if (isMissingSchemaError(error)) {
        summary.tableMissing = true;
        return summary;
      }
      throw new Error(`platform_insights(insert): ${error.code ?? "hata"}`);
    }
    summary.inserted += (data ?? []).length;
  }
  return summary;
}
