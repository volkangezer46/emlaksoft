"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/base-url";
import { logActivity } from "@/lib/activity";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { isSignerSmsAvailable, sendSignerSms } from "@/app/imza/_lib/sms";

export type SignerResult = { ok?: boolean; error?: string; sms?: "sent" | "unavailable" | "failed" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * İmzalayan düzeltme: yalnız henüz imzalamamış (pending) imzalayanın ad, e-posta, telefonu
 * değişir. Link (token) aynı kalır; imza tamamlanmış ya da reddedilmiş kayıt değişmez.
 * Tenant doğrulaması sözleşme üzerinden yapılır (contract_signers'ta tenant_id yok).
 */
export async function updateContractSigner(_prev: SignerResult, fd: FormData): Promise<SignerResult> {
  const gate = await requirePermission("contracts", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(fd.get("signer_id") ?? "").trim();
  const fullName = String(fd.get("full_name") ?? "").trim();
  const emailRaw = String(fd.get("email") ?? "").trim();
  const phoneRaw = String(fd.get("phone") ?? "").trim();
  if (!UUID.test(id)) return { error: "İmzalayan bulunamadı." };
  if (!fullName || fullName.length > 160) return { error: "Geçerli bir ad soyad girin." };
  const email = emailRaw ? normalizeEmail(emailRaw) : "";
  if (email && !isValidEmail(email)) return { error: "E-posta adresi geçersiz." };
  let phone: string | null = null;
  if (phoneRaw) {
    const parsed = parsePhoneStrict(phoneRaw);
    if (!parsed.ok) return { error: "Telefon numarası geçersiz." };
    phone = parsed.stored;
  }

  const admin = createAdminClient();
  const { data: signer } = await admin
    .from("contract_signers")
    .select("id, status, contract_id")
    .eq("id", id)
    .maybeSingle();
  const { data: contract } = signer
    ? await admin.from("contracts").select("id").eq("id", signer.contract_id as string).eq("tenant_id", gate.tenantId).maybeSingle()
    : { data: null };
  if (!signer || !contract) return { error: "İmzalayan bulunamadı." };
  if (signer.status !== "pending") return { error: "Yalnız imza bekleyen kişi düzenlenebilir." };

  const { error } = await admin
    .from("contract_signers")
    .update({ full_name: fullName, email: email || null, phone })
    .eq("id", id)
    .eq("status", "pending");
  if (error) {
    console.error("updateContractSigner", { code: error.code || "unknown" });
    return { error: "İmzalayan güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "contract.signer_update",
    entityType: "contract",
    entityId: signer.contract_id as string,
    newValue: { signer_id: id },
  });
  revalidatePath(`/app/sozlesmeler/${signer.contract_id as string}`);
  return { ok: true };
}

/** İmza linkini SMS ile yeniden gönderir (ofisin Netgsm hesabı; hız sınırlı). */
export async function resendSignerSms(signerId: string): Promise<SignerResult> {
  const gate = await requirePermission("contracts", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID.test(signerId)) return { error: "İmzalayan bulunamadı." };

  const { allowed } = await checkRateLimit(`imza-sms-tekrar:${gate.tenantId}:${signerId}`, {
    limit: 3,
    windowSec: 600,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok sık denendi. Birkaç dakika sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: signer } = await admin
    .from("contract_signers")
    .select("id, full_name, phone, token, status, contract_id")
    .eq("id", signerId)
    .maybeSingle();
  const { data: contract } = signer
    ? await admin.from("contracts").select("id, title").eq("id", signer.contract_id as string).eq("tenant_id", gate.tenantId).maybeSingle()
    : { data: null };
  if (!signer || !contract) return { error: "İmzalayan bulunamadı." };
  if (signer.status !== "pending") return { error: "Bu kişi zaten işlem yapmış." };
  if (!signer.phone) return { error: "İmzalayanın telefonu yok; önce telefonu ekleyin." };
  if (!(await isSignerSmsAvailable(gate.tenantId, signer.phone as string))) {
    return { ok: true, sms: "unavailable" };
  }

  const link = `${getBaseUrl()}/imza/${signer.token as string}`;
  const text = `Sayin ${signer.full_name as string}, "${(contract?.title as string) ?? "Sozlesme"}" sozlesmesini imzalamak icin: ${link}`;
  const result = await sendSignerSms(gate.tenantId, signer.phone as string, text);
  if (!result.ok) {
    console.error("resendSignerSms", { code: result.code ?? "provider_error" });
    return { error: "SMS gönderilemedi. Linki kopyalayıp elle iletebilirsiniz.", sms: "failed" };
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "contract.signer_sms_resend",
    entityType: "contract",
    entityId: signer.contract_id as string,
    newValue: { signer_id: signerId },
  });
  return { ok: true, sms: "sent" };
}
