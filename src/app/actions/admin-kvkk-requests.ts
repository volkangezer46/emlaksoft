"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity, logPlatformActivityChecked } from "@/lib/platform-activity";
import { requireStepUp } from "@/lib/platform-security/step-up";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { sendTemplateEmail } from "@/lib/email/send";
import {
  applyErasure,
  assignRequest,
  preparePackage,
  recordIdentityCheck,
  respondAndClose,
} from "@/lib/compliance/platform-kvkk-service";
import { PLATFORM_KVKK_OUTCOMES, type PlatformKvkkOutcome } from "@/lib/compliance/platform-kvkk";

/**
 * PLATFORM KVKK BAŞVURU ADIMLARI (admin; DG6). Kapı: `tickets` modülü (destek, operasyon, süper admin; faturalama
 * rolü de destek personelidir). Silme kritik işlemdir: AD11 yeniden doğrulama (`kvkk_erasure`) + denetim kaydı ÖNCE
 * yazılır (fail-closed). Her adım platform_audit_logs'a `kvkk.request.*` olarak düşer (kişisel veri yazılmaz: başvuru
 * no, tür, sonuç sayıları). İş kuralı ve DB yazımı `platform-kvkk-service.ts`'tedir.
 */

export type AdminKvkkResult = { ok?: boolean; error?: string; message?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idOf(fd: FormData): string | null {
  const id = String(fd.get("id") ?? "").trim();
  return UUID_RE.test(id) ? id : null;
}

function refresh(id: string) {
  revalidatePath("/admin/tickets/kvkk");
  revalidatePath(`/admin/tickets/kvkk/${id}`);
}

/** Kimlik doğrulama sonucu: verified | failed + yöntem + not. */
export async function recordKvkkIdentity(fd: FormData): Promise<AdminKvkkResult> {
  const staff = await requirePlatformModule("tickets");
  const id = idOf(fd);
  if (!id) return { error: "Geçersiz istek." };
  const result = String(fd.get("result") ?? "") === "failed" ? "failed" : "verified";
  const res = await recordIdentityCheck(
    createAdminClient(),
    id,
    staff.id,
    { result, method: String(fd.get("method") ?? ""), note: String(fd.get("note") ?? "") },
    now(),
  );
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({
    actorId: staff.id,
    action: "kvkk.request.identity",
    entityType: "kvkk_request",
    entityId: id,
    meta: { ref: res.row.ref, result, method: res.row.identity_method },
  });
  refresh(id);
  return { ok: true, message: result === "verified" ? "Kimlik doğrulandı." : "Kimlik doğrulanamadı olarak kaydedildi." };
}

/** Kişiye ait kayıtları tarar, özeti kaydeder; dosya Raporlar > "KVKK veri paketi"nden başvuru no ile alınır. */
export async function prepareKvkkPackage(fd: FormData): Promise<AdminKvkkResult> {
  const staff = await requirePlatformModule("tickets");
  const id = idOf(fd);
  if (!id) return { error: "Geçersiz istek." };
  const { allowed } = await checkRateLimit(`admin-kvkk-paket:${staff.id}`, { limit: 30, windowSec: 3600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla tarama yapıldı. Biraz sonra tekrar deneyin." };
  const res = await preparePackage(createAdminClient(), id, staff.id, now());
  if (!res.ok) return { error: res.error };
  const s = res.summary;
  await logPlatformActivity({
    actorId: staff.id,
    action: "kvkk.request.package",
    entityType: "kvkk_request",
    entityId: id,
    meta: { ref: res.row.ref, customers: s.customers, offices: s.offices, demo_requests: s.demoRequests, visitors: s.visitors, legal_holds: s.legalHolds.length },
  });
  refresh(id);
  const total = s.customers + s.demoRequests + s.visitors;
  return { ok: true, message: total > 0 ? `${total} kayıt bulundu; veri paketi hazır.` : "Eşleşen kayıt bulunmadı; paket boş olarak kaydedildi." };
}

/** Silme başvurusunu uygular (mevcut anonimleştirme akışı). Kritik: doğrulayıcı kodu + önce denetim kaydı. */
export async function applyKvkkErasure(fd: FormData): Promise<AdminKvkkResult> {
  const staff = await requirePlatformModule("tickets");
  const id = idOf(fd);
  if (!id) return { error: "Geçersiz istek." };
  if (String(fd.get("confirm") ?? "") !== "on") return { error: "Geri alınamaz işlemi onaylayın." };
  const stepUp = await requireStepUp(fd, "kvkk_erasure", staff.id);
  if (!stepUp.ok) return { error: stepUp.error };
  // Fail-closed: denetim satırı yazılamazsa silme yapılmaz.
  const audit = await logPlatformActivityChecked({
    actorId: staff.id,
    action: "kvkk.request.erasure_started",
    entityType: "kvkk_request",
    entityId: id,
  });
  if (!audit.ok) return { error: "Denetim kaydı yazılamadı; silme yapılmadı. Kısa süre sonra tekrar deneyin." };

  const res = await applyErasure(createAdminClient(), id, staff.id, now());
  if (!res.ok) return { error: res.error };
  const r = res.result;
  await logPlatformActivity({
    actorId: staff.id,
    action: "kvkk.request.erasure",
    entityType: "kvkk_request",
    entityId: id,
    meta: { ref: res.row.ref, anonymized: r.anonymized, already: r.already, failed: r.failed.length, demo_requests: r.demoRequests, visitors: r.visitors, retained: r.retained.length },
  });
  refresh(id);
  if (r.failed.length > 0) return { error: `${r.failed.length} kayıtta anonimleştirme yapılamadı; ayrıntı aşağıda. Sorun giderilince yeniden uygulayın.` };
  return { ok: true, message: `${r.anonymized + r.demoRequests + r.visitors} kayıt anonimleştirildi${r.already ? ` (${r.already} kayıt zaten anonimdi)` : ""}.` };
}

/** Yanıt (AD7 kvkk_reply) + sonuç kaydı: completed | rejected. */
export async function respondKvkkRequest(fd: FormData): Promise<AdminKvkkResult> {
  const staff = await requirePlatformModule("tickets");
  const id = idOf(fd);
  if (!id) return { error: "Geçersiz istek." };
  const outcome = String(fd.get("outcome") ?? "") as PlatformKvkkOutcome;
  if (!(PLATFORM_KVKK_OUTCOMES as readonly string[]).includes(outcome)) return { error: "Sonucu seçin." };
  const sendEmail = String(fd.get("yanit_gonder") ?? "") === "on";
  const res = await respondAndClose(
    createAdminClient(),
    id,
    staff.id,
    { outcome, text: String(fd.get("response") ?? ""), sendEmail },
    { nowMs: now(), send: sendTemplateEmail },
  );
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({
    actorId: staff.id,
    action: "kvkk.request.closed",
    entityType: "kvkk_request",
    entityId: id,
    meta: { ref: res.row.ref, outcome, delivery: res.delivery ?? "baska_kanal" },
  });
  refresh(id);
  return { ok: true, message: res.delivery ? "Yanıt gönderildi ve başvuru sonuçlandı." : "Sonuç kaydedildi (yanıt başka kanalla iletildi)." };
}

/** Başvuruyu üstlen (ya da bırak). */
export async function assignKvkkRequest(fd: FormData): Promise<AdminKvkkResult> {
  const staff = await requirePlatformModule("tickets");
  const id = idOf(fd);
  if (!id) return { error: "Geçersiz istek." };
  const release = String(fd.get("release") ?? "") === "1";
  const res = await assignRequest(createAdminClient(), id, release ? null : staff.id, now());
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({ actorId: staff.id, action: release ? "kvkk.request.released" : "kvkk.request.assigned", entityType: "kvkk_request", entityId: id });
  refresh(id);
  return { ok: true, message: release ? "Başvuru bırakıldı." : "Başvuru size atandı." };
}
