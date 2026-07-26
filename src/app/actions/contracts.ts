"use server";

import { createHash, randomInt, timingSafeEqual } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { isNetgsmConfigured } from "@/lib/messaging/netgsm";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  getTenantNetgsmConfig,
  isSignerSmsAvailable,
  sendSignerSms,
} from "@/app/imza/_lib/sms";

function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export type ContractResult = { ok?: boolean; error?: string; id?: string; notified?: number };

const CONTRACT_TYPES = ["satis", "kira", "sozlesme", "teklif", "yer_gosterme", "kapora", "diger"] as const;

// --- SMS OTP (imza doğrulama) sabitleri ---
const OTP_TTL_MS = 5 * 60_000; // kod 5 dakika geçerli
const OTP_MAX_ATTEMPTS = 5;    // 5 hatalı denemede kilit — yeni kod istenir

function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Zamanlama saldırısına dayanıklı hex karşılaştırma (iyzico webhook deseniyle aynı). */
function otpHashEquals(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sözleşme oluştur
// ---------------------------------------------------------------------------

export async function createContract(
  _prev: ContractResult,
  fd: FormData,
): Promise<ContractResult> {
  const gate = await requirePermission("customers", "create");
  if (!gate.ok) return { error: gate.error };

  const title        = String(fd.get("title")        ?? "").trim();
  const contractType = String(fd.get("contract_type") ?? "diger").trim() as typeof CONTRACT_TYPES[number];
  const body         = String(fd.get("body")         ?? "").trim();
  const propertyId   = String(fd.get("property_id")  ?? "").trim() || null;
  const customerId   = String(fd.get("customer_id")  ?? "").trim() || null;
  const expiresAt    = String(fd.get("expires_at")   ?? "").trim() || null;

  if (!title) return { error: "Sözleşme başlığı zorunludur." };
  if (!body)  return { error: "Sözleşme içeriği boş olamaz." };
  if (!CONTRACT_TYPES.includes(contractType)) return { error: "Geçersiz sözleşme türü." };

  const supabase = await createClient();
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
      expires_at:    expiresAt ? new Date(expiresAt).toISOString() : null,
      status:        "draft",
    })
    .select("id")
    .single();

  if (error || !data) return { error: "Sözleşme oluşturulamadı." };

  revalidatePath("/app/sozlesmeler");
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Sözleşme güncelle (+ sürüm geçmişi)
// ---------------------------------------------------------------------------

/**
 * İçerik değişmeden önceki hali contract_versions'a yazar (max+1 sıra no).
 * Best-effort: snapshot başarısız olsa da güncelleme engellenmez, hata loglanır.
 * Çağıran, sözleşmenin tenant'a ait TASLAK olduğunu önceden doğrulamış olmalı.
 */
async function snapshotContractVersion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contractId: string,
  previousBody: string,
  userId: string,
): Promise<void> {
  const { data: last } = await supabase
    .from("contract_versions")
    .select("version_no")
    .eq("contract_id", contractId)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("contract_versions").insert({
    contract_id: contractId,
    version_no:  (last?.version_no ?? 0) + 1,
    content:     previousBody,
    saved_by:    userId,
  });
  if (error) console.error("snapshotContractVersion", contractId, error);
}

