import { anomalyTypeLabel } from "@/components/listing-control/helpers";
import { officeDigestDefault, wantsDigest } from "@/lib/digest-prefs";
import { insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { buildDedupeKey } from "@/lib/notify-dedupe";
import { LC_REPORT_DAILY_KEY, LC_REPORT_WEEKLY_KEY } from "@/lib/settings/registry/tenant";
import { getSettingDef } from "@/lib/settings/registry";
import { coerceInput } from "@/lib/settings/view";
import { buildControlReport, reportPeriodKey, windowMs, type ControlReportFacts, type ReportPeriod } from "../report-digest";
import { isMissingSchema, type Db } from "./db";

/**
 * İlan Kontrol günlük/haftalık rapor TESLİMİ (ofis ayarıyla açılır; varsayılan KAPALI). Mevcut `gunluk-ozet` ve
 * `haftalik-ozet` cron'larına eklenen en iyi çaba adımdır (yeni cron YOK). Teslim kanalı zil bildirimidir (e-posta:
 * depoda işlemsel e-posta sağlayıcısı yok, uydurulmadı). Alıcı: ofis sahibi + genel müdür; kendi `digest` tercihini
 * kapatanlara gitmez. Dedupe: (rapor, dönem, ofis, dönem anahtarı, kullanıcı) tekildir; tekrar çalışma ikinci bildirim
 * üretmez. service_role istemcisi çağıran cron'dan gelir (kabul listesindeki yol); her sorguda tenant_id açık süzgeçtir.
 */

export type ReportDeliverySummary = { tenants: number; sent: number; skippedNoData: number; failed: number; schemaMissing: boolean };

const MAX_TENANTS = 300;
const OPEN_STATUSES = ["open", "acknowledged", "explained"];

export async function runControlReportDelivery(
  db: Db,
  period: ReportPeriod,
  nowMs: number,
  opts: { disabledTenantIds?: ReadonlySet<string> } = {},
): Promise<ReportDeliverySummary> {
  const out: ReportDeliverySummary = { tenants: 0, sent: 0, skippedNoData: 0, failed: 0, schemaMissing: false };
  const key = period === "daily" ? LC_REPORT_DAILY_KEY : LC_REPORT_WEEKLY_KEY;
  const def = getSettingDef(key);
  if (!def) return out;

  const { data: settingRows, error: settingError } = await db.from("tenant_settings").select("tenant_id, value").eq("key", key).limit(MAX_TENANTS);
  if (settingError) {
    out.schemaMissing = isMissingSchema(settingError);
    return out;
  }
  const enabled: string[] = [];
  for (const r of (settingRows ?? []) as { tenant_id: string; value: unknown }[]) {
    const c = coerceInput(def, r.value);
    if (c.ok && c.value === true && !opts.disabledTenantIds?.has(r.tenant_id)) enabled.push(r.tenant_id);
  }
  out.tenants = enabled.length;

  const sinceIso = new Date(nowMs - windowMs(period)).toISOString();
  const nowIso = new Date(nowMs).toISOString();
  const periodKey = reportPeriodKey(period, nowMs);
  const rows: NotificationRow[] = [];

  for (const tenantId of enabled) {
    const facts = await loadFacts(db, tenantId, sinceIso, nowIso);
    if (!facts) {
      out.schemaMissing = true;
      continue;
    }
    const report = buildControlReport(period, facts);
    if (!report) {
      out.skippedNoData += 1;
      continue;
    }
    const { data: profiles } = await db
      .from("profiles")
      .select("id, notification_prefs")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("role", ["owner", "gm"]);
    const officeDigest = await officeDigestDefault(db, tenantId);
    for (const p of (profiles ?? []) as { id: string; notification_prefs: unknown }[]) {
      if (!wantsDigest(p.notification_prefs, officeDigest)) continue;
      rows.push({
        tenant_id: tenantId,
        user_id: p.id,
        title: report.title,
        body: report.body,
        href: report.href,
        kind: report.kind,
        dedupe_key: buildDedupeKey("lc-report", period, tenantId, periodKey, p.id),
      });
    }
  }

  const res = await insertNotificationsDetailed(db, rows);
  out.sent = res.written;
  out.failed = res.failed;
  return out;
}

async function loadFacts(db: Db, tenantId: string, sinceIso: string, nowIso: string): Promise<ControlReportFacts | null> {
  const base = () => db.from("listing_anomalies").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  try {
    const [open, overdue, opened, resolved] = await Promise.all([
      base().in("status", OPEN_STATUSES),
      base().in("status", ["open", "acknowledged"]).not("sla_due_at", "is", null).lt("sla_due_at", nowIso),
      base().gte("first_seen_at", sinceIso),
      base().gte("resolved_at", sinceIso),
    ]);
    for (const r of [open, overdue, opened, resolved]) if (r.error) throw r.error;
    const tally = new Map<string, number>();
    if ((open.count ?? 0) > 0) {
      const { data } = await db.from("listing_anomalies").select("type").eq("tenant_id", tenantId).in("status", OPEN_STATUSES).limit(1000);
      for (const r of (data ?? []) as { type: string }[]) tally.set(r.type, (tally.get(r.type) ?? 0) + 1);
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { open: open.count ?? 0, overdue: overdue.count ?? 0, opened: opened.count ?? 0, resolved: resolved.count ?? 0, topTypeLabel: top ? anomalyTypeLabel(top[0]) : null, topTypeCount: top?.[1] ?? 0 };
  } catch {
    return null;
  }
}
