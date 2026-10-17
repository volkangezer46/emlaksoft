"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guardPlatformAction } from "@/lib/platform-guards";
import { logPlatformActivity } from "@/lib/platform-activity";
import { requireStepUp } from "@/lib/platform-security/step-up";
import { sensitiveFourEyesGate } from "@/lib/platform-security/four-eyes";
import { SESSION_REASON_MAX, SESSION_REASON_MIN } from "@/lib/admin/ops/office-sessions";

/**
 * GÜVENLİK & VERİ > OFİS OTURUMLARI eylemleri: tek oturumu kapat / kullanıcının tüm oturumlarını kapat.
 * Her ikisi: members modülü (yaz) + süper admin ya da operasyon + hız sınırı (`guardPlatformAction`) + gerekçe
 * (10–300 karakter) + kritik işlem doğrulaması (`session_revoke`, TOTP) + isteğe bağlı dört göz onayı (ayar açıksa
 * başka bir süper adminin onayı bir kez tüketilir) + platform denetim kaydı. Yazım service_role DEĞİL, oturumlu
 * istemciyle SECURITY DEFINER RPC'lerden geçer (RPC çağıranın yetkisini yeniden denetler; yalnız ofis kullanıcısı
 * hedeflenir, belirteç hiçbir yerde okunmaz ya da yazılmaz).
 */

export type OfficeSessionActionResult = { ok?: boolean; error?: string; notice?: string; count?: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE = { key: "admin-office-sessions", limit: 20, windowSec: 600 } as const;

function readReason(fd: FormData): string | null {
  const reason = String(fd.get("reason") ?? "").trim();
  return reason.length >= SESSION_REASON_MIN && reason.length <= SESSION_REASON_MAX ? reason : null;
}

function rpcError(error: { code?: string; message?: string }, fallback: string): string {
  if (error.code === "42501") return "Bu işlem için yetkiniz yok (üyeler modülünde yazma + süper admin ya da operasyon).";
  if (error.code === "P0002") return "Oturum ya da ofis kullanıcısı bulunamadı; zaten kapanmış olabilir.";
  if (error.code === "PGRST202" || error.code === "42883") return "Oturum fonksiyonları henüz kurulmadı (migration 20261025010000 bekliyor).";
  return fallback;
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
  });
  if (!fourEyes.proceed) return "queued" in fourEyes ? { notice: fourEyes.notice } : { error: fourEyes.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_revoke_office_session", { p_session_id: sessionId });
  if (error) return { error: rpcError(error, "Oturum kapatılamadı; birkaç saniye sonra tekrar deneyin ya da sorun sürerse Sistem durumu > Hata kayıtları ekranına bakın.") };
  const row = (Array.isArray(data) ? data[0] : data) as { user_id?: string; tenant_id?: string } | null;
  const userId = row?.user_id ?? null;

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_member.session_revoke_one",
    entityType: "profile",
    entityId: userId,
    meta: {
      tenant_id: row?.tenant_id ?? null,
      session: sessionId.slice(0, 8),
      reason,
      via: "ofis_oturumlari",
      ...(fourEyes.approvalId ? { four_eyes_approval_id: fourEyes.approvalId } : {}),
    },
  });
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
  });
  if (!fourEyes.proceed) return "queued" in fourEyes ? { notice: fourEyes.notice } : { error: fourEyes.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_revoke_office_user_sessions", { p_user_id: userId });
  if (error) return { error: rpcError(error, "Oturumlar kapatılamadı; birkaç saniye sonra tekrar deneyin ya da sorun sürerse Sistem durumu > Hata kayıtları ekranına bakın.") };
  const count = Number(data ?? 0) || 0;

  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "platform_member.sessions_revoke",
    entityType: "profile",
    entityId: userId,
    meta: { reason, count, via: "ofis_oturumlari", ...(fourEyes.approvalId ? { four_eyes_approval_id: fourEyes.approvalId } : {}) },
  });
  refresh(userId);
  return { ok: true, count };
}
