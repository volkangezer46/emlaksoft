import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/cron-run";
import { findNotifiedKeys, insertNotificationsDetailed, type NotificationRow } from "@/lib/notify-batch";
import { getSettingDef, storageKeyOf } from "@/lib/settings/registry";
import { notifyKey } from "@/lib/settings/registry/tenant";
import { coerceInput } from "@/lib/settings/view";
import { authorityDedupeKey, authorityReminderStep, authorityReminderTitle, daysBetween } from "@/lib/property-authority-reminders-core";

/**
 * Portföy yetkisi bitiş hatırlatması — VARSAYILAN AÇIK bildirim, `abonelik-kontrol` cron'unun adımı (YENİ cron yok).
 * Yetki bitişine 30 / 7 gün kala ve bitiş gününde (en çok 3 gün geriye) portföyün danışmanına (danışmansız portföyde
 * ofis sahibi/genel müdüre) tek seferlik bildirim. Otomasyon kuralındaki "yetki bitiyor" tetikleyicisinden BAĞIMSIZDIR
 * (ofis kural kurmamış olsa da çalışır). Tercih anahtarı `authority`: kullanıcı kapattıysa ya da hiç belirlememiş ve ofis
 * varsayılanı kapalıysa yazılmaz. Anahtar kolonu yoksa (eski şema) hiç yazmaz (her gün tekrar etmesin diye).
 * Örnek (is_sample), silinmiş ve kapanmış (satıldı/kiralandı/arşiv/geri çekildi) portföyler atlanır.
 * `createAdminClient` BURADA çağrılmaz: cron'un istemcisi parametre gelir.
 */

const HREF_BASE = "/app/portfoyler";
const CLOSED_STATUSES = "(sold,rented,archived,withdrawn)";
const MAX_ROWS_PAGES = 5;

type PropRow = { id: string; tenant_id: string; property_code: string | null; title: string | null; assigned_to: string | null; authorization_end: string };

function addDays(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export type AuthorityReminderSummary = { candidates: number; written: number; skipped: boolean };

export async function runPropertyAuthorityReminders(db: SupabaseClient, todayKey: string): Promise<AuthorityReminderSummary> {
  const summary: AuthorityReminderSummary = { candidates: 0, written: 0, skipped: false };
  const { rows: props, error } = await fetchAllPaged<PropRow>(
    (from, to) =>
      db
        .from("properties")
        .select("id, tenant_id, property_code, title, assigned_to, authorization_end")
        .is("deleted_at", null)
        .eq("is_sample", false)
        .not("status", "in", CLOSED_STATUSES)
        .not("authorization_end", "is", null)
        .gte("authorization_end", addDays(todayKey, -3))
        .lte("authorization_end", addDays(todayKey, 30))
        .order("authorization_end", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    1000,
    MAX_ROWS_PAGES,
  );
  if (error && props.length === 0) {
    summary.skipped = true;
    return summary;
  }
  const due = props
    .map((p) => ({ p, step: authorityReminderStep(p.authorization_end, todayKey), left: daysBetween(todayKey, String(p.authorization_end).slice(0, 10)) ?? 0 }))
    .filter((x) => x.step !== null);
  summary.candidates = due.length;
  if (due.length === 0) return summary;

  const tenantIds = [...new Set(due.map((x) => x.p.tenant_id))];
  // Danışmansız portföy: ofis sahibi + genel müdür.
  const { data: managerRows } = await db.from("profiles").select("id, tenant_id").in("tenant_id", tenantIds).in("role", ["owner", "gm"]).eq("is_active", true).limit(2000);
  const managers = new Map<string, string[]>();
  for (const m of (managerRows ?? []) as { id: string; tenant_id: string }[]) managers.set(m.tenant_id, [...(managers.get(m.tenant_id) ?? []), m.id]);

  const rows: NotificationRow[] = [];
  for (const { p, step, left } of due) {
    const recipients = p.assigned_to ? [p.assigned_to] : (managers.get(p.tenant_id) ?? []);
    const label = [p.property_code, p.title].filter(Boolean).join(" ");
    for (const userId of recipients) {
      rows.push({
        tenant_id: p.tenant_id,
        user_id: userId,
        title: authorityReminderTitle(step!, label, left),
        body: `Yetki bitişi: ${String(p.authorization_end).slice(0, 10)}. Malikle yenileme görüşmesi yapın; uzatılırsa portföy kartından yeni tarihi girin.`,
        href: `${HREF_BASE}/${p.id}`,
        kind: step === "30" ? "info" : "warning",
        dedupe_key: authorityDedupeKey(p.id, p.authorization_end, step!, userId),
      });
    }
  }
  if (rows.length === 0) return summary;

  // Kullanıcı tercihi + ofis varsayılanı (notify.ts ile aynı kural: kullanıcı belirlediyse o, yoksa ofis varsayılanı).
  const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
  const prefOf = new Map<string, unknown>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await db.from("profiles").select("id, notification_prefs, is_active").in("id", userIds.slice(i, i + 200));
    for (const u of (data ?? []) as { id: string; notification_prefs: Record<string, unknown> | null; is_active: boolean }[]) {
      prefOf.set(u.id, u.is_active ? (u.notification_prefs?.authority ?? null) : false);
    }
  }
  const officeOff = new Set<string>();
  const def = getSettingDef(notifyKey("authority"));
  if (def) {
    const { data: settings } = await db.from("tenant_settings").select("tenant_id, value").eq("key", storageKeyOf(def)).in("tenant_id", tenantIds);
    for (const s of (settings ?? []) as { tenant_id: string; value: unknown }[]) {
      const c = coerceInput(def, s.value);
      if (c.ok && c.value === false) officeOff.add(s.tenant_id);
    }
  }
  const wanted = rows.filter((r) => {
    const pref = prefOf.get(String(r.user_id));
    if (pref === false) return false;
    if (pref === true) return true;
    if (!prefOf.has(String(r.user_id))) return false; // profil yok/okunamadı
    return !officeOff.has(r.tenant_id);
  });
  if (wanted.length === 0) return summary;

  const seen = await findNotifiedKeys(db, { tenantIds, keys: wanted.map((r) => r.dedupe_key ?? "") });
  if (seen === null) {
    summary.skipped = true;
    return summary;
  }
  const res = await insertNotificationsDetailed(db, wanted.filter((r) => !seen.has(r.dedupe_key ?? "")));
  summary.written = res.written;
  return summary;
}
