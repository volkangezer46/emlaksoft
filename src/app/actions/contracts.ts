"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { validateTenantReferences } from "@/lib/tenant-references";
import { getBaseUrl } from "@/lib/base-url";
import { hashOtpForStorage, verifyOtpHash } from "@/lib/otp-hmac";
import { isIsoDate } from "@/lib/workflow-state";
import {
  isSignerSmsAvailable,
  sendSignerSms,
} from "@/app/imza/_lib/sms";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { parseFixedPct, parseIncreaseBasis } from "@/lib/rental-contract/build";
import { isMissingSchemaError } from "@/lib/property-owner/info";
import { isValidEmail, normalizeEmail } from "@/lib/email";

type TenantStatusRel = { status?: string | null } | { status?: string | null }[] | null;
function tenantStatusOf(rel: TenantStatusRel): string | null | undefined {
  return Array.isArray(rel) ? rel[0]?.status : rel?.status;
}

function appBaseUrl() {
  return getBaseUrl();
}

export type ContractResult = { ok?: boolean; error?: string; id?: string; notified?: number };

const CONTRACT_TYPES = ["satis", "kira", "sozlesme", "teklif", "yer_gosterme", "kapora", "diger"] as const;

// --- SMS OTP (imza doğrulama) sabitleri ---
const OTP_TTL_MS = 5 * 60_000; // kod 5 dakika geçerli
const OTP_MAX_ATTEMPTS = 5;    // 5 hatalı denemede kilit — yeni kod istenir

// ---------------------------------------------------------------------------
// Sözleşme oluştur
// ---------------------------------------------------------------------------

export async function createContract(
  _prev: ContractResult,
  fd: FormData,
): Promise<ContractResult> {
  const gate = await requirePermission("contracts", "create");
  if (!gate.ok) return { error: gate.error };

  const title        = String(fd.get("title")        ?? "").trim();
  const contractType = String(fd.get("contract_type") ?? "diger").trim() as typeof CONTRACT_TYPES[number];
  const body         = String(fd.get("body")         ?? "").trim();
  let propertyId     = String(fd.get("property_id")  ?? "").trim() || null;
  let customerId     = String(fd.get("customer_id")  ?? "").trim() || null;
  const expiresAt    = String(fd.get("expires_at")   ?? "").trim() || null;
  // Kiralamadan oluşturma (H6): kira kaydı + artış maddesi alanı. Boşsa mevcut akış aynen çalışır.
  const rentalId     = String(fd.get("rental_id")    ?? "").trim() || null;
  const increaseBasis = parseIncreaseBasis(fd.get("rent_increase_basis"));
  const fixedPct     = parseFixedPct(fd.get("rent_increase_fixed_pct"));

  if (!title) return { error: "Sözleşme başlığı zorunludur." };
  if (!fixedPct.ok) return { error: "Sabit artış oranı 0 ile 100 arasında olmalı." };
  if (increaseBasis === "sabit" && fixedPct.value == null) return { error: "Sabit artış için yüzde girin." };
  if (!body)  return { error: "Sözleşme içeriği boş olamaz." };
  if (!CONTRACT_TYPES.includes(contractType)) return { error: "Geçersiz sözleşme türü." };
  if (expiresAt && !isIsoDate(expiresAt)) return { error: "Geçerli bir son tarih girin." };
  if (expiresAt && new Date(`${expiresAt}T23:59:59.999Z`).getTime() <= Date.now()) {
    return { error: "Son geçerlilik tarihi gelecekte olmalı." };
  }

  const supabase = await createClient();
  if (rentalId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rentalId)) return { error: "Kira kaydı bulunamadı." };
    const { data: rental } = await supabase
      .from("rentals")
      .select("id, property_id, renter_customer_id")
      .eq("id", rentalId)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (!rental) return { error: "Kira kaydı bulunamadı." };
    // Portföy/kiracı bağı kira kaydından gelir (forma gizli alan olarak taşınan değer güvenilmez).
    propertyId = (rental as { property_id: string }).property_id;
    customerId = (rental as { renter_customer_id: string }).renter_customer_id;
  }

  const references = await validateTenantReferences(gate.tenantId, {
    propertyId,
    customerId,
  });
  if (!references.ok) return { error: references.error };

  const { data, error } = await supabase
    .from("contracts")
    .insert({
      tenant_id:     gate.tenantId,
      created_by:    gate.userId,
      title,
      contract_type: contractType,
      body,
      property_id:   propertyId,
      customer_id:   customerId,
      expires_at:    expiresAt ? `${expiresAt}T23:59:59.999Z` : null,
      status:        "draft",
      // Yalnız kiralamadan oluşturulurken yazılır: sütunlar yoksa eski akış etkilenmez.
      ...(rentalId
        ? {
            rental_id: rentalId,
            rent_increase_basis: increaseBasis ?? "tufe",
            rent_increase_fixed_pct: increaseBasis === "sabit" ? fixedPct.value : null,
          }
        : {}),
    })
    .select("id")
    .single();

  if (error || !data) {
    if (rentalId && isMissingSchemaError(error)) {
      return { error: "Kiralamadan sözleşme için veritabanı güncellemesi henüz uygulanmamış." };
    }
    return { error: "Sözleşme oluşturulamadı." };
  }

  revalidatePath("/app/sozlesmeler");
  if (rentalId) revalidatePath(`/app/kiralama/${rentalId}`);
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Sözleşme güncelle (+ sürüm geçmişi)
// ---------------------------------------------------------------------------

