"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { guardPlatformAction } from "@/lib/platform-guards";
import { clientIpFrom } from "@/lib/platform-activity";
import { requireStepUp } from "@/lib/platform-security/step-up";
import { sensitiveFourEyesGate } from "@/lib/platform-security/four-eyes";
import { SESSION_REASON_MAX, SESSION_REASON_MIN } from "@/lib/admin/ops/office-sessions";

/**
 * GÜVENLİK & VERİ > OFİS OTURUMLARI eylemleri: tek oturumu kapat / kullanıcının tüm oturumlarını kapat.
 * Her ikisi: members modülü (yaz) + süper admin ya da operasyon + hız sınırı (`guardPlatformAction`) + gerekçe
 * (10–300 karakter) + kritik işlem doğrulaması (`session_revoke`, TOTP) + isteğe bağlı dört göz onayı (ayar açıksa
 * başka bir süper adminin onayı bir kez kullanılır) + platform denetim kaydı.
 * RPC'ler (20261027010100) YALNIZ service_role'a açıktır ve service istemcisi ANCAK yukarıdaki tüm kapılar geçtikten sonra
 * kurulur. Personel kimliği (`p_actor_staff_id`) ve gerekçe SQL'de yeniden denetlenir; dört göz izni (`p_approval_id`),
 * oturum kapatma ve denetim satırı TEK transaction'dadır: kapatma hata verirse izin yanmaz, başarıda tam bir denetim
 * satırı yazılır. Yalnız ofis kullanıcısı hedeflenir; belirteç hiçbir yerde okunmaz ya da yazılmaz.
 */

