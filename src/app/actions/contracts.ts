"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { sendSms, isNetgsmConfigured } from "@/lib/messaging/netgsm";
import { checkRateLimit } from "@/lib/rate-limit";

function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export type ContractResult = { ok?: boolean; error?: string; id?: string; notified?: number };

const CONTRACT_TYPES = ["satis", "kira", "sozlesme", "teklif", "diger"] as const;

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
// Sözleşme güncelle
// ---------------------------------------------------------------------------

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

  // Sözleşme durumunu güncelle
  await admin
    .from("contracts")
    .update({ status: "sent", updated_at: new Date().toISOString() })
    .eq("id", contractId);

  // İmza linklerini SMS ile gönder (Netgsm yapılandırılmışsa; hata gönderimi bloklamaz)
  let smsSent = 0;
  if (await isNetgsmConfigured()) {
    const base = appBaseUrl();
    for (const s of insertedSigners ?? []) {
      if (!s.phone) continue;
      const link = `${base}/imza/${s.token}`;
      const text = `Sayin ${s.full_name}, "${contract.title}" sozlesmesini imzalamak icin: ${link}`;
      const res = await sendSms(s.phone, text);
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
    .select("id, contract_id, status")
    .eq("token", token)
    .maybeSingle();

  if (!signer) return { error: "Geçersiz veya süresi dolmuş imza linki." };
  if (signer.status !== "pending") return { error: "Bu sözleşme zaten imzalandı veya reddedildi." };

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
