/**
 * Açık API anahtarı + giden webhook (SAF; yalnız sunucuda import edilir — node:crypto). Şema: 20261007000320.
 *
 * GÜVENLİK KURALLARI (testle kilitli):
 *  - API anahtarı SAKLANMAZ: yalnız sha256 özeti (`hashApiKey`) + görünür ön ek. Anahtar oluşturma anında BİR KEZ gösterilir.
 *  - Webhook imza sırrı SAKLANMAZ: `WEBHOOK_SIGNING_SECRET` (sunucu) + uç kimliği + sürümden HMAC ile türetilir;
 *    sürüm artırılınca (yenile) eski sır geçersiz olur. Ortam değişkeni yoksa webhook kanalı KAPALI.
 *  - İmza: `X-EmlakSoft-Signature: t=<unix>,v1=<hex(HMAC_SHA256(sır, t + "." + gövde))>` (zaman damgası tekrar saldırısına karşı).
 *  - Hedef URL yalnız https, IP literal / localhost / iç alan adı YOK; DNS yeniden bağlama teslim anında `safe-delivery.ts`
 *    ile engellenir (çözülen her adres denetlenir, soket yalnız denetlenen adrese açılır).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { isApiResource, isWebhookEvent, type ApiResource, type WebhookEvent } from "@/lib/integrations-api/labels";
export {
  API_RESOURCES,
  API_RESOURCE_LABELS,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  isApiResource,
  isWebhookEvent,
  type ApiResource,
  type WebhookEvent,
} from "@/lib/integrations-api/labels";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function randomToken(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += B32[bytes[i] % 32];
  return out;
}

/** Yeni anahtar: `es_<8>_<32>`; ön ek DB deseni `^es_[a-z0-9]{8}$`. */
export function generateApiKey(): { key: string; prefix: string } {
  const prefix = `es_${randomToken(8)}`;
  return { key: `${prefix}_${randomToken(32)}`, prefix };
}

export const API_KEY_PATTERN = /^es_[a-z2-7]{8}_[a-z2-7]{32}$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** `Authorization: Bearer es_...` başlığından anahtar (biçim dışıysa null). */
export function parseBearerKey(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header ?? "").trim());
  return m && API_KEY_PATTERN.test(m[1]) ? m[1] : null;
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|metadata\.google\.internal)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Webhook hedefi doğrulama (DB CHECK'ten sıkı): https, standart port, IP literal ve iç alan adı yok. */
export function validateWebhookUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 500) return { ok: false, error: "Geçerli bir https adresi girin (en çok 500 karakter)." };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "Geçerli bir https adresi girin." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Webhook adresi https olmalı." };
  if (u.username || u.password) return { ok: false, error: "Adreste kullanıcı adı/parola olamaz." };
  if (u.port && u.port !== "443") return { ok: false, error: "Yalnız standart https portu (443) kullanılabilir." };
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || PRIVATE_HOST.test(host) || IPV4.test(host) || host.startsWith("[")) {
    return { ok: false, error: "Webhook adresi herkese açık bir alan adı olmalı (IP adresi veya iç ağ adresi kabul edilmez)." };
  }
  if (/\s/.test(s)) return { ok: false, error: "Adreste boşluk olamaz." };
  u.hash = "";
  return { ok: true, url: u.toString() };
}

export function parseWebhookEvents(raw: readonly unknown[]): WebhookEvent[] {
  return [...new Set(raw.filter(isWebhookEvent))];
}
export function parseApiScopes(raw: readonly unknown[]): ApiResource[] {
  return [...new Set(raw.filter(isApiResource))];
}

/** Sunucu sırrı yeterince uzun mu (≥32)? Değilse webhook kanalı kapalı sayılır. */
export function signingSecretReady(serverSecret: string | null | undefined): serverSecret is string {
  return typeof serverSecret === "string" && serverSecret.length >= 32;
}

/** Uç başına imza sırrı (saklanmaz; her seferinde türetilir). */
export function deriveEndpointSecret(serverSecret: string, endpointId: string, version: number): string {
  return `whsec_${createHmac("sha256", serverSecret).update(`webhook:${endpointId}:${version}`).digest("hex")}`;
}

export function signWebhookBody(secret: string, unixSeconds: number, body: string): string {
  const v1 = createHmac("sha256", secret).update(`${unixSeconds}.${body}`).digest("hex");
  return `t=${unixSeconds},v1=${v1}`;
}

/** Alıcı tarafı doğrulama örneği (belgelerde ve testte kullanılır). */
export function verifyWebhookSignature(secret: string, header: string, body: string, nowSeconds: number, toleranceSeconds = 300): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  const t = Number(m[1]);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = signWebhookBody(secret, t, body).split("v1=")[1];
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(m[2], "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
