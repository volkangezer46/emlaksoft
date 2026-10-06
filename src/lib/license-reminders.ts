import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findNotifiedKeys, insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { annualLicenseFeeReminderDue, licenseExpiryReminderStep } from "@/lib/license";
import { getSettingDef, storageKeyOf } from "@/lib/settings/registry";
import { LICENSE_FEE_MONTH_KEY } from "@/lib/settings/registry/tenant";
import { coerceInput } from "@/lib/settings/view";

/**
 * Yetki belgesi hatırlatmaları — `abonelik-kontrol` cron'unun adımı (YENİ cron yok).
 *  1) Geçerlilik tarihi (tenants.license_valid_until, 20260826001800) 60/30/7 gün kala ve süresi dolunca (en çok 30 gün
 *     geriye) owner/gm'ye tek seferlik bildirim (dedupe `lic-exp:<ofis>:<tarih>:<kademe>`).
 *  2) Yıllık harç/ödeme kontrolü: ofis ayarı `office.license.annual_fee_month` (varsayılan kapalı) ayında yılda bir kez
 *     (dedupe `lic-fee:<ofis>:<yıl>`). Tutar/son gün YAZILMAZ.
 * `createAdminClient` BURADA çağrılmaz: cron'un mevcut istemcisi parametre gelir. Sütun/tablo yoksa adım sessizce atlanır.
 */

const HREF = "/app/ayarlar";
const MANAGER_ROLES = ["owner", "gm"];

type Db = SupabaseClient;

function addDays(dayKey: string, days: number): string {
  const ms = Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function managersByTenant(db: Db, tenantIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (tenantIds.length === 0) return out;
  const { data } = await db
    .from("profiles")
    .select("id, tenant_id, role")
    .in("tenant_id", tenantIds)
    .in("role", MANAGER_ROLES)
    .eq("is_active", true)
    .limit(2000);
  for (const r of (data ?? []) as { id: string; tenant_id: string }[]) {
    out.set(r.tenant_id, [...(out.get(r.tenant_id) ?? []), r.id]);
  }
  return out;
}

export type LicenseReminderSummary = { expiry: number; annualFee: number; skipped: boolean };

export async function runLicenseReminders(db: Db, todayKey: string): Promise<LicenseReminderSummary> {
  const summary: LicenseReminderSummary = { expiry: 0, annualFee: 0, skipped: false };
  const rows: NotificationRow[] = [];

  // 1) Geçerlilik tarihi kademeleri
  const { data: tenants, error } = await db
    .from("tenants")
    .select("id, license_no, license_valid_until, status")
    .in("status", ["active", "trialing", "past_due"])
    .not("license_valid_until", "is", null)
    .gte("license_valid_until", addDays(todayKey, -30))
    .lte("license_valid_until", addDays(todayKey, 60))
    .limit(1000);
  if (error) {
    summary.skipped = true; // sütun yok (migration uygulanmadı) ya da geçici hata: adım atlanır
  } else {
    const due = ((tenants ?? []) as { id: string; license_valid_until: string | null }[])
      .map((t) => ({ id: t.id, until: t.license_valid_until, step: licenseExpiryReminderStep(t.license_valid_until, todayKey) }))
      .filter((t) => t.step !== null);
    const managers = await managersByTenant(db, due.map((t) => t.id));
    for (const t of due) {
      const title =
        t.step === "expired" ? "Yetki belgesinin süresi doldu" : `Yetki belgesinin süresi ${t.step} gün içinde doluyor`;
      for (const userId of managers.get(t.id) ?? []) {
        rows.push({
          tenant_id: t.id,
          user_id: userId,
          title,
          body: `Geçerlilik tarihi: ${t.until}. Yenileme sonrası yeni tarihi Ayarlar > Firma bilgileri'ne girin.`,
          href: HREF,
          kind: t.step === "60" ? "warning" : "danger",
          dedupe_key: `lic-exp:${t.id}:${t.until}:${t.step}:${userId}`,
        });
      }
    }
    summary.expiry = due.length;
  }

  // 2) Yıllık harç kontrolü (ayar açık + bu ay)
  const def = getSettingDef(LICENSE_FEE_MONTH_KEY);
  if (def) {
    const { data: settings, error: settingsError } = await db
      .from("tenant_settings")
      .select("tenant_id, value")
      .eq("key", storageKeyOf(def))
      .limit(5000);
    if (!settingsError) {
      const year = todayKey.slice(0, 4);
      const dueTenants = ((settings ?? []) as { tenant_id: string; value: unknown }[])
        .filter((s) => {
          const parsed = coerceInput(def, s.value);
          return parsed.ok && annualLicenseFeeReminderDue(Number(parsed.value), todayKey);
        })
        .map((s) => s.tenant_id);
      const managers = await managersByTenant(db, dueTenants);
      for (const tenantId of dueTenants) {
        for (const userId of managers.get(tenantId) ?? []) {
          rows.push({
            tenant_id: tenantId,
            user_id: userId,
            title: "Yetki belgesi yıllık harç kontrolü",
            body: "Yetki belgenizle ilgili yıllık harç/ödeme yükümlülüğünü ve belge bilgilerinin güncelliğini kontrol edin (tutar ve son günü güncel mevzuattan doğrulayın).",
            href: HREF,
            kind: "warning",
            dedupe_key: `lic-fee:${tenantId}:${year}:${userId}`,
          });
        }
      }
      summary.annualFee = dueTenants.length;
    }
  }

  if (rows.length === 0) return summary;
  // Günlük cron: anahtar kolonu yoksa (eski şema) her gün aynı bildirim yazılırdı → o durumda hiç yazma.
  const seen = await findNotifiedKeys(db, {
    tenantIds: [...new Set(rows.map((r) => r.tenant_id))],
    keys: rows.map((r) => r.dedupe_key ?? ""),
  });
  if (seen === null) {
    summary.skipped = true;
    return summary;
  }
  await insertNotifications(db, rows.filter((r) => !seen.has(r.dedupe_key ?? "")));
  return summary;
}
