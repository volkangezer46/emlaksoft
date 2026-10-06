import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findNotifiedKeys, insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { isTenantSmsAvailable, sendTenantSms } from "@/lib/messaging/tenant-providers";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { isSmsEligibleStoredPhone } from "@/lib/rent-reminders/logic";
import { getSettingDef, storageKeyOf } from "@/lib/settings/registry";
import { OWNER_WEEKLY_REPORT_KEY } from "@/lib/settings/registry/tenant";
import { coerceInput } from "@/lib/settings/view";
import { buildOwnerReportSms, lastFullWeek, ownerReportDedupeKey } from "@/lib/owner-report/core";

/**
 * Malik haftalık raporu teslimi — `haftalik-ozet` cron'unun adımı (YENİ cron yok).
 *  - Yalnız ofis ayarı AÇIK ofisler (`office.owner_report.weekly_enabled`, varsayılan kapalı).
 *  - Aktif (süresi geçmemiş) malik paneli belirteci olan, örnek olmayan, silinmemiş portföyler.
 *  - Kanal: ofisin SMS sağlayıcısı hazır + malik telefonu TR cep → SMS (bağlantı yalnız); aksi halde sorumlu danışmana
 *    "bağlantıyı malike iletin" bildirimi. Her durumda bildirim = tekrar önleme kaydı (`owner-report:<belirteç>:<hafta>`).
 *  - Ofis başına çalıştırmada en çok 100 SMS; anahtar kolonu yoksa (eski şema) hiç gönderim yapılmaz (çift SMS riski).
 * `createAdminClient` BURADA çağrılmaz: cron'un mevcut istemcisi parametre gelir.
 */

const SMS_PER_TENANT = 100;
const TOKEN_LIMIT = 2000;

export type OwnerReportRunSummary = { tenants: number; sms: number; notified: number; skipped: boolean };

export async function runOwnerWeeklyReports(db: SupabaseClient, input: { todayKey: string; nowIso: string; baseUrl: string }): Promise<OwnerReportRunSummary> {
  const out: OwnerReportRunSummary = { tenants: 0, sms: 0, notified: 0, skipped: false };
  const def = getSettingDef(OWNER_WEEKLY_REPORT_KEY);
  if (!def) return out;
  const { data: settings, error } = await db.from("tenant_settings").select("tenant_id, value").eq("key", storageKeyOf(def)).limit(5000);
  if (error) return { ...out, skipped: true };
  const tenantIds = ((settings ?? []) as { tenant_id: string; value: unknown }[])
    .filter((s) => {
      const parsed = coerceInput(def, s.value);
      return parsed.ok && parsed.value === true;
    })
    .map((s) => s.tenant_id);
  if (tenantIds.length === 0) return out;

  const { data: tenants } = await db.from("tenants").select("id, name").in("id", tenantIds).in("status", ["active", "trial", "past_due"]);
  const tenantName = new Map(((tenants ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  if (tenantName.size === 0) return out;
  out.tenants = tenantName.size;

  const { data: tokens } = await db
    .from("owner_portal_tokens")
    .select("id, tenant_id, property_id, token, owner_phone")
    .in("tenant_id", [...tenantName.keys()])
    .gt("expires_at", input.nowIso)
    .order("created_at", { ascending: false })
    .limit(TOKEN_LIMIT);
  const tokenRows = (tokens ?? []) as { id: string; tenant_id: string; property_id: string; token: string; owner_phone: string | null }[];
  if (tokenRows.length === 0) return out;

  const { data: props } = await db
    .from("properties")
    .select("id, tenant_id, title, property_code, assigned_to")
    .in("id", [...new Set(tokenRows.map((t) => t.property_id))])
    .eq("is_sample", false)
    .is("deleted_at", null);
  const propById = new Map(((props ?? []) as { id: string; tenant_id: string; title: string | null; property_code: string | null; assigned_to: string | null }[]).map((p) => [p.id, p]));

  // Aynı portföy için birden çok belirteç olabilir: en yenisi (sıralı geldi) yeter.
  const seenProperty = new Set<string>();
  const candidates = tokenRows.filter((t) => {
    const p = propById.get(t.property_id);
    if (!p || p.tenant_id !== t.tenant_id || seenProperty.has(t.property_id)) return false;
    seenProperty.add(t.property_id);
    return true;
  });
  const week = lastFullWeek(input.todayKey);
  const keys = candidates.map((t) => ownerReportDedupeKey(t.id, week.startDay));
  const done = await findNotifiedKeys(db, { tenantIds: [...new Set(candidates.map((t) => t.tenant_id))], keys });
  if (done === null) return { ...out, skipped: true };

  const smsReady = new Map<string, boolean>();
  const smsCount = new Map<string, number>();
  const rows: NotificationRow[] = [];
  for (const t of candidates) {
    const key = ownerReportDedupeKey(t.id, week.startDay);
    if (done.has(key)) continue;
    const p = propById.get(t.property_id)!;
    const label = p.title || p.property_code || "Portföy";
    const url = `${input.baseUrl.replace(/\/$/, "")}/malik-portali/${t.token}#haftalik-rapor`;

    let smsSent = false;
    const parsed = t.owner_phone ? parsePhoneStrict(t.owner_phone) : null;
    const stored = parsed && parsed.ok ? parsed.stored : null;
    if (stored && isSmsEligibleStoredPhone(stored) && (smsCount.get(t.tenant_id) ?? 0) < SMS_PER_TENANT) {
      if (!smsReady.has(t.tenant_id)) smsReady.set(t.tenant_id, await isTenantSmsAvailable(t.tenant_id).catch(() => false));
      if (smsReady.get(t.tenant_id)) {
        const res = await sendTenantSms(t.tenant_id, stored, buildOwnerReportSms(tenantName.get(t.tenant_id) ?? "Ofisiniz", label, url)).catch(() => null);
        if (res && res.ok) {
          smsSent = true;
          smsCount.set(t.tenant_id, (smsCount.get(t.tenant_id) ?? 0) + 1);
          out.sms += 1;
        }
      }
    }
    rows.push({
      tenant_id: t.tenant_id,
      user_id: p.assigned_to,
      title: smsSent ? `Malik haftalık raporu SMS ile gönderildi: ${label}` : `Malik haftalık raporu hazır: ${label}`,
      body: smsSent
        ? "Malik panelindeki \"Haftalık rapor\" bağlantısı malikin telefonuna gönderildi."
        : "Malik paneli bağlantısını malike iletin (Sunumlar ve portal bağlantıları sayfasından kopyalayabilirsiniz). Rapor panelin \"Haftalık rapor\" bölümündedir.",
      href: "/app/portfoyler/sunumlar",
      kind: "info",
      dedupe_key: key,
    });
  }
  if (rows.length > 0) out.notified = await insertNotifications(db, rows);
  return out;
}
