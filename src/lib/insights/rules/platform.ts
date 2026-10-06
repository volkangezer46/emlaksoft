import { buildDedupeKey, dayPeriod, weekPeriod } from "@/lib/insights/dedupe";
import type { InsightConfidence, InsightEvidence, InsightSeverity } from "@/lib/insights/types";
import type { PlatformInsightKind } from "@/lib/insights/platform-readable";
import { DAY_MS } from "@/lib/clock";

/**
 * PLATFORM içgörü kuralları (SAF): olgu girer, taslak çıkar. Dürüstlük: veri yoksa/eşik aşılmadıysa taslak YOK;
 * gözlenen olgu "tahmin" diye etiketlenmez, çıkarım içerenler (`isForecast`) açıkça tahmin etiketlidir.
 * Olgular `platform-facts.ts`'te kapalı (sabit) sorgularla yüklenir; bu dosya veritabanına dokunmaz.
 */

export type PlatformDraft = {
  kind: PlatformInsightKind;
  ruleId: string;
  severity: InsightSeverity;
  title: string;
  why: string;
  evidence: InsightEvidence[];
  /** `/admin` altı hedef (sıfır çıkmaz). */
  href: string;
  tenantId: string | null;
  entityType: string | null;
  entityId: string | null;
  isForecast: boolean;
  confidence: InsightConfidence | null;
  dedupeKey: string;
  validUntilMs: number;
  urgencyDays?: number | null;
  impact?: number | null;
};

export const PLATFORM_PAYMENT_RULE_ID = "platform_payment_failures@1";
export const PLATFORM_EF_RULE_ID = "platform_ef_drift@1";
export const PLATFORM_CRON_RULE_ID = "platform_cron_errors@1";
export const PLATFORM_RISKY_RULE_ID = "platform_risky_office@1";
export const PLATFORM_TRIAL_RULE_ID = "platform_trial_idle@1";

// ---- 1) Ödeme başarısızlığı artışı -------------------------------------------------------------------------------

export type PaymentFailureFact = { recent: number; previous: number; windowDays: number };
export const PAYMENT_MIN_RECENT = 3;

export function evaluatePaymentFailures(f: PaymentFailureFact | null, nowMs: number): PlatformDraft[] {
  if (!f || f.recent < PAYMENT_MIN_RECENT || f.recent < f.previous * 2) return [];
  const high = f.recent >= 8 || (f.previous === 0 && f.recent >= 5);
  return [
    {
      kind: "payment_risk",
      ruleId: PLATFORM_PAYMENT_RULE_ID,
      severity: high ? "yuksek" : "orta",
      title: `Ödeme sorunları arttı: son ${f.windowDays} günde ${f.recent} kayıt`,
      why: `İnceleme/yeniden deneme/iade bekleyen ödeme kaydı son ${f.windowDays} günde ${f.recent}, önceki ${f.windowDays} günde ${f.previous}. Sayılar ödeme yakalama kayıtlarından gelir (gözlem, tahmin değil).`,
      evidence: [
        { label: `Son ${f.windowDays} gün`, value: String(f.recent), href: "/admin/billing" },
        { label: `Önceki ${f.windowDays} gün`, value: String(f.previous) },
      ],
      href: "/admin/billing",
      tenantId: null,
      entityType: null,
      entityId: null,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("platform_payment_failures", "all", weekPeriod(nowMs)),
      validUntilMs: nowMs + 7 * DAY_MS,
      impact: Math.min(10, f.recent),
    },
  ];
}

// ---- 2) EF mutabakat sapması --------------------------------------------------------------------------------------

export type EfRunFact = { id: string; status: string; runAt: string; diffDegerleme: number | null; diffPdf: number | null };
export const EF_DRIFT_FRESH_DAYS = 3;

export function evaluateEfDrift(run: EfRunFact | null, nowMs: number): PlatformDraft[] {
  if (!run || run.status !== "drift") return [];
  const at = Date.parse(run.runAt);
  if (!Number.isFinite(at) || nowMs - at > EF_DRIFT_FRESH_DAYS * DAY_MS) return [];
  const dd = run.diffDegerleme ?? 0;
  const dp = run.diffPdf ?? 0;
  const total = Math.abs(dd) + Math.abs(dp);
  return [
    {
      kind: "revenue_anomaly",
      ruleId: PLATFORM_EF_RULE_ID,
      severity: total >= 10 ? "yuksek" : "orta",
      title: "EmlakFiyatı kontör mutabakatında sapma var",
      why: `Son mutabakat çalışması defter ile EmlakFiyatı kullanımı arasında fark buldu (değerleme ${dd >= 0 ? "+" : ""}${dd}, PDF ${dp >= 0 ? "+" : ""}${dp}). Fark gözlemdir; nedeni (gecikmiş kayıt, iade, çift sayım) elle incelenmelidir.`,
      evidence: [
        { label: "Değerleme farkı", value: String(dd), href: "/admin/ef-kontor" },
        { label: "PDF farkı", value: String(dp) },
        { label: "Çalışma", value: run.runAt.slice(0, 10) },
      ],
      href: "/admin/ef-kontor",
      tenantId: null,
      entityType: "ef_reconciliation_run",
      entityId: run.id,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("platform_ef_drift", run.id),
      validUntilMs: at + 7 * DAY_MS,
      impact: Math.min(10, total),
    },
  ];
}

