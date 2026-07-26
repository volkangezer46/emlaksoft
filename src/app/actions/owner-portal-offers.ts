"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";

export type OwnerOfferResponseResult = { ok?: boolean; error?: string };

/**
 * Malik portalından teklif yanıtı — token'ı formdan alır, auth gerekmez
 * (token yeterli; submitSignatureByToken deseni). Token, getOwnerPortalData
 * ile aynı şekilde çözülür; teklif yalnızca "submitted" durumundaysa
 * kabul/ret edilebilir. İşlem audit_logs'a düşer.
 */
export async function respondToOfferByToken(
  fd: FormData,
): Promise<OwnerOfferResponseResult> {
  const token    = String(fd.get("token") ?? "").trim();
  const offerId  = String(fd.get("offer_id") ?? "").trim();
  const decision = String(fd.get("decision") ?? "").trim();

  if (!token || !offerId) return { error: "Geçersiz istek." };
  if (decision !== "accepted" && decision !== "rejected") {
    return { error: "Geçersiz işlem." };
  }

  // Token tahmini / kaba kuvvet koruması — IP başına dakikada 10 deneme
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    "unknown";
  const { allowed } = await checkRateLimit(`ownerofferresp:${ip}`, { limit: 10, windowSec: 60 });
  if (!allowed) return { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();

  // Token geçerli mi? (getOwnerPortalData ile aynı çözümleme)
  const { data: portalToken } = await admin
    .from("owner_portal_tokens")
    .select("property_id, tenant_id, owner_name, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!portalToken) return { error: "Bağlantı geçersiz veya süresi dolmuş." };
  if (new Date(portalToken.expires_at) < new Date()) {
    return { error: "Bağlantı geçersiz veya süresi dolmuş." };
  }

  // Teklif bu portföye/kiracıya ait ve hâlâ değerlendirmede mi?
  const { data: offer } = await admin
    .from("offers")
    .select("id, status, amount")
    .eq("id", offerId)
    .eq("property_id", portalToken.property_id)
    .eq("tenant_id", portalToken.tenant_id)
    .maybeSingle();

  if (!offer) return { error: "Teklif bulunamadı." };
  if (offer.status !== "submitted") return { error: "Bu teklif zaten sonuçlandırılmış." };

  const now = new Date().toISOString();
  const { error } = await admin
    .from("offers")
    .update({ status: decision, responded_at: now, updated_at: now })
    .eq("id", offerId)
    .eq("tenant_id", portalToken.tenant_id)
    .eq("status", "submitted"); // yarış koşulu: bu arada sonuçlandıysa dokunma

  if (error) return { error: "İşlem kaydedilemedi. Lütfen tekrar deneyin." };

  // Denetim izi — panel kullanıcısı değil malik yaptı (actor yok, kaynak belli)
  await logActivity({
    tenantId:   portalToken.tenant_id,
    actorId:    null,
    action:     decision === "accepted" ? "offer.owner_accept" : "offer.owner_reject",
    entityType: "offer",
    entityId:   offerId,
    oldValue:   { status: "submitted" },
    newValue:   {
      status:     decision,
      amount:     Number(offer.amount),
      source:     "owner_portal",
      owner_name: portalToken.owner_name,
    },
  });

  revalidatePath(`/malik-portali/${token}`);
  return { ok: true };
}
