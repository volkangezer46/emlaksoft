"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, type PermissionGate } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { isIyzicoConfigured } from "@/lib/billing/iyzico";
import { removeStoredCard, setDefaultStoredCard, writeAutoRenewConsent } from "@/lib/billing/card-store";
import { createClient } from "@/lib/supabase/server";

/**
 * Kayıtlı kart yönetimi. Kart verisi bu action'lara GELMEZ: yalnız kartın kendi kimliği (uuid) gelir; ekleme zaten
 * iyzico ödeme sayfasında rıza ile yapılır (startPlanCheckout `save_card`). Yetki: billing:edit + yalnız owner/gm.
 */

export type CardActionResult = { ok: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gateManager(): Promise<{ ok: true; gate: Extract<PermissionGate, { ok: true }> } | { ok: false; error: string }> {
  const gate = await requirePermission("billing", "edit");
  if (!gate.ok) return { ok: false, error: gate.error };
  if (gate.impersonating) return { ok: false, error: "Destek oturumunda kart işlemi yapılamaz." };
  if (gate.role !== "owner" && gate.role !== "gm") {
    return { ok: false, error: "Kayıtlı kartları yalnızca ofis sahibi veya genel müdür yönetebilir." };
  }
  const { allowed } = await checkRateLimit(`cardmgmt:${gate.userId}`, { limit: 20, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { ok: false, error: "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin." };
  return { ok: true, gate };
}

export async function removePaymentCard(cardId: string): Promise<CardActionResult> {
  const g = await gateManager();
  if (!g.ok) return { ok: false, error: g.error };
  if (!UUID_RE.test(cardId)) return { ok: false, error: "Geçersiz kart." };
  if (!isIyzicoConfigured()) return { ok: false, error: "Ödeme altyapısı yapılandırılmamış." };

  const res = await removeStoredCard(await createClient(), { cardId });
  if (!res.ok) return { ok: false, error: res.error };
  await logActivity({
    tenantId: g.gate.tenantId,
    actorId: g.gate.userId,
    action: "billing.card.removed",
    entityType: "payment_card",
    entityId: cardId,
  });
  revalidatePath("/app/abonelik");
  return { ok: true };
}

export async function setDefaultPaymentCard(cardId: string): Promise<CardActionResult> {
  const g = await gateManager();
  if (!g.ok) return { ok: false, error: g.error };
  if (!UUID_RE.test(cardId)) return { ok: false, error: "Geçersiz kart." };

  const done = await setDefaultStoredCard(await createClient(), { cardId });
  if (!done) return { ok: false, error: "Varsayılan kart değiştirilemedi." };
  await logActivity({
    tenantId: g.gate.tenantId,
    actorId: g.gate.userId,
    action: "billing.card.default_set",
    entityType: "payment_card",
    entityId: cardId,
  });
  revalidatePath("/app/abonelik");
  return { ok: true };
}

/**
 * Otomatik yenileme rızası (açma/kapama). Kayıt HER ZAMAN yazılır (rıza kaydı); tahsilat ise ayrıca platform
 * bayrağı `billing.auto_renew_enabled` AÇIK olmadan yapılmaz. Bayrak kapalıyken ekran rızayı almayı göstermez.
 */
export async function setAutoRenewConsent(input: { enabled: boolean; cardId?: string }): Promise<CardActionResult> {
  const g = await gateManager();
  if (!g.ok) return { ok: false, error: g.error };
  const cardId = input.cardId ?? null;
  if (input.enabled && (!cardId || !UUID_RE.test(cardId))) return { ok: false, error: "Kart seçin." };

  const res = await writeAutoRenewConsent(await createClient(), {
    enabled: input.enabled,
    cardId,
    ip: await clientIp(),
  });
  if (!res.ok) return { ok: false, error: res.error };
  await logActivity({
    tenantId: g.gate.tenantId,
    actorId: g.gate.userId,
    action: input.enabled ? "billing.auto_renew.enabled" : "billing.auto_renew.disabled",
    entityType: "payment_card",
    entityId: cardId,
  });
  revalidatePath("/app/abonelik");
  return { ok: true };
}
