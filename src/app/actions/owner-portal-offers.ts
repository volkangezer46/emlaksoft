"use server";

import { revalidatePath } from "next/cache";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionErrorMessage } from "@/lib/action-errors";

export type OwnerOfferResponseResult = { ok?: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Malik yanıtı, audit ve bildirim niyeti aynı veritabanı transaction'ında
 * oluşur. RPC'nin authoritative sonucu dışında stale ön okuma kullanılmaz.
 */
export async function respondToOfferByToken(
  fd: FormData,
): Promise<OwnerOfferResponseResult> {
  const token = String(fd.get("token") ?? "").trim();
  const offerId = String(fd.get("offer_id") ?? "").trim();
  const decision = String(fd.get("decision") ?? "").trim();

  if (!token || token.length > 256 || !UUID_RE.test(offerId)) {
    return { error: "Geçersiz istek." };
  }
  if (decision !== "accepted" && decision !== "rejected") {
    return { error: "Geçersiz işlem." };
  }

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`ownerofferresp:${ip}`, {
    limit: 10,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: transitionData, error: transitionError } = await admin.rpc(
    "respond_owner_offer_atomic",
    {
      p_token: token,
      p_offer_id: offerId,
      p_decision: decision,
    },
  );
  if (transitionError) {
    console.error("respondToOfferByToken atomic transition", { code: transitionError.code });
    return { error: actionErrorMessage(transitionError, "İşlem kaydedilemedi. Lütfen tekrar deneyin.") };
  }

  const transition = transitionData && typeof transitionData === "object" && !Array.isArray(transitionData)
    ? transitionData as Record<string, unknown>
    : null;
  const outcome = typeof transition?.outcome === "string" ? transition.outcome : "invalid_result";
  if (outcome === "already_finalized") {
    return { error: "Bu teklif zaten sonuçlandırılmış." };
  }
  if (outcome === "invalid_link") {
    return { error: "Bağlantı geçersiz veya süresi dolmuş." };
  }
  if (outcome === "offer_not_found") return { error: "Teklif bulunamadı." };
  if (outcome !== "applied" && outcome !== "replay") {
    return { error: actionErrorMessage(null, "İşlem kaydedilemedi. Lütfen tekrar deneyin.") };
  }

  revalidatePath(`/malik-portali/${token}`);
  return { ok: true };
}
