"use server";

import { revalidatePath } from "next/cache";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionErrorMessage } from "@/lib/action-errors";
import { parseMoneyInput } from "@/lib/money-input";

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

/**
 * Malik portalından karşı teklif (SP2). Teklif DURUMU DEĞİŞMEZ ve alıcıya otomatik gitmez: tutar + not teklife
 * "malik karşı teklifi" olarak yazılır, danışmana bildirim düşer; danışman isterse pazarlık turu olarak iletir.
 * Token doğrulama, durum/geçerlilik kontrolü, yazım ve bildirim niyeti tek RPC transaction'ındadır.
 */
export async function counterOfferByToken(
  fd: FormData,
): Promise<OwnerOfferResponseResult> {
  const token = String(fd.get("token") ?? "").trim();
  const offerId = String(fd.get("offer_id") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim() || null;
  if (!token || token.length > 256 || !UUID_RE.test(offerId)) {
    return { error: "Geçersiz istek." };
  }
  const amount = parseMoneyInput(fd.get("amount"), { max: 100_000_000_000 });
  if (!amount.ok || amount.value == null || amount.value < 1) return { error: "Geçerli bir karşı teklif tutarı girin." };
  if (note && note.length > 1000) return { error: "Not en fazla 1000 karakter olabilir." };

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`ownerofferresp:${ip}`, {
    limit: 10,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("owner_counter_offer_atomic", {
    p_token: token,
    p_offer_id: offerId,
    p_amount: amount.value,
    p_note: note,
  });
  if (error) {
    console.error("counterOfferByToken atomic", { code: error.code });
    if (error.code === "PGRST202" || error.code === "42883") {
      return { error: "Karşı teklif bu ortamda henüz etkin değil. Lütfen danışmanınızı arayın." };
    }
    return { error: actionErrorMessage(error, "Karşı teklif kaydedilemedi. Lütfen tekrar deneyin.") };
  }
  const outcome = String((data as { outcome?: string } | null)?.outcome ?? "invalid_result");
  if (outcome === "already_finalized") return { error: "Bu teklif zaten sonuçlandırılmış." };
  if (outcome === "expired") return { error: "Teklifin geçerlilik süresi dolmuş; danışmanınızla görüşün." };
  if (outcome === "invalid_link") return { error: "Bağlantı geçersiz veya süresi dolmuş." };
  if (outcome === "offer_not_found") return { error: "Teklif bulunamadı." };
  if (outcome === "invalid_input") return { error: "Geçerli bir karşı teklif tutarı girin." };
  if (outcome !== "applied" && outcome !== "replay") {
    return { error: actionErrorMessage(null, "Karşı teklif kaydedilemedi. Lütfen tekrar deneyin.") };
  }

  revalidatePath(`/malik-portali/${token}`);
  revalidatePath(`/app/teklifler/${offerId}`);
  return { ok: true };
}
