"use server";

import { revalidatePath } from "next/cache";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { resolveSupabasePublicKey } from "@/lib/supabase/keys";
import { requireActiveTenant } from "@/lib/tenant-guard";
import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { notifyTenant } from "@/lib/notify";
import { roleLabel } from "@/lib/role-labels";
import {
  OWNERSHIP_TRANSFER_HREF,
  RPC,
  isDemoteRole,
  ownershipTransferMessage,
  parseOwnershipRpc,
} from "@/lib/ownership-transfer";

/**
 * Ofis sahipliği devri (sahibin kendisi başlatır, hedef onaylar). Durum değişimi + rol takası + JWT claim + denetim
 * kaydı TEK veritabanı işleminde, JWT kimlikli RPC'lerde yapılır (20261006000720); burada service_role YOKTUR.
 * Bu katman: oturum/rol kapısı, destek oturumu reddi, hız sınırı, parola yeniden doğrulaması, uygulama içi bildirim.
 * RPC yoksa (migration uygulanmadı) "bu ortamda etkin değil" döner.
 */

export type OwnershipActionResult = { ok?: boolean; error?: string; message?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_READY = "Sahiplik devri bu ortamda henüz etkin değil (veritabanı güncellemesi bekleniyor).";

function isMissingRpc(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

function uuidField(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return UUID_RE.test(v) ? v : null;
}

async function limited(bucket: string, userId: string): Promise<boolean> {
  const { allowed } = await checkRateLimit(`owner-transfer:${bucket}:${userId}`, { limit: 5, windowSec: 3600, failurePolicy: "deny" });
  return !allowed;
}

/** Parola yeniden doğrulaması (oturumu değiştirmeyen ayrı istemci; bkz. account.ts). */
async function verifyPassword(userId: string, password: string): Promise<string | null> {
  if (!password) return "Onay için parolanızı girin.";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || user.id !== userId) return "Oturum doğrulanamadı.";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = resolveSupabasePublicKey();
  if (!url || !key) return "Kimlik servisi yapılandırılmamış.";
  const verifier = createJsClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await verifier.auth.signInWithPassword({ email: user.email, password });
  return error ? "Parola hatalı." : null;
}

async function safeNotify(input: Parameters<typeof notifyTenant>[0]) {
  try {
    await notifyTenant(input);
  } catch (e) {
    console.error("ownership-transfer notify", e);
  }
}

/** Sahip: devri başlatır (hedef + kendi devir sonrası rolü + parola). */
export async function requestOwnershipTransfer(formData: FormData): Promise<OwnershipActionResult> {
  const gate = await requirePermission("team", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda sahiplik devri yapılamaz." };
  if (gate.role !== "owner") return { error: ownershipTransferMessage("not_owner") };

  const toUserId = uuidField(formData, "to_user_id");
  if (!toUserId || toUserId === gate.userId) return { error: ownershipTransferMessage("invalid_target") };
  const demoteRole = String(formData.get("demote_role") ?? "gm").trim();
  if (!isDemoteRole(demoteRole)) return { error: ownershipTransferMessage("invalid_role") };
  if (await limited("request", gate.userId)) return { error: "Çok fazla deneme yapıldı. Bir saat sonra tekrar deneyin." };
  const pwError = await verifyPassword(gate.userId, String(formData.get("password") ?? ""));
  if (pwError) return { error: pwError };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(RPC.request, { p_to_user_id: toUserId, p_demote_role: demoteRole });
  if (error) {
    if (isMissingRpc(error)) return { error: NOT_READY };
    console.error("requestOwnershipTransfer", error.code);
    return { error: ownershipTransferMessage(null) };
  }
  const res = parseOwnershipRpc(data);
  if (!res.ok) return { error: ownershipTransferMessage(res.code) };

  await safeNotify({
    tenantId: gate.tenantId,
    userId: toUserId,
    title: "Ofis sahipliği size devredilmek isteniyor",
    body: `Ofis sahibi sahipliği size devretmek istiyor; devirden sonra kendisi ${roleLabel(demoteRole)} olacak. Onaylamak ya da reddetmek için açın.`,
    href: OWNERSHIP_TRANSFER_HREF,
    kind: "warning",
  });
  revalidatePath(OWNERSHIP_TRANSFER_HREF);
  return { ok: true, message: "Devir talebi gönderildi. Devralacak kişi uygulamada onayladığında sahiplik geçer." };
}

/** Hedef kullanıcı: devri parolasıyla onaylar. Rol takası tek işlemde; oturum yeni rolle yenilenir. */
export async function acceptOwnershipTransfer(formData: FormData): Promise<OwnershipActionResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda sahiplik devri yapılamaz." };
  const transferId = uuidField(formData, "transfer_id");
  if (!transferId) return { error: ownershipTransferMessage("not_found") };
  if (await limited("accept", gate.userId)) return { error: "Çok fazla deneme yapıldı. Bir saat sonra tekrar deneyin." };
  const pwError = await verifyPassword(gate.userId, String(formData.get("password") ?? ""));
  if (pwError) return { error: pwError };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(RPC.accept, { p_transfer_id: transferId });
  if (error) {
    if (isMissingRpc(error)) return { error: NOT_READY };
    console.error("acceptOwnershipTransfer", error.code);
    return { error: ownershipTransferMessage(null) };
  }
  const res = parseOwnershipRpc(data);
  if (!res.ok) {
    revalidatePath(OWNERSHIP_TRANSFER_HREF);
    return { error: ownershipTransferMessage(res.code) };
  }

  if (res.from_user_id) {
    await safeNotify({
      tenantId: gate.tenantId,
      userId: res.from_user_id,
      title: "Sahiplik devri tamamlandı",
      body: `Devir onaylandı; yeni rolünüz ${roleLabel(res.demote_role)}. Yetkileriniz bir sonraki girişte güncellenir.`,
      href: "/app",
      kind: "success",
    });
  }
  // JWT rol claim'i veritabanında güncellendi; bu oturumun belirteci yenilenir (başarısızsa yeniden giriş istenir).
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) console.error("acceptOwnershipTransfer refresh", refreshError.message);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Artık ofis sahibisiniz. Ofis ayarları ve faturalama yetkileri açıldı." };
}

