"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/require-permission";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isDemoLoginEnabled } from "@/lib/demo-environment";
import { getTenantNetgsmConfig, sendTenantSms } from "@/lib/messaging/tenant-providers";
import { canonicalizeNetgsmReceiver } from "@/lib/webhooks/netgsm-contract";
import {
  canonicalizeMetaNumericId,
  isAllowedWhatsAppGraphVersion,
  isValidWhatsAppAccessToken,
} from "@/lib/messaging/whatsapp-contract";
import {
  verifyTenantWhatsAppBinding,
  type WhatsAppBindingVerificationFailure,
} from "@/lib/messaging/whatsapp-cloud";

export type TenantIntegrationResult = { ok?: boolean; error?: string };

type NetgsmCredentials = { usercode?: string; password?: string; msgheader?: string };

function whatsappVerificationError(reason: WhatsAppBindingVerificationFailure): string {
  if (reason === "missing_token") return "WhatsApp erişim anahtarı eksik veya geçersiz.";
  if (reason === "authentication_failed") return "Meta erişim anahtarı reddedildi veya gerekli izinlere sahip değil.";
  if (reason === "ownership_mismatch") return "Telefon numarası kimliği seçilen WhatsApp Business hesabına ait değil.";
  if (reason === "phone_not_verified") return "Meta telefon numarası henüz doğrulanmış durumda değil.";
  if (reason === "provider_unavailable") return "Meta doğrulama servisine ulaşılamadı; bağlantı güvenlik için kapalı tutuldu.";
  return "Meta bağlantı doğrulama yanıtı geçersiz; bağlantı etkinleştirilmedi.";
}

/**
 * Stores Netgsm credentials behind the service-role secret boundary. The
 * subscriber number is non-secret routing metadata and is mandatory for exact
 * inbound SMS tenant resolution.
 */
export async function saveNetgsmCredentials(
  _prev: TenantIntegrationResult,
  fd: FormData,
): Promise<TenantIntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const usercodeInput = String(fd.get("usercode") ?? "").trim();
  const password = String(fd.get("password") ?? "").trim();
  const msgheaderInput = String(fd.get("msgheader") ?? "").trim();
  const inboundReceiver = canonicalizeNetgsmReceiver(
    String(fd.get("inbound_receiver") ?? ""),
  );

  if (!usercodeInput || usercodeInput.length > 80) return { error: "Kullanıcı kodu zorunludur." };
  if (!msgheaderInput || msgheaderInput.length > 80) return { error: "Onaylı gönderici adı zorunludur." };
  if (inboundReceiver.length < 4 || inboundReceiver.length > 20) {
    return { error: "Gelen SMS abone numarası 4-20 rakam olmalıdır." };
  }
  if (password.length > 256) return { error: "API şifresi çok uzun." };

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("tenant_integrations")
    .select("id, credentials")
    .eq("tenant_id", gate.tenantId)
    .eq("provider", "netgsm")
    .maybeSingle();
  if (existingError) {
    console.error("saveNetgsmCredentials integration read", { code: existingError.code });
    return { error: "Entegrasyon kaydı okunamadı." };
  }

  let previousCredentials: NetgsmCredentials = {};
  if (existing?.id) {
    const { data: secret, error: secretError } = await admin
      .from("tenant_integration_secrets")
      .select("credentials")
      .eq("integration_id", existing.id)
      .maybeSingle();
    if (secretError) {
      console.error("saveNetgsmCredentials secret read", { code: secretError.code });
      return { error: "Kayıtlı entegrasyon sırrı okunamadı." };
    }
    previousCredentials = (secret?.credentials ?? {}) as NetgsmCredentials;
  }

  const maskedCredentials = (existing?.credentials ?? {}) as NetgsmCredentials;
  const usercode = usercodeInput === maskedCredentials.usercode
    ? previousCredentials.usercode ?? ""
    : usercodeInput;
  const msgheader = msgheaderInput === maskedCredentials.msgheader
    ? previousCredentials.msgheader ?? ""
    : msgheaderInput;
  const nextPassword = password || previousCredentials.password || "";
  if (!usercode || !msgheader) return { error: "Kayıtlı Netgsm bilgileri okunamadı; alanları yeniden girin." };
  if (!nextPassword) return { error: "API şifresi zorunludur." };

  const { error } = await admin.rpc("upsert_tenant_integration_secret", {
    p_tenant_id: gate.tenantId,
    p_provider: "netgsm",
    p_credentials: { usercode, password: nextPassword, msgheader },
    p_actor_id: gate.userId,
    p_external_account_id: inboundReceiver,
  });
  if (error) {
    console.error("saveNetgsmCredentials", { code: error.code });
    return error.code === "23505"
      ? { error: "Bu gelen SMS abone numarası başka bir aktif ofise bağlı." }
      : { error: "Netgsm entegrasyonu kaydedilemedi." };
  }

  revalidatePath("/app/ayarlar");
  return { ok: true };
}

/** Deletes metadata and service-only credentials atomically. */
export async function clearNetgsmCredentials(): Promise<TenantIntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { error } = await admin.rpc("delete_tenant_integration_secret", {
    p_tenant_id: gate.tenantId,
    p_provider: "netgsm",
    p_actor_id: gate.userId,
  });
  if (error) {
    console.error("clearNetgsmCredentials", { code: error.code });
    return { error: "Netgsm hesabı kaldırılamadı." };
  }

  revalidatePath("/app/ayarlar");
  return { ok: true };
}

/**
 * Provisions one tenant-owned WhatsApp Cloud API route. Public account IDs are
 * stored as routing metadata; the bearer token is written only by the
 * service-role RPC into tenant_integration_secrets.
 */
