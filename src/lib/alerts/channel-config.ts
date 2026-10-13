import { z } from "zod";
import { emailSchema } from "@/lib/validation/contact";

/**
 * Uyarı kanalı yapılandırması (SAF): doğrulama, maskeli özet ve webhook adres güvenliği.
 * Düz yapılandırma (bot belirteci, alıcı adresi, webhook adresi/sırrı) yalnız şifreli `config_sealed` içinde saklanır;
 * ekranda ve günlükte yalnız `targetHint` (maskeli) görünür.
 */

export const ALERT_CHANNEL_KINDS = ["telegram", "email", "webhook"] as const;
export type AlertChannelKind = (typeof ALERT_CHANNEL_KINDS)[number];

export const ALERT_CHANNEL_LABEL: Record<AlertChannelKind, string> = {
  telegram: "Telegram",
  email: "E-posta",
  webhook: "Webhook",
};

export type TelegramConfig = { kind: "telegram"; botToken: string; chatId: string };
export type EmailConfig = { kind: "email"; to: string };
export type WebhookConfig = { kind: "webhook"; url: string; secret: string | null };
export type AlertChannelConfig = TelegramConfig | EmailConfig | WebhookConfig;

const TELEGRAM_TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const TELEGRAM_CHAT_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/;

/** IPv4 özel/yerel aralıkları ve yerel adlar: webhook iç ağa yönlendirilemez (SSRF). */
export function isBlockedWebhookHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^[0-9.]+$/.test(h)) {
    const p = h.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p as [number, number, number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  // IPv6 sabitleri: yalnız açıkça genel adresler; döngü/yerel/özel önekler reddedilir.
  if (h.includes(":")) return h === "::1" || h === "::" || /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith("::ffff:");
  // Tek etiketli ad (ör. "supabase-db"): docker/iç DNS adı olabilir.
  return !h.includes(".");
}

export function parseWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Geçerli bir adres girin (https://…)." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Webhook adresi https:// ile başlamalı." };
  if (u.username || u.password) return { ok: false, error: "Adreste kullanıcı adı/parola olamaz; imza sırrını kullanın." };
  if (isBlockedWebhookHost(u.hostname)) return { ok: false, error: "İç ağ / yerel adreslere webhook gönderilemez." };
  if (u.port && !["443", "8443"].includes(u.port)) return { ok: false, error: "Yalnız 443 veya 8443 bağlantı noktası kabul edilir." };
  return { ok: true, url: u.toString() };
}

const nameSchema = z.string().trim().min(1, "Kanal adı boş olamaz.").max(80, "Kanal adı en çok 80 karakter.");

/** Formdan gelen ham alanları türe göre doğrular. */
export function parseChannelInput(input: {
  kind: string;
  name: string;
  botToken?: string;
  chatId?: string;
  email?: string;
  url?: string;
  secret?: string;
}): { ok: true; name: string; config: AlertChannelConfig } | { ok: false; error: string } {
  const name = nameSchema.safeParse(input.name ?? "");
  if (!name.success) return { ok: false, error: name.error.issues[0]?.message ?? "Kanal adı geçersiz." };
  if (input.kind === "telegram") {
    const botToken = (input.botToken ?? "").trim();
    const chatId = (input.chatId ?? "").trim();
    if (!TELEGRAM_TOKEN_RE.test(botToken)) return { ok: false, error: "Bot belirteci biçimi geçersiz (BotFather'ın verdiği 123456:ABC… değeri)." };
    if (!TELEGRAM_CHAT_RE.test(chatId)) return { ok: false, error: "Sohbet kimliği sayı (grup için -100…) veya @kanaladi olmalı." };
    return { ok: true, name: name.data, config: { kind: "telegram", botToken, chatId } };
  }
  if (input.kind === "email") {
    const to = emailSchema.safeParse(input.email ?? "");
    if (!to.success || to.data.length > 200) return { ok: false, error: "Geçerli bir e-posta adresi girin." };
    return { ok: true, name: name.data, config: { kind: "email", to: to.data } };
  }
  if (input.kind === "webhook") {
    const url = parseWebhookUrl(input.url ?? "");
    if (!url.ok) return url;
    if (url.url.length > 500) return { ok: false, error: "Adres en çok 500 karakter." };
    const secret = (input.secret ?? "").trim();
    if (secret && (secret.length < 16 || secret.length > 200)) return { ok: false, error: "İmza sırrı 16-200 karakter olmalı (boş bırakılabilir)." };
    return { ok: true, name: name.data, config: { kind: "webhook", url: url.url, secret: secret || null } };
  }
  return { ok: false, error: "Bilinmeyen kanal türü." };
}

/** Şifre çözüldükten sonra JSON'u tipli yapılandırmaya çevirir; bozuksa null. */
export function decodeChannelConfig(kind: string, json: string | null): AlertChannelConfig | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (kind === "telegram" && typeof v.botToken === "string" && typeof v.chatId === "string") {
      return { kind, botToken: v.botToken, chatId: v.chatId };
    }
    if (kind === "email" && typeof v.to === "string") return { kind, to: v.to };
    if (kind === "webhook" && typeof v.url === "string") {
      return { kind, url: v.url, secret: typeof v.secret === "string" && v.secret ? v.secret : null };
    }
  } catch {
    return null;
  }
  return null;
}

export function encodeChannelConfig(c: AlertChannelConfig): string {
  if (c.kind === "telegram") return JSON.stringify({ botToken: c.botToken, chatId: c.chatId });
  if (c.kind === "email") return JSON.stringify({ to: c.to });
  return JSON.stringify({ url: c.url, secret: c.secret });
}

/** Ekranda gösterilecek maskeli hedef (sır İÇERMEZ). */
export function channelTargetHint(c: AlertChannelConfig): string {
  if (c.kind === "telegram") {
    const id = c.chatId;
    return id.startsWith("@") ? `sohbet ${id}` : `sohbet …${id.slice(-4)}`;
  }
  if (c.kind === "email") {
    const [user, domain] = c.to.split("@");
    return `${(user ?? "").slice(0, 2)}•••@${domain ?? ""}`;
  }
  try {
    return `${new URL(c.url).hostname}${c.secret ? " · imzalı" : ""}`;
  } catch {
    return "webhook";
  }
}

/** Şifreleme AAD anahtarı (sunucu betiği scripts/sunucu/alert-send.py ile AYNI olmalı). */
export function channelSecretKey(id: string): string {
  return `alert_channel:${id}`;
}
