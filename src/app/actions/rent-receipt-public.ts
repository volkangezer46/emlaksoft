"use server";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { verifyDocumentFile } from "@/lib/file-validation";
import {
  RENT_RECEIPT_BUCKET,
  RENT_RECEIPT_MAX_BYTES,
  RENT_RECEIPT_MIME,
  buildRentReceiptPath,
  isRentReceiptUuid,
  validateRentReceiptMeta,
} from "@/lib/rent-receipt";

/**
 * Kiracı "Ödedim" dekont fotoğrafı (oturumsuz, token'lı portal). service_role YALNIZ depolama imzası ve dekont meta yazımı için,
 * token + bildirim sahipliği `portal_rent_receipt_target` RPC'siyle (anon) doğrulandıktan SONRA kullanılır; ofis/müşteri/bildirim
 * kimliği istemciden alınmaz. Kova özel; yol ofis/kiracı/bildirim kimliğiyle; yalnız jpg/png/pdf, ≤5 MB; oran sınırı IP + token.
 */
export type RentReceiptPrepareResult =
  | { ok: true; upload: { bucket: typeof RENT_RECEIPT_BUCKET; path: string; token: string; contentType: string } }
  | { ok?: false; error: string };
export type RentReceiptFinalizeResult = { ok?: boolean; error?: string };

const BUSY = "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.";
const INVALID = "Bağlantı geçersiz veya bildirim bulunamadı.";
const TOKEN_RE = /^[0-9a-f]{32,128}$/;

type Target = { tenantId: string; customerId: string; noticeId: string; receiptStatus: string | null };

async function limited(token: string, kind: string): Promise<boolean> {
  const ip = await clientIp();
  const tokenHash = createHash("sha256").update(token).digest("hex").slice(0, 32);
  const [byIp, byToken] = await Promise.all([
    checkRateLimit(`rent-receipt:${kind}:ip:${ip}`, { limit: 20, windowSec: 10 * 60, failurePolicy: "deny" }),
    checkRateLimit(`rent-receipt:${kind}:token:${tokenHash}`, { limit: 10, windowSec: 10 * 60, failurePolicy: "deny" }),
  ]);
  return !byIp.allowed || !byToken.allowed;
}

/** Token + tahakkuk -> bu müşterinin bekleyen bildirimi (SQL içinde doğrulanır). */
async function resolveTarget(token: string, chargeId: string): Promise<Target | null> {
  const db = await createClient();
  const { data, error } = await db.rpc("portal_rent_receipt_target", { p_token: token, p_charge_id: chargeId });
  if (error) {
    console.error("rent-receipt target", { code: error.code });
    return null;
  }
  const r = data as { ok?: boolean; tenant_id?: string; customer_id?: string; notice_id?: string; receipt_status?: string | null } | null;
  if (!r?.ok || !isRentReceiptUuid(r.tenant_id) || !isRentReceiptUuid(r.customer_id) || !isRentReceiptUuid(r.notice_id)) return null;
  return { tenantId: r.tenant_id, customerId: r.customer_id, noticeId: r.notice_id, receiptStatus: r.receipt_status ?? null };
}

