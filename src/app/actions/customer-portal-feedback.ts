"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { notifyTenant } from "@/lib/notify";

export type MatchFeedbackVerdict = "liked" | "disliked";

export type MatchFeedbackResult = {
  ok?: boolean;
  error?: string;
  verdict?: MatchFeedbackVerdict;
};

/**
 * Müşteri portalından portföy geri bildirimi (Beğendim / İlgilenmiyorum) —
 * token'ı formdan alır, auth gerekmez (token yeterli; submitSignatureByToken
 * deseni). Token, getCustomerPortalData ile aynı şekilde çözülür; kayıt
 * portal_match_feedback tablosuna upsert edilir (müşteri fikrini
 * değiştirebilir) ve danışmana bildirim düşer.
 */
export async function submitMatchFeedbackByToken(
  fd: FormData,
): Promise<MatchFeedbackResult> {
  const token      = String(fd.get("token") ?? "").trim();
  const propertyId = String(fd.get("property_id") ?? "").trim();
  const verdictRaw = String(fd.get("verdict") ?? "").trim();

  if (!token || !propertyId) return { error: "Geçersiz istek." };
  if (verdictRaw !== "liked" && verdictRaw !== "disliked") {
    return { error: "Geçersiz seçim." };
  }
  const verdict = verdictRaw as MatchFeedbackVerdict;

  // Token tahmini / spam koruması — IP başına dakikada 30 istek
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    "unknown";
  const { allowed } = await checkRateLimit(`portalfeedback:${ip}`, { limit: 30, windowSec: 60 });
  if (!allowed) return { error: "Çok fazla istek. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();

  // Token geçerli mi? (getCustomerPortalData ile aynı çözümleme)
  const { data: portalToken } = await admin
    .from("customer_portal_tokens")
    .select("customer_id, tenant_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!portalToken) return { error: "Bağlantı geçersiz veya süresi dolmuş." };
  if (new Date(portalToken.expires_at) < new Date()) {
    return { error: "Bağlantı geçersiz veya süresi dolmuş." };
  }

  const customerId = portalToken.customer_id;
  const tenantId   = portalToken.tenant_id;

  const [{ data: customer }, { data: property }, { data: existing }] = await Promise.all([
    admin
      .from("customers")
      .select("id, full_name, assigned_to")
      .eq("id", customerId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("properties")
      .select("id, property_code, title, assigned_to")
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("portal_match_feedback")
      .select("id, verdict")
      .eq("customer_id", customerId)
      .eq("property_id", propertyId)
      .maybeSingle(),
  ]);

  if (!customer) return { error: "Bağlantı geçersiz veya süresi dolmuş." };
  if (!property) return { error: "Portföy bulunamadı." };

  // Aynı seçim tekrar gönderildiyse iş yok (bildirim spam'i de önlenir)
  if (existing?.verdict === verdict) return { ok: true, verdict };

  const { error } = await admin
    .from("portal_match_feedback")
    .upsert(
      {
        tenant_id:   tenantId,
        customer_id: customerId,
        property_id: propertyId,
        verdict,
        updated_at:  new Date().toISOString(),
      },
      { onConflict: "customer_id,property_id" },
    );

  if (error) {
    console.error("submitMatchFeedbackByToken upsert", error);
    return { error: "Geri bildirim kaydedilemedi. Lütfen tekrar deneyin." };
  }

  // Danışmana bildirim — müşterinin danışmanı öncelikli, yoksa portföyünki
  const propLabel = property.title ?? property.property_code;
  await notifyTenant({
    tenantId,
    userId: customer.assigned_to ?? property.assigned_to ?? undefined,
    title:  verdict === "liked" ? "Müşteri portföyü beğendi" : "Müşteri portföyle ilgilenmiyor",
    body:
      verdict === "liked"
        ? `${customer.full_name}, ${propLabel} portföyünü beğendi.`
        : `${customer.full_name}, ${propLabel} portföyü ile ilgilenmiyor.`,
    href: `/app/musteriler/${customerId}`,
    kind: verdict === "liked" ? "success" : "info",
  });

  revalidatePath(`/musteri-portali/${token}`);
  return { ok: true, verdict };
}
