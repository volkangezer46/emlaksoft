"use server";

import { revalidatePath } from "next/cache";
import { isExpiredActive } from "@/lib/admin/platform-metrics";
import { cleanReason, extendPeriodEnd } from "@/lib/billing/admin-billing-fixes";
import { now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DÖNEMİ BİTMİŞ AMA AKTİF ABONELİK düzeltmeleri (dikkat kuyruğu → Ofis 360 > Yönetim). Kapı: "billing" modülü;
 * gerekçe zorunlu (≥10). Yalnız `status='active' AND current_period_end < şimdi AND pause_started_at IS NULL AND
 * cancel_at_period_end = false` aboneliğe uygulanır (isExpiredActive; otomatik adımla aynı aday). Güncelleme bu koşulu
 * TEKRARLAR (bu arada ödeme alıp dönemi uzayan, duraklatılan ya da iptal edilen abonelik ezilmez). Denetim izine önce/sonra yazılır.
 *  - Ödenmedi olarak işaretle → abonelik 'past_due' (ofis 'active' ise o da 'past_due'; tahsilat akışına girer).
 *  - Dönemi uzat → dönem sonu max(eski bitiş, şimdi) + N gün (1..90); durum 'active' kalır.
 */

export type SubscriptionFixResult = { ok?: boolean; error?: string; message?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SubRow = {
  id: string;
  tenant_id: string;
  status: string;
  current_period_end: string | null;
  pause_started_at: string | null;
  cancel_at_period_end: boolean | null;
};

async function loadExpired(admin: ReturnType<typeof createAdminClient>, tenantId: string, nowMs: number): Promise<SubRow | string> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, tenant_id, status, current_period_end, pause_started_at, cancel_at_period_end")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("current_period_end", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return "Abonelik okunamadı; sayfayı yenileyip tekrar deneyin.";
  const sub = data as SubRow | null;
  if (!sub || !isExpiredActive(sub, nowMs)) return "Bu ofisin dönemi bitmiş aktif aboneliği yok; sayfayı yenileyin.";
  return sub;
}

function revalidate(tenantId: string) {
  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/tenants");
  revalidatePath("/admin/billing");
  revalidatePath("/admin");
}

export async function markSubscriptionUnpaid(tenantId: string, reason: string): Promise<SubscriptionFixResult> {
  const staff = await requirePlatformModule("billing");
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) return { error: "Ofis bulunamadı." };
  const why = cleanReason(reason);
  if (!why) return { error: "Gerekçe yazın (en az 10 karakter)." };

  const admin = createAdminClient();
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const sub = await loadExpired(admin, tenantId, nowMs);
  if (typeof sub === "string") return { error: sub };

  const subUpd = await admin
    .from("subscriptions")
    .update({ status: "past_due", updated_at: nowIso })
    .eq("id", sub.id)
    .eq("status", "active")
    .lt("current_period_end", nowIso)
    .is("pause_started_at", null)
    .eq("cancel_at_period_end", false)
    .select("id");
  if (subUpd.error) return { error: "Abonelik güncellenemedi; değişiklik yapılmadı, tekrar deneyin." };
  if ((subUpd.data ?? []).length === 0) return { error: "Abonelik bu arada değişti; sayfayı yenileyin." };

  const { data: tenantRows } = await admin
    .from("tenants")
    .update({ status: "past_due", updated_at: nowIso })
    .eq("id", tenantId)
    .eq("status", "active")
    .select("id");
  const tenantChanged = (tenantRows ?? []).length > 0;

  await logPlatformActivity({
    actorId: staff.id,
    action: "subscription.mark_unpaid",
    entityType: "tenant",
    entityId: tenantId,
    meta: {
      subscription_id: sub.id,
      before: { status: "active", current_period_end: sub.current_period_end },
      after: { status: "past_due", current_period_end: sub.current_period_end, tenant_status: tenantChanged ? "past_due" : "değişmedi" },
      reason: why,
    },
  });
  revalidate(tenantId);
  return { ok: true, message: "Abonelik ödenmedi (gecikmiş) olarak işaretlendi." };
}

export async function extendSubscriptionPeriod(tenantId: string, days: number, reason: string): Promise<SubscriptionFixResult> {
  const staff = await requirePlatformModule("billing");
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) return { error: "Ofis bulunamadı." };
  const why = cleanReason(reason);
  if (!why) return { error: "Gerekçe yazın (en az 10 karakter)." };

  const admin = createAdminClient();
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const sub = await loadExpired(admin, tenantId, nowMs);
  if (typeof sub === "string") return { error: sub };
  const next = extendPeriodEnd(sub.current_period_end, Number(days), nowMs);
  if (!next.ok) return { error: next.error };

  const upd = await admin
    .from("subscriptions")
    .update({ current_period_end: next.endIso, updated_at: nowIso })
    .eq("id", sub.id)
    .eq("status", "active")
    .lt("current_period_end", nowIso)
    .is("pause_started_at", null)
    .eq("cancel_at_period_end", false)
    .select("id");
  if (upd.error) return { error: "Dönem uzatılamadı; değişiklik yapılmadı, tekrar deneyin." };
  if ((upd.data ?? []).length === 0) return { error: "Abonelik bu arada değişti; sayfayı yenileyin." };

  await logPlatformActivity({
    actorId: staff.id,
    action: "subscription.extend_period",
    entityType: "tenant",
    entityId: tenantId,
    meta: {
      subscription_id: sub.id,
      days: Number(days),
      before: { status: "active", current_period_end: sub.current_period_end },
      after: { status: "active", current_period_end: next.endIso },
      reason: why,
    },
  });
  revalidate(tenantId);
  const label = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" }).format(new Date(next.endIso));
  return { ok: true, message: `Dönem ${label} tarihine uzatıldı.` };
}
