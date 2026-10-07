"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { getBaseUrl } from "@/lib/base-url";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSignerSmsAvailable, sendSignerSms } from "@/app/imza/_lib/sms";
import { isTenantSmsAvailable } from "@/lib/messaging/tenant-providers";

/**
 * İmzalamayana SUNUCUDAN SMS hatırlatması (20261007000720). İmzacı token'ı okunmaz: oturumlu istemci
 * `contract_signer_reminder_payload` RPC'sini çağırır (ofis + contracts:edit + 10 dk fren SQL'de), dönen KISA kodla
 * `/imza/k/<kod>` bağlantısı SMS'e konur. Yeni service_role kullanımı YOK.
 * `fallback: true` dönerse istemci bugünkü WhatsApp/kopyala yoluna düşer (SMS yapılandırılmamış, RPC yok, TR cep değil).
 */
export type SignerReminderResult = { ok?: boolean; error?: string; fallback?: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CODE_MESSAGE: Record<string, string> = {
  not_found: "Sözleşme veya imzacı bulunamadı.",
  invalid_state: "Yalnız imzaya gönderilmiş sözleşmelerde hatırlatma yapılabilir.",
  expired: "Sözleşmenin geçerlilik süresi dolmuş.",
  not_pending: "Bu kişi zaten imzaladı veya reddetti.",
  throttled: "Bu kişiye son 10 dakikada hatırlatma gönderildi; biraz sonra tekrar deneyin.",
  limit: "Bu kişiye en fazla 10 hatırlatma gönderilebilir.",
  forbidden: "Bu işlem için yetkiniz yok.",
  unauthorized: "Oturumunuz doğrulanamadı; sayfayı yenileyip yeniden giriş yapın.",
};

export async function remindContractSignerBySms(contractId: string, signerId: string): Promise<SignerReminderResult> {
  const gate = await requirePermission("contracts", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!UUID_RE.test(String(contractId ?? "")) || !UUID_RE.test(String(signerId ?? ""))) return { error: "İmzacı bulunamadı." };
  if (!(await isTenantSmsAvailable(gate.tenantId))) return { fallback: true };
  const rate = await checkRateLimit(`contract-remind:${gate.tenantId}:${gate.userId}`, { limit: 30, windowSec: 60 * 60, failurePolicy: "deny" });
  if (!rate.allowed) return { error: "Çok fazla hatırlatma gönderildi. Lütfen daha sonra tekrar deneyin." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contract_signer_reminder_payload", {
    p_contract_id: contractId,
    p_signer_id: signerId,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { fallback: true };
    console.error("remindContractSignerBySms rpc", { code: error.code });
    return { error: "Hatırlatma şu an hazırlanamadı; birkaç dakika sonra yeniden deneyin ya da WhatsApp ile iletin." };
  }
  const res = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!res || res.ok !== true) {
    const code = String(res?.code ?? "");
    if (code === "no_phone") return { fallback: true };
    return { error: CODE_MESSAGE[code] ?? "Hatırlatma gönderilemedi; imzacının durumunu kontrol edip WhatsApp veya bağlantıyı kopyala ile iletin." };
  }
  const phone = typeof res.phone === "string" ? res.phone : "";
  const shortCode = typeof res.short_code === "string" ? res.short_code : "";
  if (!/^[0-9a-f]{16}$/.test(shortCode)) return { error: "Kısa imza bağlantısı üretilemedi; bağlantıyı kopyala düğmesiyle tam bağlantıyı iletin." };
  if (!(await isSignerSmsAvailable(gate.tenantId, phone))) return { fallback: true };

  const link = `${getBaseUrl()}/imza/k/${shortCode}`;
  const name = String(res.full_name ?? "").slice(0, 80);
  const title = String(res.contract_title ?? "Sözleşme").slice(0, 80);
  const text = `Sayin ${name}, "${title}" sozlesmesi imzanizi bekliyor: ${link}`;
  const sent = await sendSignerSms(gate.tenantId, phone, text);
  if (!sent.ok) {
    console.error("remindContractSignerBySms sms", { code: sent.code ?? "provider_error" });
    return { error: "SMS gönderilemedi; WhatsApp veya bağlantıyı kopyala ile iletebilirsiniz." };
  }
  return { ok: true };
}