export type OfficeSessionActionResult = { ok?: boolean; error?: string; notice?: string; count?: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE = { key: "admin-office-sessions", limit: 20, windowSec: 600 } as const;

function readReason(fd: FormData): string | null {
  const reason = String(fd.get("reason") ?? "").trim();
  return reason.length >= SESSION_REASON_MIN && reason.length <= SESSION_REASON_MAX ? reason : null;
}

function rpcError(error: { code?: string; message?: string }, fallback: string): string {
  if (error.code === "ES403") return "Dört göz onay izni bulunamadı ya da kullanıldı; işlem yapılmadı. Yeniden onaya gönderin.";
  if (error.code === "22023") return `Gerekçe ${SESSION_REASON_MIN}–${SESSION_REASON_MAX} karakter olmalı.`;
  if (error.code === "42501") return "Bu işlem için yetkiniz yok (üyeler modülünde yazma + süper admin ya da operasyon).";
  if (error.code === "P0002") return "Oturum ya da ofis kullanıcısı bulunamadı; zaten kapanmış olabilir.";
  if (error.code === "PGRST202" || error.code === "42883") return "Oturum fonksiyonları henüz kurulmadı (migration 20261027010100 bekliyor).";
  return fallback;
}

/** Denetim satırı için istek bağlamı (Traefik'in yazdığı IP + user agent); istek dışında null. */
async function requestMeta(): Promise<{ ip: string | null; ua: string | null }> {
  try {
    const h = await headers();
    return { ip: clientIpFrom(h), ua: h.get("user-agent")?.slice(0, 400) || null };
  } catch {
    return { ip: null, ua: null };
  }
}

function refresh(userId: string | null) {
  revalidatePath("/admin/ofis-oturumlari");
  if (userId) revalidatePath(`/admin/members/${userId}`);
}

/** Tek oturumu kapatır (ör. kaybolan cihaz). */
export async function closeOfficeSession(fd: FormData): Promise<OfficeSessionActionResult> {
  const gate = await guardPlatformAction({ module: "members", roles: ["super_admin", "ops"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const sessionId = String(fd.get("session_id") ?? "").trim();
  if (!UUID_RE.test(sessionId)) return { error: "Oturum kimliği geçersiz." };
  const reason = readReason(fd);
  if (!reason) return { error: `Gerekçe ${SESSION_REASON_MIN}–${SESSION_REASON_MAX} karakter olmalı.` };
  const step = await requireStepUp(fd, "session_revoke", gate.staff.id);
  if (!step.ok) return { error: step.error };

  const label = String(fd.get("label") ?? "").trim().slice(0, 120) || "Ofis kullanıcısı";
  const fourEyes = await sensitiveFourEyesGate({
    kind: "session_revoke",
    staffId: gate.staff.id,
    entityType: "auth_session",
    entityId: sessionId,
    binding: { session_id: sessionId },
    summary: `Tek oturumu kapat: ${label} · ${reason}`,
    deferConsume: true,
  });
  if (!fourEyes.proceed) return "queued" in fourEyes ? { notice: fourEyes.notice } : { error: fourEyes.error };

  // Tüm kapılar geçti: service istemcisi YALNIZ burada kurulur (RPC authenticated'a kapalı).
  const req = await requestMeta();
  const { data, error } = await createAdminClient().rpc("platform_revoke_office_session", {
    p_session_id: sessionId,
    p_actor_staff_id: gate.staff.id,
    p_reason: reason,
    p_approval_id: fourEyes.approvalId,
    p_ip: req.ip,
    p_user_agent: req.ua,
  });
  if (error) return { error: rpcError(error, "Oturum kapatılamadı; birkaç saniye sonra tekrar deneyin ya da sorun sürerse Sistem durumu > Hata kayıtları ekranına bakın.") };
  const row = (Array.isArray(data) ? data[0] : data) as { user_id?: string; tenant_id?: string } | null;
  const userId = row?.user_id ?? null;
  refresh(userId);
  return { ok: true, count: 1 };
}

/** Kullanıcının tüm oturumlarını kapatır (parola/cihaz kaybı, şüpheli giriş). */
export async function closeOfficeUserSessions(fd: FormData): Promise<OfficeSessionActionResult> {
  const gate = await guardPlatformAction({ module: "members", roles: ["super_admin", "ops"], rate: RATE });
  if ("error" in gate) return { error: gate.error };
  const userId = String(fd.get("user_id") ?? "").trim();
  if (!UUID_RE.test(userId)) return { error: "Kullanıcı kimliği geçersiz." };
  const reason = readReason(fd);
  if (!reason) return { error: `Gerekçe ${SESSION_REASON_MIN}–${SESSION_REASON_MAX} karakter olmalı.` };
  const step = await requireStepUp(fd, "session_revoke", gate.staff.id);
  if (!step.ok) return { error: step.error };

  const label = String(fd.get("label") ?? "").trim().slice(0, 120) || "Ofis kullanıcısı";
  // Üye ayrıntısındaki "Oturumları kapat" ile AYNI bağ (profile + id): onay hangi ekrandan istenirse istensin bir kez kullanılır.
  const fourEyes = await sensitiveFourEyesGate({
    kind: "session_revoke",
    staffId: gate.staff.id,
    entityType: "profile",
    entityId: userId,
    binding: { id: userId },
    summary: `Tüm oturumları kapat: ${label} · ${reason}`,
    deferConsume: true,
  });
  if (!fourEyes.proceed) return "queued" in fourEyes ? { notice: fourEyes.notice } : { error: fourEyes.error };

  const req = await requestMeta();
  const { data, error } = await createAdminClient().rpc("platform_revoke_office_user_sessions", {
    p_user_id: userId,
    p_actor_staff_id: gate.staff.id,
    p_reason: reason,
    p_approval_id: fourEyes.approvalId,
    p_ip: req.ip,
    p_user_agent: req.ua,
  });
  if (error) return { error: rpcError(error, "Oturumlar kapatılamadı; birkaç saniye sonra tekrar deneyin ya da sorun sürerse Sistem durumu > Hata kayıtları ekranına bakın.") };
  const count = Number(data ?? 0) || 0;
  refresh(userId);
  return { ok: true, count };
}