export async function updateContract(
  _prev: ContractResult,
  fd: FormData,
): Promise<ContractResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id    = String(fd.get("id")    ?? "").trim();
  const title = String(fd.get("title") ?? "").trim();
  const body  = String(fd.get("body")  ?? "").trim();

  if (!id)    return { error: "Sözleşme ID gerekli." };
  if (!title) return { error: "Başlık zorunludur." };

  const supabase = await createClient();

  // Sürüm geçmişi: içerik değişiyorsa önceki hali contract_versions'a yaz
  const { data: current } = await supabase
    .from("contracts")
    .select("body, status")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!current) return { error: "Sözleşme bulunamadı." };
  if (current.status !== "draft") return { error: "Sadece taslak sözleşmeler düzenlenebilir." };

  if ((current.body ?? "") !== body && (current.body ?? "").trim()) {
    await snapshotContractVersion(supabase, id, current.body, gate.userId);
  }

  const { error } = await supabase
    .from("contracts")
    .update({ title, body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "draft"); // Sadece taslaklar düzenlenebilir

  if (error) return { error: "Sözleşme güncellenemedi." };

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
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const id   = String(fd.get("id")   ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();

  if (!id)   return { error: "Sözleşme ID gerekli." };
  if (!body) return { error: "Sözleşme içeriği boş olamaz." };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("contracts")
    .select("body, status")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!current) return { error: "Sözleşme bulunamadı." };
  if (current.status !== "draft") return { error: "Sadece taslak sözleşmelerde içerik güncellenebilir." };
  if ((current.body ?? "") === body) return { ok: true }; // Değişiklik yok

  if ((current.body ?? "").trim()) {
    await snapshotContractVersion(supabase, id, current.body, gate.userId);
  }

  const { error } = await supabase
    .from("contracts")
    .update({ body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "draft");

  if (error) return { error: "Sözleşme güncellenemedi." };

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
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!signers.length) return { error: "En az bir imzalayan eklenmeli." };

  const admin = createAdminClient();

  // Sözleşmeyi doğrula
  const { data: contract } = await admin
    .from("contracts")
    .select("id, status, title")
    .eq("id", contractId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!contract) return { error: "Sözleşme bulunamadı." };
  if (contract.status !== "draft") return { error: "Sadece taslak sözleşmeler gönderilebilir." };

  // Süresiz imza token'larını önle — geçerlilik belirtilmemişse gönderimden 30 gün sonrasına kur
  const { data: current } = await admin
    .from("contracts")
    .select("expires_at")
    .eq("id", contractId)
    .maybeSingle();
  const defaultExpiry =
    current?.expires_at ?? new Date(Date.now() + 30 * 86_400_000).toISOString();

  // İmzalayanları ekle — token DB tarafında üretilir, geri okuyup link kuruyoruz
  const { data: insertedSigners } = await admin
    .from("contract_signers")
    .insert(
      signers.map((s) => ({
        contract_id: contractId,
        full_name:   s.full_name,
        email:       s.email ?? null,
        phone:       s.phone ?? null,
        status:      "pending",
      })),
    )
    .select("token, phone, full_name");

  // Sözleşme durumunu güncelle (+ varsayılan geçerlilik süresi)
  await admin
    .from("contracts")
    .update({ status: "sent", expires_at: defaultExpiry, updated_at: new Date().toISOString() })
    .eq("id", contractId);

  // İmza linklerini SMS ile gönder — ofisin (tenant_integrations) Netgsm kaydı
  // öncelikli, yoksa platform varsayılanı (hata gönderimi bloklamaz)
  let smsSent = 0;
  const smsReady =
    (await getTenantNetgsmConfig(gate.tenantId)) !== null || (await isNetgsmConfigured());
  if (smsReady) {
    const base = appBaseUrl();
    for (const s of insertedSigners ?? []) {
      if (!s.phone) continue;
      const link = `${base}/imza/${s.token}`;
      const text = `Sayin ${s.full_name}, "${contract.title}" sozlesmesini imzalamak icin: ${link}`;
      const res = await sendSignerSms(gate.tenantId, s.phone, text);
      if (res.ok) smsSent += 1;
      else console.error("sendContract sms", s.phone, res.error);
    }
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

  const { data: signer } = await admin
    .from("contract_signers")
    .select("id, contract_id, status, phone, verified_at")
    .eq("token", token)
    .maybeSingle();

  if (!signer) return { error: "Geçersiz veya süresi dolmuş imza linki." };
  if (signer.status !== "pending") return { error: "Bu sözleşme zaten imzalandı veya reddedildi." };

  // Sunucu tarafı zorunlu kontrol — görüntü kontrolü doğrudan action çağrısıyla atlanamasın
  const { data: contract } = await admin
    .from("contracts")
    .select("status, expires_at, tenant_id")
    .eq("id", signer.contract_id)
    .maybeSingle();

  if (!contract) return { error: "Sözleşme bulunamadı." };
  if (contract.status === "cancelled") return { error: "Bu sözleşme iptal edilmiştir; imza alınamaz." };
  if (contract.expires_at && new Date(contract.expires_at).getTime() < Date.now()) {
    return { error: "Bu imza linkinin geçerlilik süresi dolmuştur." };
  }

  // SMS OTP zorunluluğu — telefon kayıtlıysa ve SMS gönderilebiliyorsa doğrulama
  // yapılmadan imza kabul edilmez (checkbox kontrolü action çağrısıyla atlanamasın)
  if (
    signer.phone &&
    !signer.verified_at &&
    (await isSignerSmsAvailable(contract.tenant_id, signer.phone))
  ) {
    return { error: "İmzadan önce SMS doğrulaması gereklidir. Lütfen telefonunuza gönderilen kodu doğrulayın." };
  }

  const now = new Date().toISOString();

  await admin
    .from("contract_signers")
    .update({ status: "signed", signed_at: now, ip_address: ip ?? null })
    .eq("id", signer.id);

  // Tüm imzalayanlar imzaladı mı?
  const { data: pending } = await admin
    .from("contract_signers")
    .select("id")
    .eq("contract_id", signer.contract_id)
    .eq("status", "pending");

  if (!pending?.length) {
    await admin
      .from("contracts")
      .update({ status: "signed", signed_at: now, updated_at: now })
      .eq("id", signer.contract_id);
  }

  return { ok: true };
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
  const { allowed } = await checkRateLimit(`sign:${ip ?? "unknown"}`, { limit: 10, windowSec: 60 });
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
  const ipLimit = await checkRateLimit(`imza-otp:${ip}`, { limit: 10, windowSec: 300 });
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
    .select("status, expires_at, tenant_id")
    .eq("id", signer.contract_id)
    .maybeSingle();

  if (!contract) return { error: "Sözleşme bulunamadı." };
  if (contract.status === "cancelled") return { error: "Bu sözleşme iptal edilmiştir; imza alınamaz." };
  if (contract.expires_at && new Date(contract.expires_at).getTime() < Date.now()) {
    return { error: "Bu imza linkinin geçerlilik süresi dolmuştur." };
  }

  if (!(await isSignerSmsAvailable(contract.tenant_id, signer.phone))) {
    return { error: "SMS doğrulaması bu imza için kapalı." };
  }

  // İmzalayan başına 5 dakikada en çok 3 kod
  const signerLimit = await checkRateLimit(`imza-otp-signer:${signer.id}`, { limit: 3, windowSec: 300 });
  if (!signerLimit.allowed) return { error: "Çok sık kod istendi. Lütfen birkaç dakika sonra tekrar deneyin." };

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const { error: upError } = await admin
    .from("contract_signers")
    .update({
      otp_hash:       hashOtp(code),
      otp_expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      otp_attempts:   0,
    })
    .eq("id", signer.id);

  if (upError) {
    console.error("requestSignatureOtp update", upError);
    return { error: "Doğrulama kodu oluşturulamadı. Lütfen tekrar deneyin." };
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
  const { allowed } = await checkRateLimit(`imza-otp-verify:${ip}`, { limit: 15, windowSec: 60 });
  if (!allowed) return { error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." };

  const admin = createAdminClient();
  const { data: signer } = await admin
    .from("contract_signers")
    .select("id, status, otp_hash, otp_expires_at, otp_attempts")
    .eq("token", token)
    .maybeSingle();

  if (!signer) return { error: "Geçersiz veya süresi dolmuş imza linki." };
  if (signer.status !== "pending") return { error: "Bu sözleşme zaten imzalandı veya reddedildi." };
  if (!signer.otp_hash || !signer.otp_expires_at) return { error: "Önce doğrulama kodu isteyin." };
  if (new Date(signer.otp_expires_at).getTime() < Date.now()) {
    return { error: "Kodun süresi doldu. Lütfen yeni kod isteyin." };
  }

  const attempts = signer.otp_attempts ?? 0;
  if (attempts >= OTP_MAX_ATTEMPTS) {
    return { error: "Çok fazla hatalı deneme. Lütfen yeni kod isteyin." };
  }

  if (!otpHashEquals(hashOtp(code), signer.otp_hash)) {
    const next = attempts + 1;
    const locked = next >= OTP_MAX_ATTEMPTS;
    // Kilitte kod geçersiz kılınır — yeni kod istemeden devam edilemez
    await admin
      .from("contract_signers")
      .update(locked ? { otp_attempts: next, otp_hash: null, otp_expires_at: null } : { otp_attempts: next })
      .eq("id", signer.id);
    return {
      error: locked
        ? "Çok fazla hatalı deneme — kod geçersiz kılındı. Lütfen yeni kod isteyin."
        : `Kod hatalı. Kalan deneme hakkı: ${OTP_MAX_ATTEMPTS - next}`,
    };
  }

  const { error: upError } = await admin
    .from("contract_signers")
    .update({
      verified_at:    new Date().toISOString(),
      otp_hash:       null,
      otp_expires_at: null,
      otp_attempts:   0,
    })
    .eq("id", signer.id);

  if (upError) return { error: "Doğrulama kaydedilemedi. Lütfen tekrar deneyin." };

  revalidatePath(`/imza/${token}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sözleşme iptal et
// ---------------------------------------------------------------------------

export async function cancelContract(id: string): Promise<ContractResult> {
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  await supabase
    .from("contracts")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  revalidatePath("/app/sozlesmeler");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sözleşmeleri listele
// ---------------------------------------------------------------------------

export async function listContracts() {
  const gate = await requirePermission("customers", "view");
  if (!gate.ok) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("contracts")
    .select(`
      id, title, contract_type, status, created_at, signed_at, expires_at,
      property:properties(property_code, title),
      customer:customers(full_name)
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
  const gate = await requirePermission("customers", "view");
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
  const gate = await requirePermission("customers", "create");
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
  const gate = await requirePermission("customers", "view");
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
  const gate = await requirePermission("customers", "edit");
  if (!gate.ok) return { error: gate.error };
  if (!contractId || !versionId) return { error: "Geçersiz istek." };

  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("contracts")
    .select("id, body, status")
    .eq("id", contractId)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();

  if (!contract) return { error: "Sözleşme bulunamadı." };
  if (contract.status !== "draft") return { error: "Sadece taslak sözleşmelerde sürüme dönülebilir." };

  const { data: version } = await supabase
    .from("contract_versions")
    .select("id, content, version_no")
    .eq("id", versionId)
    .eq("contract_id", contractId)
    .maybeSingle();

  if (!version) return { error: "Sürüm bulunamadı." };
  if ((contract.body ?? "") === version.content) return { ok: true }; // Zaten aynı içerik

  // Mevcut içerik kaybolmasın — geri dönmeden önce sürüm olarak sakla
  if ((contract.body ?? "").trim()) {
    await snapshotContractVersion(supabase, contractId, contract.body, gate.userId);
  }

  const { error } = await supabase
    .from("contracts")
    .update({ body: version.content, updated_at: new Date().toISOString() })
    .eq("id", contractId)
    .eq("tenant_id", gate.tenantId)
    .eq("status", "draft");

  if (error) return { error: "Sürüme dönülemedi." };

  revalidatePath(`/app/sozlesmeler/${contractId}`);
  return { ok: true };
}