/** İptal (başlatan sahip) ya da ret (hedef). */
export async function resolveOwnershipTransfer(formData: FormData): Promise<OwnershipActionResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda sahiplik devri yapılamaz." };
  const transferId = uuidField(formData, "transfer_id");
  const decision = String(formData.get("decision") ?? "");
  if (!transferId) return { error: ownershipTransferMessage("not_found") };
  if (decision !== "cancelled" && decision !== "declined") return { error: ownershipTransferMessage("invalid_decision") };
  if (await limited("resolve", gate.userId)) return { error: "Çok fazla deneme yapıldı. Bir saat sonra tekrar deneyin." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(RPC.resolve, { p_transfer_id: transferId, p_decision: decision });
  if (error) {
    if (isMissingRpc(error)) return { error: NOT_READY };
    console.error("resolveOwnershipTransfer", error.code);
    return { error: ownershipTransferMessage(null) };
  }
  const res = parseOwnershipRpc(data);
  if (!res.ok) return { error: ownershipTransferMessage(res.code) };

  const other = decision === "cancelled" ? res.to_user_id : res.from_user_id;
  if (other) {
    await safeNotify({
      tenantId: gate.tenantId,
      userId: other,
      title: decision === "cancelled" ? "Sahiplik devri iptal edildi" : "Sahiplik devri reddedildi",
      body: decision === "cancelled" ? "Ofis sahibi devir talebini geri çekti." : "Devralması istenen kişi talebi reddetti.",
      href: OWNERSHIP_TRANSFER_HREF,
      kind: "info",
    });
  }
  revalidatePath(OWNERSHIP_TRANSFER_HREF);
  return { ok: true, message: decision === "cancelled" ? "Devir talebi iptal edildi." : "Devir talebi reddedildi." };
}