export async function saveWhatsAppCredentials(
  _prev: TenantIntegrationResult,
  fd: FormData,
): Promise<TenantIntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const phoneNumberId = canonicalizeMetaNumericId(fd.get("phone_number_id"));
  const whatsappBusinessAccountId = canonicalizeMetaNumericId(fd.get("waba_id"));
  const graphApiVersion = String(fd.get("graph_api_version") ?? "").trim();
  const accessToken = String(fd.get("access_token") ?? "").trim();

  if (!phoneNumberId) {
    return { error: "Telefon numarası kimliği 5-32 rakam olmalıdır." };
  }
  if (!whatsappBusinessAccountId) {
    return { error: "WhatsApp Business hesabı kimliği 5-32 rakam olmalıdır." };
  }
  if (!isAllowedWhatsAppGraphVersion(graphApiVersion)) {
    return { error: "Desteklenen bir Meta Graph API sürümü seçin." };
  }
  if (accessToken && !isValidWhatsAppAccessToken(accessToken)) {
    return { error: "Erişim anahtarı geçersiz veya desteklenen sınırın dışında." };
  }

  const admin = createAdminClient();
  const verification = await verifyTenantWhatsAppBinding({
    tenantId: gate.tenantId,
    phoneNumberId,
    wabaId: whatsappBusinessAccountId,
    graphApiVersion,
    accessToken: accessToken || null,
  });
  if (!verification.ok) {
    const { error: deactivateError } = await admin.rpc(
      "fail_tenant_whatsapp_binding_verification",
      {
        p_tenant_id: gate.tenantId,
        p_actor_id: gate.userId,
        p_reason: verification.reason,
      },
    );
    if (deactivateError) {
      console.error("failWhatsAppBindingVerification", { code: deactivateError.code });
    }
    revalidatePath("/app/ayarlar");
    return { error: whatsappVerificationError(verification.reason) };
  }

  const binding = verification.binding;
  const { error } = await admin.rpc("activate_verified_tenant_whatsapp_binding", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_phone_number_id: binding.phoneNumberId,
    p_whatsapp_business_account_id: binding.wabaId,
    p_graph_api_version: binding.graphApiVersion,
    p_access_token: binding.accessToken,
    p_verified_phone_number_id: binding.phoneNumberId,
    p_verified_waba_id: binding.wabaId,
    p_code_verification_status: binding.codeVerificationStatus,
    p_verified_name: binding.verifiedName,
    p_display_phone_number: binding.displayPhoneNumber,
    p_quality_rating: binding.qualityRating,
  });
  if (error) {
    console.error("saveWhatsAppCredentials", { code: error.code });
    const { error: deactivateError } = await admin.rpc(
      "fail_tenant_whatsapp_binding_verification",
      {
        p_tenant_id: gate.tenantId,
        p_actor_id: gate.userId,
        p_reason: error.code === "23505" ? "routing_conflict" : "activation_failed",
      },
    );
    if (deactivateError) {
      console.error("deactivateWhatsAppBindingAfterSaveFailure", {
        code: deactivateError.code,
      });
    }
    revalidatePath("/app/ayarlar");
    if (error.code === "23505") {
      return { error: "Bu WhatsApp telefon numarası kimliği başka bir aktif ofise bağlı." };
    }
    if (error.code === "22023") {
      return { error: "WhatsApp ayarları geçersiz veya erişim anahtarı eksik." };
    }
    return { error: "WhatsApp Cloud API bağlantısı kaydedilemedi." };
  }

  revalidatePath("/app/ayarlar");
  return { ok: true };
}

/** Deletes the tenant route and its cascaded service-only token atomically. */
/**
 * Netgsm bağlantı testi (B9): yalnız İŞLEMİ YAPAN kullanıcının kendi profilindeki telefona,
 * ofisin kendi Netgsm hesabıyla tek bir deneme SMS'i gönderir. Başka numara kabul edilmez;
 * hız sınırlı (10 dk'da 3), demo ortamında ve platform fallback'inde kapalıdır.
 */
export async function sendNetgsmTestSms(): Promise<TenantIntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (isDemoLoginEnabled()) return { error: "Demo ortamında dış SMS gönderimi kapalıdır." };

  const { allowed } = await checkRateLimit(`netgsm-test:${gate.tenantId}`, {
    limit: 3,
    windowSec: 600,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok sık denendi. Birkaç dakika sonra tekrar deneyin." };

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("phone")
    .eq("id", gate.userId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  const phone = (profile?.phone as string | null) ?? null;
  if (!phone) return { error: "Profilinizde telefon yok. Test SMS'i yalnız kendi telefonunuza gönderilir." };

  // Yalnız ofisin kendi hesabı: platform fallback'ine düşülmez.
  if (!(await getTenantNetgsmConfig(gate.tenantId))) {
    return { error: "Önce ofisinizin Netgsm bilgilerini kaydedin; test yalnız ofis hesabıyla yapılır." };
  }
  const result = await sendTenantSms(
    gate.tenantId,
    phone,
    "EmlakSoft Netgsm baglanti testi: SMS ayarlariniz calisiyor.",
  );
  if (!result.ok) {
    console.error("sendNetgsmTestSms", { code: result.code ?? "provider_error" });
    return { error: "Test SMS'i gönderilemedi. Kullanıcı kodu, şifre ve onaylı başlığı kontrol edin." };
  }
  return { ok: true };
}

export async function clearWhatsAppCredentials(): Promise<TenantIntegrationResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { error } = await admin.rpc("delete_tenant_whatsapp_cloud_integration", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
  });
  if (error) {
    console.error("clearWhatsAppCredentials", { code: error.code });
    return { error: "WhatsApp Cloud API bağlantısı kaldırılamadı." };
  }

  revalidatePath("/app/ayarlar");
  return { ok: true };
}
