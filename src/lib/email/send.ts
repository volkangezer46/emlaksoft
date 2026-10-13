import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/read";
import { EMAIL_FOOTER_KEY } from "@/lib/settings/registry/email";
import { sendEmail, type EmailSendResult } from "./provider";
import { DEFAULT_EMAIL_FOOTER, renderBrandedHtml, renderTemplate, templateDef, templateSettingKey, type EmailTemplateKey } from "./templates";

/**
 * GÜNLÜKLÜ GÖNDERİM (AD7): uygulamadaki her e-posta buradan geçer (`sendLoggedEmail` / `sendTemplateEmail`).
 * Sıra: (1) bastırma listesi (bounce/şikâyet/elle) → eşleşirse İSTEK ATILMAZ, günlüğe `suppressed`;
 * (2) sağlayıcı (`provider.ts`) → kanal kapalıysa istek atılmaz, günlüğe `disabled` ("kanal kapalı"; sahte gönderim yok);
 * kabul edilirse `sent` + sağlayıcı kimliği (webhook teslim/bounce/şikâyet/açılmayı bu kimlikle işler), hata `failed`.
 * Alıcı adresi DÜZ SAKLANMAZ: maskeli gösterim + SHA-256 özeti. Gövde saklanmaz. Günlük tablosu yoksa (migration
 * 20261013004600 öncesi) gönderim sürer, kayıt sessizce atlanır.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Küçük harfe çevrilmiş adresin SHA-256 özeti (bastırma eşleşmesi). */
export function emailHash(email: string): string {
  return createHash("sha256").update(normalizeEmail(email), "utf8").digest("hex");
}

/** "ayse.yilmaz@ornek.com" → "ay***@ornek.com" (alan adı korunur; yerel kısımdan en çok 2 karakter). */
export function maskEmail(email: string): string {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = e.slice(0, at);
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}***${e.slice(at)}`.slice(0, 120);
}

export type LoggedSendResult = EmailSendResult | { ok: false; code: "suppressed"; error: string };

export type LoggedSendInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Şablon anahtarı ya da serbest etiket ("test" vb.). */
  template: string;
  /** Gönderen akış (cron adı, "admin_test" ...). */
  source: string;
  /** E-postanın ilgili olduğu ofis (Ofis 360 "İletişim"); yoksa null. */
  tenantId?: string | null;
  /** Platform personeli tetiklediyse. */
  actorId?: string | null;
};

const SUPPRESSED_ERROR = "Adres bastırma listesinde (bounce/şikâyet); gönderim engellendi.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bastırma listesinde mi? Tablo yok/okuma hatası = bastırılmamış (gönderim akışı kilitlenmez). */
export async function isSuppressedHash(admin: SupabaseClient, hash: string): Promise<boolean> {
  try {
    const { data, error } = await admin.from("email_suppressions").select("id").eq("email_hash", hash).limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

export async function sendLoggedEmail(input: LoggedSendInput): Promise<LoggedSendResult> {
  const to = input.to.trim();
  const hash = emailHash(to);
  let admin: SupabaseClient | null = null;
  try {
    admin = createAdminClient();
  } catch {
    admin = null; // ortam eksik (test/önizleme): günlük ve bastırma atlanır, gönderim kuralı aynı
  }

  const suppressed = admin ? await isSuppressedHash(admin, hash) : false;
  const res: LoggedSendResult = suppressed
    ? { ok: false, code: "suppressed", error: SUPPRESSED_ERROR }
    : await sendEmail({ to, subject: input.subject, text: input.text, html: input.html });

  if (admin) {
    const status = res.ok ? "sent" : res.code === "suppressed" ? "suppressed" : res.code === "disabled" ? "disabled" : "failed";
    const row = {
      tenant_id: input.tenantId && UUID_RE.test(input.tenantId) ? input.tenantId : null,
      template: input.template.slice(0, 64) || "serbest",
      source: input.source.slice(0, 64) || "system",
      to_hash: hash,
      to_masked: maskEmail(to),
      subject: input.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200),
      status,
      provider_id: res.ok ? res.id : null,
      error: res.ok ? null : res.error.slice(0, 300),
      actor_id: input.actorId && UUID_RE.test(input.actorId) ? input.actorId : null,
    };
    try {
      const { error } = await admin.from("email_sends").insert(row);
      if (error && error.code !== "42P01" && error.code !== "PGRST205") console.error("email_sends insert", error.code);
    } catch {
      // günlük yazılamadı: gönderim sonucu yine döner
    }
  }
  return res;
}

/** Şablonun panelde kayıtlı konu/gövdesi + ortak alt bilgi (yoksa varsayılan). */
export async function loadTemplateText(key: EmailTemplateKey): Promise<{ subject: string; body: string; footer: string }> {
  const def = templateDef(key);
  const sk = templateSettingKey(key, "subject");
  const bk = templateSettingKey(key, "body");
  const s = await getSettings(def.authType ? [bk, EMAIL_FOOTER_KEY] : [sk, bk, EMAIL_FOOTER_KEY]).catch(() => ({}) as Record<string, unknown>);
  return {
    subject: String(s[sk] ?? def.defaultSubject),
    body: String(s[bk] ?? def.defaultBody),
    footer: String(s[EMAIL_FOOTER_KEY] ?? DEFAULT_EMAIL_FOOTER),
  };
}

/** Konu + düz metin + markalı HTML (SAF; önizleme ve gönderim aynı işlevi kullanır). */
export function composeTemplateEmail(
  key: EmailTemplateKey,
  text: { subject: string; body: string; footer: string },
  vars: Record<string, string | number>,
): { subject: string; text: string; html: string } {
  const subject = renderTemplate(text.subject, vars, { singleLine: true });
  return {
    subject,
    text: `${renderTemplate(text.body, vars)}\n\n--\n${text.footer}`,
    html: renderBrandedHtml({ title: subject || templateDef(key).label, body: text.body, vars, footer: text.footer }),
  };
}

/**
 * Katalogdaki bir şablonla günlüklü gönderim. Auth şablonları burada GÖNDERİLMEZ (GoTrue gönderir).
 * Diğer paketler (tahsilat kademeleri, makbuz, destek yanıtı ...) bu işlevi çağırır.
 */
export async function sendTemplateEmail(input: {
  key: EmailTemplateKey;
  to: string;
  vars: Record<string, string | number>;
  source: string;
  tenantId?: string | null;
  actorId?: string | null;
  subjectPrefix?: string;
}): Promise<LoggedSendResult> {
  const def = templateDef(input.key);
  if (!def || def.authType) return { ok: false, code: "invalid", error: "Bu şablon uygulama içinden gönderilmez." };
  const mail = composeTemplateEmail(input.key, await loadTemplateText(input.key), input.vars);
  return sendLoggedEmail({
    to: input.to,
    subject: `${input.subjectPrefix ?? ""}${mail.subject}`,
    text: mail.text,
    html: mail.html,
    template: input.key,
    source: input.source,
    tenantId: input.tenantId ?? null,
    actorId: input.actorId ?? null,
  });
}
