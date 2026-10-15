"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { notifyTenant } from "@/lib/notify";
import { buildDedupeKey } from "@/lib/notify-dedupe";
import { opaqueRateLimitPart } from "@/lib/public-request-security";
import { logActivity } from "@/lib/activity";
import { now, trDayKey } from "@/lib/clock";
import { PORTAL_TOKEN_RE, loadExpiredPortalLink, type PortalLinkKind } from "@/lib/portal-link-renew";

export type PortalLinkRenewResult = { ok?: boolean; error?: string };

/** Yanıt token geçerliliğini ele vermez: bilinmeyen token da aynı "iletildi" yanıtını alır (sayım/enumeration yok). */
const SENT: PortalLinkRenewResult = { ok: true };

/**
 * Süresi dolmuş portal bağlantısı için "yeni bağlantı iste" (PUB-7). Oturum YOK (token akışı). Hız sınırı: IP başına
 * 5/saat, token başına günde 1 (ikisi de altyapı hatasında KAPALI). Kayıtlı + süresi geçmiş token'da atanan danışmana
 * (yoksa bağlantıyı oluşturana) görev + bildirim düşer; bildirim günde bir kez (dedupe). Yanıtta kişisel veri yoktur.
 */
export async function requestPortalLinkRenewal(kind: PortalLinkKind, token: string): Promise<PortalLinkRenewResult> {
  if (kind !== "customer" && kind !== "owner") return { error: "Geçersiz istek." };
  const t = String(token ?? "").trim().toLowerCase();
  const ip = await clientIp();
  const byIp = await checkRateLimit(`portal-renew:ip:${ip}`, { limit: 5, windowSec: 3600, failurePolicy: "deny" });
  if (!byIp.allowed) return { error: "Çok fazla deneme yapıldı. Lütfen bir süre sonra tekrar deneyin." };
  if (!PORTAL_TOKEN_RE.test(t)) return SENT;
  const byToken = await checkRateLimit(`portal-renew:token:${kind}:${t}`, { limit: 1, windowSec: 86_400, failurePolicy: "deny" });
  if (!byToken.allowed) return SENT;

  const nowMs = now();
  const link = await loadExpiredPortalLink(kind, t, nowMs);
  if (!link || !link.advisorId) return SENT;

  const admin = createAdminClient();
  const subject = kind === "customer" ? "Müşteri paneli" : "Malik paneli";
  const { data: task } = await admin
    .from("tasks")
    .insert({
      tenant_id: link.tenantId,
      title: `${subject} bağlantısı yenileme talebi`,
      notes: "Bağlantının süresi dolmuş; kişi yeni bağlantı istedi. Kayıttan yeni portal bağlantısı oluşturup iletin.",
      kind: "followup",
      priority: "high",
      status: "open",
      due_at: new Date(nowMs).toISOString(),
      assigned_to: link.advisorId,
      customer_id: link.customerId,
      property_id: link.propertyId,
    })
    .select("id")
    .maybeSingle();

  try {
    await notifyTenant({
      tenantId: link.tenantId,
      userId: link.advisorId,
      title: `${subject} bağlantısı için yenileme istendi`,
      body: "Süresi dolan bağlantıya giren kişi yeni bağlantı istedi.",
      href: task?.id ? `/app/gorevler?gorev=${task.id}` : link.customerId ? `/app/musteriler/${link.customerId}` : `/app/portfoyler/${link.propertyId}`,
      kind: "warning",
      dedupeKey: buildDedupeKey("portal-renew", kind, opaqueRateLimitPart(t), trDayKey(nowMs)),
    });
  } catch (e) {
    // Görev yazıldıysa talep kaybolmaz; bildirim hatası ziyaretçiye yansıtılmaz.
    console.error("requestPortalLinkRenewal notify", e instanceof Error ? e.message : String(e));
  }
  await logActivity({
    tenantId: link.tenantId,
    actorId: null,
    action: "portal.link_renewal_requested",
    entityType: kind === "customer" ? "customer" : "property",
    entityId: (kind === "customer" ? link.customerId : link.propertyId) ?? undefined,
    newValue: { kind, task_id: task?.id ?? null },
  });
  return SENT;
}
