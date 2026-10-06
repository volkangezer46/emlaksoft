import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findNotifiedKeys, insertNotifications, type NotificationRow } from "@/lib/notify-batch";
import { getDisabledModulesByTenant, isDisabledFor } from "@/lib/modules/state";
import { offerExpiryDedupeKey, offerExpiryTargetDay, OFFER_REMINDER_STATUSES } from "@/lib/offer-expiry";

/**
 * Teklif geçerlilik bitimi hatırlatması — `abonelik-kontrol` günlük cron'unun ADIMI (yeni cron YOK).
 * Geçerlilik tarihi (offers.valid_until, TR takvim günü) bugünden 2 gün sonra olan AÇIK teklifler için
 * teklifi açan kullanıcıya tek seferlik bildirim (dedupe `offer-exp:<teklif>:<tarih>`).
 * Teklifler modülü kapalı ofisler atlanır. `createAdminClient` BURADA çağrılmaz: cron'un istemcisi gelir.
 */
export type OfferExpirySummary = { notified: number; skipped: boolean };

export async function runOfferExpiryReminders(db: SupabaseClient, todayKey: string): Promise<OfferExpirySummary> {
  const target = offerExpiryTargetDay(todayKey);
  const { data, error } = await db
    .from("offers")
    .select("id, tenant_id, created_by, amount, valid_until, property:properties!offers_property_id_fkey(property_code)")
    .eq("valid_until", target)
    .in("status", [...OFFER_REMINDER_STATUSES])
    .not("created_by", "is", null)
    .limit(2000);
  if (error) return { notified: 0, skipped: true };

  const disabled = await getDisabledModulesByTenant(db);
  const offers = ((data ?? []) as {
    id: string;
    tenant_id: string;
    created_by: string;
    amount: number | null;
    valid_until: string;
    property: { property_code?: string } | { property_code?: string }[] | null;
  }[]).filter((o) => !isDisabledFor(disabled, o.tenant_id, "offers"));
  if (offers.length === 0) return { notified: 0, skipped: false };

  const keys = offers.map((o) => offerExpiryDedupeKey(o.id, o.valid_until));
  const already = await findNotifiedKeys(db, { tenantIds: [...new Set(offers.map((o) => o.tenant_id))], keys });
  const rows: NotificationRow[] = [];
  for (const o of offers) {
    const key = offerExpiryDedupeKey(o.id, o.valid_until);
    if (already?.has(key)) continue;
    const prop = Array.isArray(o.property) ? o.property[0] : o.property;
    rows.push({
      tenant_id: o.tenant_id,
      user_id: o.created_by,
      title: "Teklifin geçerliliği 2 gün sonra bitiyor",
      body: `${prop?.property_code ? `${prop.property_code} · ` : ""}geçerlilik ${o.valid_until.split("-").reverse().join(".")} — yanıt alın ya da süreyi güncelleyin.`,
      href: `/app/teklifler/${o.id}`,
      kind: "warning",
      dedupe_key: key,
    });
  }
  const notified = await insertNotifications(db, rows);
  return { notified, skipped: false };
}
