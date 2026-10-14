"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { getSetting } from "@/lib/settings/read";
import { KVKK_SETTING_KEYS } from "@/lib/settings/registry/kvkk";
import { sendTemplateEmail } from "@/lib/email/send";
import { logPlatformActivity } from "@/lib/platform-activity";
import { emailSchema, optionalPhoneSchema } from "@/lib/validation/contact";
import { parseApplication, submitApplication, verifyApplication, hashEmail } from "@/lib/compliance/platform-kvkk-service";

/**
 * KVKK BAŞVURU FORMU (herkese açık, /kvkk-basvuru; DG6). Oturum YOK: service_role ile yalnız `platform_kvkk_requests`
 * satırı yazılır (tablo politikasız, anon erişemez). Koruma: honeypot + IP ve e-posta başına hız sınırı (altyapı
 * yoksa REDDEDER) + e-posta doğrulama kodu (30 dk, 5 deneme). Doğrulanmayan başvuru kuyruğa düşmez ve 7 günde silinir.
 * Denetim izi: platform_audit_logs (personel yok: actor null; kişisel veri yazılmaz, yalnız başvuru no ve tür).
 */

export type KvkkApplyResult = { ok?: boolean; error?: string; requestId?: string; ref?: string; maskedEmail?: string; resent?: boolean };
export type KvkkVerifyResult = { ok?: boolean; error?: string; ref?: string; restart?: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUSY = "Çok fazla istek. Lütfen biraz sonra tekrar deneyin.";

async function formOpen(): Promise<boolean> {
  try {
    return (await getSetting<boolean>(KVKK_SETTING_KEYS.publicFormEnabled)) !== false;
  } catch {
    return true; // ayar okunamazsa başvuru kanalı açık kalır (yasal yükümlülük)
  }
}

export async function submitKvkkApplication(fd: FormData): Promise<KvkkApplyResult> {
  // Honeypot: botlar gizli alanı doldurur; sessizce "gönderildi" davranılır, kayıt açılmaz.
  if (String(fd.get("website") ?? "").trim()) return { ok: true, requestId: "", ref: "", maskedEmail: "" };
  if (!(await formOpen())) return { error: "Başvuru formu şu an kapalı. Lütfen destek e-posta adresimize yazın." };

  // İletişim alanları tek merkez doğrulayıcıdan (saklama biçimi); kalan kurallar parseApplication'da.
  const email = emailSchema.safeParse(String(fd.get("email") ?? ""));
  if (!email.success) return { error: email.error.issues[0]?.message ?? "Geçerli bir e-posta adresi girin." };
  const phone = optionalPhoneSchema.safeParse(String(fd.get("phone") ?? ""));
  if (!phone.success) return { error: phone.error.issues[0]?.message ?? "Geçerli bir telefon numarası girin." };
  const parsed = parseApplication({
    type: fd.get("request_type"),
    name: fd.get("full_name"),
    email: email.data,
    phone: phone.data ?? "",
    officeHint: fd.get("office_hint"),
    details: fd.get("details"),
    consent: String(fd.get("consent") ?? "") === "on",
  });
  if (!parsed.ok) return { error: parsed.error };

  const ip = await clientIp();
  const [byIp, byEmail] = await Promise.all([
    checkRateLimit(`kvkk-basvuru:ip:${ip}`, { limit: 5, windowSec: 3600, failurePolicy: "deny" }),
    checkRateLimit(`kvkk-basvuru:eposta:${hashEmail(parsed.value.email)}`, { limit: 4, windowSec: 3600, failurePolicy: "deny" }),
  ]);
  if (!byIp.allowed || !byEmail.allowed) return { error: BUSY };

  const res = await submitApplication(createAdminClient(), parsed.value, { nowMs: now(), send: sendTemplateEmail });
  if (!res.ok) return { error: res.error };
  await logPlatformActivity({
    actorId: null,
    action: res.resent ? "kvkk.public.code_resent" : "kvkk.public.submitted",
    entityType: "kvkk_request",
    entityId: res.requestId,
    meta: { ref: res.ref, request_type: parsed.value.type },
  });
  return { ok: true, requestId: res.requestId, ref: res.ref, maskedEmail: res.maskedEmail, resent: res.resent };
}

export async function verifyKvkkApplication(fd: FormData): Promise<KvkkVerifyResult> {
  const requestId = String(fd.get("request_id") ?? "").trim();
  const code = String(fd.get("code") ?? "");
  if (!UUID_RE.test(requestId)) return { error: "Başvuru bulunamadı. Formu yeniden gönderin.", restart: true };

  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`kvkk-dogrula:${ip}`, { limit: 20, windowSec: 3600, failurePolicy: "deny" });
  if (!allowed) return { error: BUSY };

  const res = await verifyApplication(createAdminClient(), { requestId, code }, now());
  if (!res.ok) return { error: res.error, restart: res.exhausted === true };
  if (!res.already) {
    await logPlatformActivity({
      actorId: null,
      action: "kvkk.public.verified",
      entityType: "kvkk_request",
      entityId: requestId,
      meta: { ref: res.ref, due_at: res.dueAt },
    });
  }
  return { ok: true, ref: res.ref };
}
