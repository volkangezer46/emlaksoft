import type { AnySettingDef } from "../types";
import { defineSecret, defineString } from "./define";
import { EMAIL_CHANNEL_HOME, EMAIL_HOME } from "./platform";
import { DEFAULT_EMAIL_FOOTER, EMAIL_TEMPLATES, hasEditableSubject, templateSettingKey, templateTextRule } from "@/lib/email/templates";

/**
 * E-POSTA ayarları (AD7; platform kapsamı, `platform_settings` deposu). Şablon konu/gövdeleri katalogdan
 * (`src/lib/email/templates.ts`) üretilir; tanımsız değişken içeren metin çapraz kuralla REDDEDİLİR. Auth şablonlarının
 * konusu GoTrue ortamından gelir (yalnız gövde ayarı vardır). Webhook imza anahtarı şifreli; yokken webhook 503 döner.
 */

const templateDefs: AnySettingDef[] = EMAIL_TEMPLATES.flatMap((t) => {
  const vars = t.variables.map((v) => `{${v}}`).join(", ");
  const rule = templateTextRule(t);
  const body: AnySettingDef = {
    ...defineString({
      key: templateSettingKey(t.key, "body"),
      home: EMAIL_HOME,
      default: t.defaultBody,
      maxLength: 4000,
      minLength: 10,
      multiline: true,
      category: "bildirim",
      label: `${t.label}: e-posta gövdesi`,
      description: `Düz metin (ortak marka yerleşimiyle HTML'e çevrilir). Değişkenler: ${vars}.`,
      impact: `Bu şablonla giden e-postaların metni değişir. Gönderen akış: ${t.usedBy}`,
    }),
    crossRule: rule,
  };
  if (!hasEditableSubject(t)) return [body];
  const subject: AnySettingDef = {
    ...defineString({
      key: templateSettingKey(t.key, "subject"),
      home: EMAIL_HOME,
      default: t.defaultSubject,
      maxLength: 200,
      minLength: 3,
      category: "bildirim",
      label: `${t.label}: e-posta konusu`,
      description: `Değişkenler: ${vars}.`,
      impact: `Bu şablonla giden e-postaların konu satırı değişir. Gönderen akış: ${t.usedBy}`,
    }),
    crossRule: rule,
  };
  return [subject, body];
});

export const EMAIL_FOOTER_KEY = "email.layout.footer";
export const EMAIL_WEBHOOK_SECRET_KEY = "email.resend_webhook_secret";

export const EMAIL_SETTING_DEFS: AnySettingDef[] = [
  ...templateDefs,
  defineString({
    key: EMAIL_FOOTER_KEY,
    home: EMAIL_HOME,
    default: DEFAULT_EMAIL_FOOTER,
    maxLength: 300,
    minLength: 10,
    category: "bildirim",
    label: "E-posta alt bilgisi",
    description: "Ortak marka yerleşiminin alt satırı (tüm işlemsel ve giriş e-postalarında). Düz metin.",
    impact: "Bir sonraki gönderimden itibaren tüm e-postaların alt bilgisi değişir.",
  }),
  defineSecret({
    key: EMAIL_WEBHOOK_SECRET_KEY,
    home: EMAIL_CHANNEL_HOME,
    maxLength: 200,
    minLength: 20,
    pattern: /^whsec_[A-Za-z0-9+/=]+$/,
    patternMessage: "Geçersiz biçim (whsec_ ile başlamalı; Resend > Webhooks > Signing secret).",
    category: "bildirim",
    label: "Resend webhook imza anahtarı",
    description:
      "Resend webhook'unun (https://emlaksoft.com.tr/api/webhooks/resend) imza anahtarı. Şifreli saklanır. Ortam değişkeni RESEND_WEBHOOK_SECRET tanımlıysa o önceliklidir.",
    impact: "Anahtar yoksa teslim/bounce/şikâyet/açılma olayları kabul edilmez; günlükte durum 'gönderildi'de kalır ve bounce adresler bastırılmaz.",
    envFallback: "RESEND_WEBHOOK_SECRET",
  }),
];