async function updateContractDraftAtomic(input: {
  tenantId: string;
  actorId: string;
  contractId: string;
  title: string | null;
  body: string;
}): Promise<ContractResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("update_contract_draft_atomic", {
    p_tenant_id: input.tenantId,
    p_actor_id: input.actorId,
    p_contract_id: input.contractId,
    p_title: input.title,
    p_body: input.body,
  });
  if (error) {
    console.error("updateContractDraftAtomic", error);
    return { error: "Sözleşme güncellenemedi." };
  }
  const outcome = String((data as { outcome?: string } | null)?.outcome ?? "");
  if (outcome === "not_found") return { error: "Sözleşme bulunamadı." };
  if (outcome === "invalid_state") return { error: "Sadece taslak sözleşmeler düzenlenebilir." };
  if (outcome === "invalid_input") return { error: "Sözleşme içeriği veya başlığı geçersiz." };
  if (outcome !== "applied" && outcome !== "replay") return { error: "Sözleşme güncellenemedi." };
  return { ok: true };
}

export async function updateContract(
  _prev: ContractResult,
  fd: FormData,
): Promise<ContractResult> {
  const gate = await requirePermission("contracts", "edit");
  if (!gate.ok) return { error: gate.error };

  const id    = String(fd.get("id")    ?? "").trim();
  const title = String(fd.get("title") ?? "").trim();
  const body  = String(fd.get("body")  ?? "").trim();

  if (!id)    return { error: "Sözleşme ID gerekli." };
  if (!title) return { error: "Başlık zorunludur." };

  const result = await updateContractDraftAtomic({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    contractId: id,
    title,
    body,
  });
  if (!result.ok) return result;

  revalidatePath("/app/sozlesmeler");
  revalidatePath(`/app/sozlesmeler/${id}`);
  return { ok: true };
}

/**
 * Yalnızca içerik güncelleme — "Alanları doldur" sihirbazı bunun üzerinden
 * çalışır. Önceki içerik sürüm geçmişine yazılır; sadece taslakta çalışır.
 */