// ---- 3) Hata veren cron'lar ---------------------------------------------------------------------------------------

export type CronErrorFact = { job: string; lastRunAt: string };

export function evaluateCronErrors(rows: readonly CronErrorFact[], nowMs: number): PlatformDraft[] {
  if (rows.length === 0) return [];
  const jobs = [...rows].map((r) => r.job).sort();
  const shown = jobs.slice(0, 5).join(", ") + (jobs.length > 5 ? ` +${jobs.length - 5}` : "");
  return [
    {
      kind: "system_health",
      ruleId: PLATFORM_CRON_RULE_ID,
      severity: jobs.length >= 3 ? "yuksek" : "orta",
      title: `${jobs.length} zamanlanmış iş son çalışmada hata verdi`,
      why: `Son çalışması hata ile biten işler: ${shown}. Kayıt, işin SON durumudur (geçmiş çalışmalar saklanmaz).`,
      evidence: [{ label: "Hatalı iş", value: String(jobs.length), href: "/admin/sistem" }],
      href: "/admin/sistem",
      tenantId: null,
      entityType: null,
      entityId: null,
      isForecast: false,
      confidence: null,
      // Aynı iş kümesi aynı gün tek içgörü; küme değişirse yeni içgörü.
      dedupeKey: buildDedupeKey("platform_cron_errors", jobs.join("+").slice(0, 120), dayPeriod(nowMs)),
      validUntilMs: nowMs + 2 * DAY_MS,
      impact: Math.min(10, jobs.length * 2),
    },
  ];
}

// ---- 4) Riskli ofis (ödeme gecikmesi) ----------------------------------------------------------------------------

export type PastDueOfficeFact = { tenantId: string; name: string };
export const MAX_RISKY_OFFICES = 10;

export function evaluateRiskyOffices(rows: readonly PastDueOfficeFact[], nowMs: number): PlatformDraft[] {
  return [...rows]
    .sort((a, b) => a.name.localeCompare(b.name, "tr") || a.tenantId.localeCompare(b.tenantId))
    .slice(0, MAX_RISKY_OFFICES)
    .map((o) => ({
      kind: "tenant_churn" as const,
      ruleId: PLATFORM_RISKY_RULE_ID,
      severity: "yuksek" as const,
      title: `${o.name}: ödeme gecikmiş`,
      why: "Ofisin aboneliği ödeme gecikmesi (past_due) durumunda. Bu bir gözlemdir; ayrılma olasılığı için tahmin üretilmez.",
      evidence: [{ label: "Ofis", value: o.name, href: `/admin/tenants/${o.tenantId}` }],
      href: `/admin/tenants/${o.tenantId}`,
      tenantId: o.tenantId,
      entityType: "tenant",
      entityId: o.tenantId,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("platform_risky_office", o.tenantId, weekPeriod(nowMs)),
      validUntilMs: nowMs + 7 * DAY_MS,
      urgencyDays: 3,
    }));
}

// ---- 5) Deneme bitimi yaklaşan ve etkileşimsiz ofis --------------------------------------------------------------

export type TrialIdleFact = { tenantId: string; name: string; trialEndsAt: string; activity7d: number };
export const TRIAL_WINDOW_DAYS = 3;
export const TRIAL_IDLE_MAX_ACTIVITY = 5;

export function evaluateTrialIdle(rows: readonly TrialIdleFact[], nowMs: number): PlatformDraft[] {
  const out: PlatformDraft[] = [];
  for (const r of rows) {
    const end = Date.parse(r.trialEndsAt);
    if (!Number.isFinite(end) || end <= nowMs) continue;
    const daysLeft = Math.ceil((end - nowMs) / DAY_MS);
    if (daysLeft > TRIAL_WINDOW_DAYS || r.activity7d > TRIAL_IDLE_MAX_ACTIVITY) continue;
    out.push({
      kind: "tenant_churn",
      ruleId: PLATFORM_TRIAL_RULE_ID,
      severity: daysLeft <= 1 ? "yuksek" : "orta",
      title: `${r.name}: deneme ${daysLeft} gün içinde bitiyor, kullanım az (tahmin)`,
      why: `Deneme süresi ${daysLeft} gün sonra bitiyor ve son 7 günde yalnız ${r.activity7d} işlem kaydı var. Gün sayısı ve işlem sayısı gözlemdir; "ücretliye geçmeme" çıkarımı TAHMİNDİR (kural tabanlı, istatistiksel model değil).`,
      evidence: [
        { label: "Kalan gün", value: String(daysLeft), href: `/admin/tenants/${r.tenantId}` },
        { label: "Son 7 gün işlem", value: String(r.activity7d) },
      ],
      href: `/admin/tenants/${r.tenantId}`,
      tenantId: r.tenantId,
      entityType: "tenant",
      entityId: r.tenantId,
      isForecast: true,
      confidence: "dusuk",
      dedupeKey: buildDedupeKey("platform_trial_idle", r.tenantId, r.trialEndsAt.slice(0, 10)),
      validUntilMs: end,
      urgencyDays: daysLeft,
    });
  }
  return out;
}
