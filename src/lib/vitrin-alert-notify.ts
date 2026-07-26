import type { createAdminClient } from "@/lib/supabase/admin";
import { notifyTenant } from "@/lib/notify";
import { formatTurkishPhone } from "@/lib/phone";

/**
 * Vitrin fiyat alarmı işleyicisi — saf helper (admin client parametreli).
 *
 * Bekleyen alarmları (notified_at null) tarar; ilanın GÜNCEL liste fiyatı
 * alarmın kurulduğu andaki baseline_price'ın ALTINA düştüyse OFİSE "ziyaretçiyi
 * arayın" bildirimi yazar ve notified_at doldurur (tek seferlik). Ziyaretçiye
 * SMS GÖNDERİLMEZ — maliyet + İYS; arama danışmanın işidir.
 *
 * NEDEN baseline kıyası: projede price_history yok; düşüş, alarm anındaki
 * fiyatın satırda saklanmasıyla tespit edilir (migration 105 açıklaması).
 * properties.ts'e dokunulmadı — tetikleme günlük cron'dadır (vitrin-alarm).
 */

type AdminClient = ReturnType<typeof createAdminClient>;

type PendingAlert = {
  id: string;
  tenant_id: string;
  property_id: string;
  name: string | null;
  phone: string;
  baseline_price: number | string;
};

export type VitrinAlertRunResult = {
  /** Taranan bekleyen alarm sayısı */
  pending: number;
  /** Ofise bildirim yazılan (fiyatı düşen) alarm sayısı */
  notified: number;
};

const fmt = (v: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(v);

export async function processVitrinPriceAlerts(admin: AdminClient): Promise<VitrinAlertRunResult> {
  const { data: alerts } = await admin
    .from("vitrin_price_alerts")
    .select("id, tenant_id, property_id, name, phone, baseline_price")
    .is("notified_at", null)
    .limit(1000);

  const pending = (alerts ?? []) as PendingAlert[];
  if (!pending.length) return { pending: 0, notified: 0 };

  // İlanları tek sorguda çek (N+1 yerine) — yalnız yayında + silinmemiş.
  const propertyIds = [...new Set(pending.map((a) => a.property_id))];
  const { data: props } = await admin
    .from("properties")
    .select("id, title, property_code, list_price, status, deleted_at")
    .in("id", propertyIds);

  const propMap = new Map(
    (props ?? []).map((p) => [p.id as string, p as { id: string; title: string | null; property_code: string; list_price: number | string | null; status: string; deleted_at: string | null }]),
  );

  let notified = 0;
  for (const alert of pending) {
    const prop = propMap.get(alert.property_id);
    if (!prop || prop.status !== "live" || prop.deleted_at != null) continue;
    const current = prop.list_price != null ? Number(prop.list_price) : null;
    const baseline = Number(alert.baseline_price);
    if (current == null || !Number.isFinite(baseline) || !(current < baseline)) continue;

    const label = prop.title || prop.property_code;
    const who = alert.name ? `${alert.name} adlı ziyaretçiyi` : "ziyaretçiyi";
    await notifyTenant({
      tenantId: alert.tenant_id,
      title: `Fiyat alarmı tetiklendi: ${label}`,
      body: `Fiyat ${fmt(baseline)} ₺ → ${fmt(current)} ₺ düştü — ${who} arayın: ${formatTurkishPhone(alert.phone)}`,
      href: `/app/portfoyler/${prop.id}`,
      kind: "success",
      prefKey: "priceDrop",
    });
    await admin
      .from("vitrin_price_alerts")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", alert.id);
    notified++;
  }

  return { pending: pending.length, notified };
}