export async function prepareRentReceiptUpload(
  token: string,
  chargeId: string,
  input: { fileName: string; fileSize: number; fileType: string },
): Promise<RentReceiptPrepareResult> {
  if (typeof token !== "string" || !TOKEN_RE.test(token) || !isRentReceiptUuid(chargeId)) return { error: INVALID };
  if (await limited(token, "prepare")) return { error: BUSY };
  const meta = validateRentReceiptMeta({ fileName: input?.fileName, fileSize: input?.fileSize, fileType: input?.fileType });
  if (!meta.ok) return { error: meta.error };
  const target = await resolveTarget(token, chargeId);
  if (!target) return { error: INVALID };
  if (target.receiptStatus === "verified") return { error: "Bu bildirim için dekont zaten yüklendi." };

  const admin = createAdminClient();
  const path = buildRentReceiptPath(target.tenantId, target.customerId, target.noticeId, crypto.randomUUID(), meta.value.extension);
  const { data: updated, error: updateError } = await admin
    .from("rent_payment_notices")
    .update({
      receipt_path: path,
      receipt_name: meta.value.fileName,
      receipt_mime: meta.value.mime,
      receipt_size: meta.value.fileSize,
      receipt_status: "pending",
      receipt_prepared_at: new Date(now()).toISOString(),
    })
    .eq("id", target.noticeId)
    .eq("tenant_id", target.tenantId)
    .eq("customer_id", target.customerId)
    .eq("status", "pending")
    .neq("receipt_status", "verified")
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    if (updateError) console.error("rent-receipt prepare", { code: updateError.code });
    return { error: "Yükleme oturumu oluşturulamadı. Birkaç saniye sonra yeniden deneyin." };
  }
  const { data: signed, error: signError } = await admin.storage.from(RENT_RECEIPT_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (signError || !signed?.token || signed.path !== path) {
    console.error("rent-receipt sign", { code: signError?.name ?? null });
    await admin
      .from("rent_payment_notices")
      .update({ receipt_status: "blocked" })
      .eq("id", target.noticeId)
      .eq("tenant_id", target.tenantId)
      .eq("receipt_path", path);
    return { error: "Güvenli yükleme bağlantısı oluşturulamadı. Birkaç saniye sonra yeniden deneyin." };
  }
  return { ok: true, upload: { bucket: RENT_RECEIPT_BUCKET, path, token: signed.token, contentType: meta.value.mime } };
}

/** Yüklenen nesneyi bayt düzeyinde doğrular (imza, tür, boyut); geçemezse siler ve engeller. */
export async function finalizeRentReceiptUpload(token: string, chargeId: string): Promise<RentReceiptFinalizeResult> {
  if (typeof token !== "string" || !TOKEN_RE.test(token) || !isRentReceiptUuid(chargeId)) return { error: INVALID };
  if (await limited(token, "finalize")) return { error: BUSY };
  const target = await resolveTarget(token, chargeId);
  if (!target) return { error: INVALID };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("rent_payment_notices")
    .select("id, receipt_path, receipt_name, receipt_mime, receipt_size, receipt_status")
    .eq("id", target.noticeId)
    .eq("tenant_id", target.tenantId)
    .eq("customer_id", target.customerId)
    .maybeSingle();
  if (!row || !row.receipt_path) return { error: "Yükleme oturumu bulunamadı." };
  if (row.receipt_status === "verified") return { ok: true };
  if (row.receipt_status !== "pending") return { error: "Dosya güvenlik doğrulamasından geçemedi." };

  const path = String(row.receipt_path);
  const block = async () => {
    await admin
      .from("rent_payment_notices")
      .update({ receipt_status: "blocked" })
      .eq("id", row.id)
      .eq("tenant_id", target.tenantId)
      .eq("receipt_path", path);
    await admin.storage.from(RENT_RECEIPT_BUCKET).remove([path]);
  };
  const { data: blob, error: downloadError } = await admin.storage.from(RENT_RECEIPT_BUCKET).download(path);
  if (downloadError || !blob) return { error: "Yüklenen dosya henüz bulunamadı. Lütfen tekrar deneyin." };
  if (blob.size <= 0 || blob.size > RENT_RECEIPT_MAX_BYTES || blob.size !== Number(row.receipt_size)) {
    await block();
    return { error: "Yüklenen dosyanın boyutu beklenen değerle eşleşmiyor." };
  }
  const file = new File([blob], String(row.receipt_name), { type: String(row.receipt_mime) });
  const verified = await verifyDocumentFile(file, RENT_RECEIPT_MIME);
  if (!verified.ok || verified.type !== row.receipt_mime) {
    await block();
    return { error: verified.ok ? "Dosya içeriği ile bildirilen tür uyuşmuyor." : verified.error };
  }
  const { error: updateError } = await admin
    .from("rent_payment_notices")
    .update({ receipt_status: "verified" })
    .eq("id", row.id)
    .eq("tenant_id", target.tenantId)
    .eq("receipt_path", path)
    .eq("receipt_status", "pending");
  if (updateError) return { error: "Dekont doğrulandı ancak kaydedilemedi. Lütfen yeniden deneyin." };
  return { ok: true };
}