export async function updateContractBody(
  _prev: ContractResult,
  fd: FormData,
): Promise<ContractResult> {
  const gate = await requirePermission("contracts", "edit");
  if (!gate.ok) return { error: gate.error };

  const id   = String(fd.get("id")   ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();

  if (!id)   return { error: "Sözleşme ID gerekli." };
  if (!body) return { error: "Sözleşme içeriği boş olamaz." };

  const result = await updateContractDraftAtomic({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    contractId: id,
    title: null,
    body,
  });
  if (!result.ok) return result;

  revalidatePath(`/app/sozlesmeler/${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// İmzalatmaya gönder (imzalayan ekle + durum → sent)
// ---------------------------------------------------------------------------

export async function sendContractForSigning(
  contractId: string,
  signers: { full_name: string; email?: string; phone?: string }[],
): Promise<ContractResult> {
  const gate = await requirePermission("contracts", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!signers.length || signers.length > 20) return { error: "1-20 imzalayan ekleyin." };

  const normalized = signers.map((signer) => ({
    full_name: String(signer.full_name ?? "").trim(),
    email: normalizeEmail(String(signer.email ?? "")) || undefined,
    phone: String(signer.phone ?? "").trim() || undefined,
  }));
  if (normalized.some((signer) => !signer.full_name || signer.full_name.length > 160)) {
    return { error: "Her imzalayan için geçerli bir ad soyad girin." };
  }
  if (normalized.some((signer) => signer.email && !isValidEmail(signer.email))) {
    return { error: "İmzalayan e-posta adreslerinden biri geçersiz." };
  }
  if (normalized.some((signer) => signer.phone && !parsePhoneStrict(signer.phone).ok)) {
    return { error: "İmzalayan telefon numaralarından biri geçersiz." };
  }
  for (const signer of normalized) {
    if (signer.phone) signer.phone = parsePhoneStrict(signer.phone).stored;
  }
  const identities = normalized.map((signer) =>
    signer.email || signer.phone?.replace(/\D/g, "") || signer.full_name.toLocaleLowerCase("tr-TR"),
  );
  if (new Set(identities).size !== identities.length) {
    return { error: "Aynı imzalayan birden fazla kez eklenemez." };
  }

  const admin = createAdminClient();
  const { data: transitionData, error: transitionError } = await admin.rpc(
    "send_contract_for_signing_atomic",
    {
      p_tenant_id: gate.tenantId,
      p_actor_id: gate.userId,
      p_contract_id: contractId,
      p_signers: normalized,
      p_default_expiry: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    },
  );
  if (transitionError) {
    console.error("sendContractForSigning atomic", { code: transitionError.code });
    return { error: "Sözleşme imzaya gönderilemedi. Hiçbir imzalayan eklenmedi." };
  }
  const transition = transitionData && typeof transitionData === "object" && !Array.isArray(transitionData)
    ? transitionData as Record<string, unknown>
    : null;
  const outcome = typeof transition?.outcome === "string" ? transition.outcome : "invalid_result";
  if (outcome === "not_found") return { error: "Sözleşme bulunamadı." };
  if (outcome === "invalid_state") return { error: "Sadece taslak sözleşmeler imzaya gönderilebilir." };
  if (outcome === "expired") return { error: "Sözleşmenin son geçerlilik tarihi geçmiş; önce taslağı güncelleyin." };
  if (outcome !== "applied") return { error: "Sözleşme imzaya gönderilemedi." };
  const insertedSigners = Array.isArray(transition?.signers)
    ? transition.signers.filter((value): value is { token: string; phone?: string; full_name: string } => {
        if (!value || typeof value !== "object") return false;
        const row = value as Record<string, unknown>;
        return typeof row.token === "string" && typeof row.full_name === "string";
      })
    : [];

  const { data: contract } = await admin
    .from("contracts")
    .select("title")
    .eq("id", contractId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  const contractTitle = contract?.title ?? "Sözleşme";

  // İmza linklerini tenant-owned Netgsm kaydıyla gönder. Platform hesabı ancak
  // açık fallback politikası varsa kullanılabilir; SMS hatası akışı bloklamaz.
  let smsSent = 0;
  const base = appBaseUrl();
  for (const signer of insertedSigners) {
    if (!signer.phone || !(await isSignerSmsAvailable(gate.tenantId, signer.phone))) continue;
    const link = `${base}/imza/${signer.token}`;
    const text = `Sayin ${signer.full_name}, "${contractTitle}" sozlesmesini imzalamak icin: ${link}`;
    const result = await sendSignerSms(gate.tenantId, signer.phone, text);
    if (result.ok) smsSent += 1;
    else console.error("sendContract sms failed", { code: result.code ?? "provider_error" });
  }

  revalidatePath("/app/sozlesmeler");
  revalidatePath(`/app/sozlesmeler/${contractId}`);
  return { ok: true, notified: smsSent };
}

// ---------------------------------------------------------------------------
// İmza onayla (public endpoint için — token ile)
// ---------------------------------------------------------------------------

export async function signContractByToken(
  token: string,
  ip?: string,
): Promise<ContractResult> {
  const admin = createAdminClient();

  const { data: signer, error: signerError } = await admin
    .from("contract_signers")
    .select("id, contract_id, status, phone, verified_at")
    .eq("token", token)
    .maybeSingle();

  if (signerError) {
    console.error("verifySignatureOtp signer lookup", { code: signerError.code });
    return { error: "Doğrulama servisine şu anda erişilemiyor. Lütfen tekrar deneyin." };
  }
  if (!signer) return { error: "Geçersiz veya süresi dolmuş imza linki." };
  if (signer.status !== "pending") return { error: "Bu sözleşme zaten imzalandı veya reddedildi." };

  // Sunucu tarafı zorunlu kontrol — görüntü kontrolü doğrudan action çağrısıyla atlanamasın
  const { data: contract, error: contractError } = await admin
    .from("contracts")
    .select("status, expires_at, tenant_id, tenant:tenants(status)")
    .eq("id", signer.contract_id)
    .maybeSingle();
  if (contractError) {
    console.error("verifySignatureOtp contract lookup", { code: contractError.code });
    return { error: "Doğrulama servisine şu anda erişilemiyor. Lütfen tekrar deneyin." };
  }

  if (!contract) return { error: "Sözleşme bulunamadı." };
  // Tenant askıya alındı/iptal edildiyse imza akışı da kapansın (görüntüleme
  // sayfasıyla aynı kapı — doğrudan action çağrısıyla atlanamasın).
  if (!isPublicTenantActive(tenantStatusOf(contract.tenant as TenantStatusRel))) {
    return { error: "Sözleşme bulunamadı." };
  }
  if (contract.status === "cancelled") return { error: "Bu sözleşme iptal edilmiştir; imza alınamaz." };
  if (contract.expires_at && new Date(contract.expires_at).getTime() < Date.now()) {
    return { error: "Bu imza linkinin geçerlilik süresi dolmuştur." };
  }

  // RPC doğrulama şartını yeniden kontrol eder ve imzalayan + sözleşme aggregate
  // durumunu tek transaction'da ilerletir. Böylece iptal/imza yarışında tek taraf kazanır.
  const requireVerified = Boolean(
    signer.phone && (await isSignerSmsAvailable(contract.tenant_id, signer.phone)),
  );
  if (requireVerified && !signer.verified_at) {
    return { error: "İmzadan önce SMS doğrulaması gereklidir. Lütfen telefonunuza gönderilen kodu doğrulayın." };
  }
  const { data: transitionData, error: transitionError } = await admin.rpc(
    "sign_contract_atomic",
    {
      p_token: token,
      p_ip: ip ?? null,
      p_require_verified: requireVerified,
    },
  );
  if (transitionError) {
    console.error("signContractByToken atomic", { code: transitionError.code });
    return { error: "İmza kaydedilemedi. Lütfen tekrar deneyin." };
  }
  const transition = transitionData && typeof transitionData === "object" && !Array.isArray(transitionData)
    ? transitionData as Record<string, unknown>
    : null;
  const outcome = typeof transition?.outcome === "string" ? transition.outcome : "invalid_result";
  if (outcome === "applied" || outcome === "replay") return { ok: true };
  if (outcome === "expired") return { error: "Bu imza linkinin geçerlilik süresi dolmuştur." };
  if (outcome === "verification_required") return { error: "İmzadan önce SMS doğrulaması gereklidir." };
  if (outcome === "inactive_tenant" || outcome === "invalid_link") return { error: "Sözleşme bulunamadı." };
  return { error: "Bu sözleşme artık imzalanamaz." };
}

/**
 * Public imza sayfası form action'ı — token'ı formdan alır, IP'yi header'dan
 * çözer, imzayı kaydeder ve sayfayı yeniler. Auth gerekmez (token yeterli).
 */
export async function submitSignatureByToken(
  _prev: ContractResult,
  fd: FormData,
): Promise<ContractResult> {
  const token = String(fd.get("token") ?? "").trim();
  if (!token) return { error: "Geçersiz imza linki." };

  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    undefined;

  // Token tahmini/kaba kuvvet koruması — IP başına dakikada 10 deneme
  const { allowed } = await checkRateLimit(`sign:${ip ?? "unknown"}`, {
    limit: 10,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." };

  const result = await signContractByToken(token, ip);
  if (result.ok) revalidatePath(`/imza/${token}`);
  return result;
}

// ---------------------------------------------------------------------------
// SMS OTP — imza öncesi telefon doğrulama (public, token ile)
// ---------------------------------------------------------------------------

/**
 * İmzalayanın kayıtlı telefonuna 6 haneli doğrulama kodu gönderir.
 * Kod düz metin saklanmaz (sha256), 5 dakika geçerlidir. Tenant Netgsm
 * kaydı öncelikli; yoksa platform varsayılanıyla gönderilir.
 */
export async function requestSignatureOtp(
  _prev: ContractResult,
  fd: FormData,
): Promise<ContractResult> {
  const token = String(fd.get("token") ?? "").trim();
  if (!token) return { error: "Geçersiz imza linki." };

  // SMS bombardımanı koruması — IP başına 5 dakikada 10 istek
  const ip = await clientIp();
  const ipLimit = await checkRateLimit(`imza-otp:${ip}`, {
    limit: 10,
    windowSec: 300,
    failurePolicy: "deny",
  });
  if (!ipLimit.allowed) return { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: signer } = await admin
    .from("contract_signers")
    .select("id, contract_id, status, phone")
    .eq("token", token)
    .maybeSingle();

  if (!signer) return { error: "Geçersiz veya süresi dolmuş imza linki." };
  if (signer.status !== "pending") return { error: "Bu sözleşme zaten imzalandı veya reddedildi." };
  if (!signer.phone) return { error: "Bu imza için kayıtlı telefon numarası yok." };

  const { data: contract } = await admin
    .from("contracts")
    .select("status, expires_at, tenant_id, tenant:tenants(status)")
    .eq("id", signer.contract_id)
    .maybeSingle();

  if (!contract) return { error: "Sözleşme bulunamadı." };
  if (!isPublicTenantActive(tenantStatusOf(contract.tenant as TenantStatusRel))) {
    return { error: "Sözleşme bulunamadı." };
  }
  if (contract.status === "cancelled") return { error: "Bu sözleşme iptal edilmiştir; imza alınamaz." };
  if (contract.expires_at && new Date(contract.expires_at).getTime() < Date.now()) {
    return { error: "Bu imza linkinin geçerlilik süresi dolmuştur." };
  }

  if (!(await isSignerSmsAvailable(contract.tenant_id, signer.phone))) {
    return { error: "SMS doğrulaması bu imza için kapalı." };
  }

  // İmzalayan başına 5 dakikada en çok 3 kod
  const signerLimit = await checkRateLimit(`imza-otp-signer:${signer.id}`, {
    limit: 3,
    windowSec: 300,
    failurePolicy: "deny",
  });
  if (!signerLimit.allowed) return { error: "Çok sık kod istendi. Lütfen birkaç dakika sonra tekrar deneyin." };

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  let otpHash: string;
  try {
    otpHash = hashOtpForStorage(code, "contract-signature", signer.id);
  } catch (hashError) {
    console.error("requestSignatureOtp configuration", {
      error: hashError instanceof Error ? hashError.name : "unknown",
    });
    return { error: "Doğrulama kodu güvenli şekilde oluşturulamadı. Lütfen yöneticinize başvurun." };
  }
  const { data: otpData, error: upError } = await admin.rpc("store_contract_signer_otp_atomic", {
    p_token: token,
    p_otp_hash: otpHash,
    p_otp_expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
  });
  if (upError) {
    console.error("requestSignatureOtp atomic", { code: upError.code });
    return { error: "Doğrulama kodu oluşturulamadı. Lütfen tekrar deneyin." };
  }
  const otpOutcome = String((otpData as { outcome?: string } | null)?.outcome ?? "");
  if (otpOutcome === "expired") return { error: "Bu imza linkinin geçerlilik süresi dolmuştur." };
  if (otpOutcome !== "applied") {
    return { error: "Sözleşme durumu değişti; yeni doğrulama kodu gönderilemedi." };
  }

  const res = await sendSignerSms(
    contract.tenant_id,
    signer.phone,
    `EmlakSoft imza doğrulama kodunuz: ${code}`,
  );
  if (!res.ok) {
    console.error("requestSignatureOtp sms", res.error);
    return { error: "Doğrulama SMS'i gönderilemedi. Lütfen tekrar deneyin." };
  }

  return { ok: true };
}

/**
 * SMS ile gönderilen 6 haneli kodu doğrular; doğruysa verified_at set edilir
 * ve imza butonu açılır. 5 hatalı denemede kod geçersiz kılınır.
 */
export async function verifySignatureOtp(
  _prev: ContractResult,
  fd: FormData,
): Promise<ContractResult> {
  const token = String(fd.get("token") ?? "").trim();
  const code  = String(fd.get("code")  ?? "").replace(/\D/g, "");
  if (!token) return { error: "Geçersiz imza linki." };
  if (!/^\d{6}$/.test(code)) return { error: "6 haneli doğrulama kodunu girin." };

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`imza-otp-verify:${ip}`, {
    limit: 15,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!allowed) return { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: signer } = await admin
    .from("contract_signers")
    .select("id, contract_id, status, otp_hash, otp_expires_at, otp_attempts")
    .eq("token", token)
    .maybeSingle();

  if (!signer) return { error: "Geçersiz veya süresi dolmuş imza linki." };
  if (signer.status !== "pending") return { error: "Bu sözleşme zaten imzalandı veya reddedildi." };

  const { data: contract } = await admin
    .from("contracts")
    .select("tenant:tenants(status)")
    .eq("id", signer.contract_id)
    .maybeSingle();
  if (!contract || !isPublicTenantActive(tenantStatusOf(contract.tenant as TenantStatusRel))) {
    return { error: "Sözleşme bulunamadı." };
  }
  if (!signer.otp_hash || !signer.otp_expires_at) return { error: "Önce doğrulama kodu isteyin." };
  if (new Date(signer.otp_expires_at).getTime() < Date.now()) {
    return { error: "Kodun süresi doldu. Lütfen yeni kod isteyin." };
  }

  const attempts = signer.otp_attempts ?? 0;
  if (attempts >= OTP_MAX_ATTEMPTS) {
    return { error: "Çok fazla hatalı deneme. Lütfen yeni kod isteyin." };
  }

  let codeMatches: boolean;
  try {
    codeMatches = verifyOtpHash(code, signer.otp_hash, "contract-signature", signer.id);
  } catch (hashError) {
    console.error("verifySignatureOtp configuration", {
      error: hashError instanceof Error ? hashError.name : "unknown",
    });
    return { error: "Doğrulama güvenli şekilde tamamlanamadı. Lütfen yöneticinize başvurun." };
  }

  if (!codeMatches) {
    const next = attempts + 1;
    const locked = next >= OTP_MAX_ATTEMPTS;
    // Optimistic compare-and-swap: aynı challenge'a gelen paralel denemelerden
    // yalnız biri sayacı tüketebilir. Kaybeden istek güncel durumu yeniden okumadan
    // eski sayaç/hash üzerinden yazamaz.
    const { data: consumed, error: consumeError } = await admin
      .from("contract_signers")
      .update(locked ? { otp_attempts: next, otp_hash: null, otp_expires_at: null } : { otp_attempts: next })
      .eq("id", signer.id)
      .eq("status", "pending")
      .eq("otp_attempts", attempts)
      .eq("otp_hash", signer.otp_hash)
      .eq("otp_expires_at", signer.otp_expires_at)
      .select("id")
      .maybeSingle();
    if (consumeError) {
      console.error("verifySignatureOtp attempt consume", { code: consumeError.code });
      return { error: "Doğrulama kaydedilemedi. Lütfen tekrar deneyin." };
    }
    if (!consumed) {
      return { error: "Kod durumu değişti. Lütfen yeniden deneyin veya yeni kod isteyin." };
    }
    return {
      error: locked
        ? "Çok fazla hatalı deneme — kod geçersiz kılındı. Lütfen yeni kod isteyin."
        : `Kod hatalı. Kalan deneme hakkı: ${OTP_MAX_ATTEMPTS - next}`,
    };
  }

  // Doğru kod da aynı challenge sürümünü atomik tüketir; eşzamanlı hatalı
  // deneme veya yeni-kod isteği araya girdiyse eski doğrulama geçerli sayılmaz.
  const { data: verified, error: upError } = await admin
    .from("contract_signers")
    .update({
      verified_at:    new Date().toISOString(),
      otp_hash:       null,
      otp_expires_at: null,
      otp_attempts:   0,
    })
    .eq("id", signer.id)
    .eq("status", "pending")
    .eq("otp_attempts", attempts)
    .eq("otp_hash", signer.otp_hash)
    .eq("otp_expires_at", signer.otp_expires_at)
    .select("id")
    .maybeSingle();

  if (upError) return { error: "Doğrulama kaydedilemedi. Lütfen tekrar deneyin." };
  if (!verified) {
    return { error: "Kod durumu değişti. Lütfen yeniden deneyin veya yeni kod isteyin." };
  }

  revalidatePath(`/imza/${token}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sözleşme iptal et
// ---------------------------------------------------------------------------

export async function cancelContract(id: string): Promise<ContractResult> {
  const gate = await requirePermission("contracts", "edit");
  if (!gate.ok) return { error: gate.error };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("cancel_contract_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_contract_id: id,
  });
  if (error) {
    console.error("cancelContract atomic", { code: error.code });
    return { error: "Sözleşme iptal edilemedi." };
  }
  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  const outcome = typeof result?.outcome === "string" ? result.outcome : "invalid_result";
  if (outcome === "not_found") return { error: "Sözleşme bulunamadı." };
  if (outcome === "invalid_state") {
    return { error: "İmzalanmış veya reddedilmiş sözleşme iptal edilemez." };
  }
  if (outcome !== "applied" && outcome !== "replay") {
    return { error: "Sözleşme iptal edilemedi." };
  }

  revalidatePath("/app/sozlesmeler");
  revalidatePath(`/app/sozlesmeler/${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sözleşmeleri listele
// ---------------------------------------------------------------------------

export async function listContracts() {
  const gate = await requirePermission("contracts", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("contracts")
    .select(`
      id, title, contract_type, status, created_at, signed_at, expires_at,
      property:properties!contracts_property_id_fkey(property_code, title),
      customer:customers!contracts_customer_id_fkey(full_name)
    `)
    .eq("tenant_id", gate.tenantId)
    .order("created_at", { ascending: false })
    .limit(100);

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Sözleşme şablonları (global + tenant)
// ---------------------------------------------------------------------------

export type ContractTemplateOption = {
  id: string;
  type: string;
  title: string;
  content: string;
  isGlobal: boolean;
};

/** Aktif şablonlar: global hazır şablonlar + ofisin kendi kayıtları. */
export async function listContractTemplates(): Promise<ContractTemplateOption[]> {
  const gate = await requirePermission("contracts", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("contract_templates")
    .select("id, tenant_id, type, title, content")
    .eq("is_active", true)
    .or(`tenant_id.is.null,tenant_id.eq.${gate.tenantId}`)
    .order("created_at", { ascending: true })
    .limit(100);

  return (data ?? []).map((t) => ({
    id:       t.id as string,
    type:     t.type as string,
    title:    t.title as string,
    content:  t.content as string,
    isGlobal: t.tenant_id == null,
  }));
}

/** Ofisin kendi şablonunu kaydeder ("Bu içeriği şablon olarak kaydet"). */
export async function saveContractTemplate(
  _prev: ContractResult,
  fd: FormData,
): Promise<ContractResult> {
  const gate = await requirePermission("contracts", "create");
  if (!gate.ok) return { error: gate.error };

  const title   = String(fd.get("title")   ?? "").trim();
  const type    = String(fd.get("type")    ?? "diger").trim() as typeof CONTRACT_TYPES[number];
  const content = String(fd.get("content") ?? "").trim();

  if (!title)   return { error: "Şablon adı zorunludur." };
  if (!content) return { error: "Şablon içeriği boş olamaz." };
  if (!CONTRACT_TYPES.includes(type)) return { error: "Geçersiz sözleşme türü." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contract_templates")
    .insert({
      tenant_id:  gate.tenantId,
      type,
      title,
      content,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Şablon kaydedilemedi." };

  revalidatePath("/app/sozlesmeler");
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Sürüm geçmişi
// ---------------------------------------------------------------------------

export type ContractVersionRow = {
  id: string;
  version_no: number;
  content: string;
  created_at: string;
};

export async function listContractVersions(contractId: string): Promise<ContractVersionRow[]> {
  const gate = await requirePermission("contracts", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  // RLS zaten tenant izolasyonu sağlıyor; contract tenant kontrolü ek güvence
  const { data: contract } = await supabase
    .from("contracts")
    .select("id")
    .eq("id", contractId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  if (!contract) return [];

  const { data } = await supabase
    .from("contract_versions")
    .select("id, version_no, content, created_at")
    .eq("contract_id", contractId)
    .order("version_no", { ascending: false })
    .limit(50);

  return (data ?? []) as ContractVersionRow[];
}

/**
 * "Bu sürüme dön" — mevcut içerik önce yeni bir sürüm olarak saklanır,
 * ardından sözleşme gövdesi seçilen sürümün içeriğiyle değiştirilir.
 * Yalnızca taslak durumundaki sözleşmelerde çalışır.
 */
export async function restoreContractVersion(
  contractId: string,
  versionId: string,
): Promise<ContractResult> {
  const gate = await requirePermission("contracts", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!contractId || !versionId) return { error: "Geçersiz istek." };

  const supabase = await createClient();

  const { data: version } = await supabase
    .from("contract_versions")
    .select("id, content, version_no")
    .eq("id", versionId)
    .eq("contract_id", contractId)
    .maybeSingle();

  if (!version) return { error: "Sürüm bulunamadı." };
  const result = await updateContractDraftAtomic({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    contractId,
    title: null,
    body: version.content,
  });
  if (!result.ok) return { error: result.error ?? "Sürüme dönülemedi." };

  revalidatePath(`/app/sozlesmeler/${contractId}`);
  return { ok: true };
}
