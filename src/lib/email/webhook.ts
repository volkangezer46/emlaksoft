import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { getSecret } from "@/lib/settings/read";
import { EMAIL_WEBHOOK_SECRET_KEY } from "@/lib/settings/registry/email";
import { emailHash, maskEmail } from "./send";

/**
 * Resend webhook'u (Svix imzalı): teslim, gecikme, bounce, şikâyet, açılma, tıklama ve hata olayları gönderim
 * günlüğüne (email_sends) işlenir; her olay email_events'e svix-id ile BİR KEZ yazılır (yeniden deneme idempotent).
 * Bounce (Transient olmayan) ve şikâyet olan adres bastırma listesine girer: aynı adrese sonraki gönderim
 * `sendLoggedEmail` tarafından engellenir ve günlüğe "bastırıldı" yazılır.
 * İmza anahtarı: RESEND_WEBHOOK_SECRET (öncelikli) > panel (`email.resend_webhook_secret`, şifreli) > yok (503).
 */

/** İmza zaman toleransı (Svix önerisi 5 dk). */
export const WEBHOOK_TOLERANCE_SEC = 5 * 60;

/** Svix imza doğrulaması (SAF): `v1,<base64(HMAC-SHA256(secret, "<id>.<ts>.<body>"))>` listesinden biri eşleşmeli. */
export function verifySvixSignature(input: {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  secret: string;
  nowSec: number;
}): boolean {
  const { id, timestamp, signature, body, secret } = input;
  if (!id || !timestamp || !signature || !secret) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(input.nowSec - Number(timestamp)) > WEBHOOK_TOLERANCE_SEC) return false;
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`, "utf8").digest();
  for (const part of signature.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    let given: Buffer;
    try {
      given = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

export type EmailLogStatus = "sent" | "delivered" | "delayed" | "opened" | "clicked" | "bounced" | "complained" | "failed" | "suppressed" | "disabled";

const EVENT_STATUS: Record<string, EmailLogStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

/** Durum önceliği: geç gelen daha "zayıf" olay (ör. bounce sonrası açılma) durumu geri çekmez. */
const RANK: Record<EmailLogStatus, number> = {
  disabled: 0,
  suppressed: 0,
  sent: 1,
  delayed: 1.5,
  delivered: 2,
  opened: 3,
  clicked: 4,
  failed: 5,
  bounced: 6,
  complained: 7,
};

export function nextStatus(current: EmailLogStatus, incoming: EmailLogStatus): EmailLogStatus {
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0) ? incoming : current;
}

export type ResendEvent = {
  type: string;
  status: EmailLogStatus | null;
  providerId: string | null;
  to: string[];
  occurredAt: string | null;
  detail: string | null;
  /** Bastırma listesine girmeli mi (bounce Transient değilse, şikâyet her zaman). */
  suppress: "bounce" | "complaint" | null;
};

/** Resend olay gövdesi (SAF, savunmacı). Tanınmayan tür = status null (yok sayılır, yine 200). */
export function parseResendEvent(json: unknown): ResendEvent | null {
  if (!json || typeof json !== "object") return null;
  const o = json as { type?: unknown; created_at?: unknown; data?: Record<string, unknown> };
  if (typeof o.type !== "string" || o.type.length > 48) return null;
  const data = (o.data && typeof o.data === "object" ? o.data : {}) as Record<string, unknown>;
  const providerId = typeof data.email_id === "string" && data.email_id.length <= 120 ? data.email_id : null;
  const toRaw = Array.isArray(data.to) ? data.to : typeof data.to === "string" ? [data.to] : [];
  const to = toRaw.filter((x): x is string => typeof x === "string" && x.includes("@") && x.length <= 254).slice(0, 10);
  const bounce = (data.bounce && typeof data.bounce === "object" ? data.bounce : null) as { type?: unknown; message?: unknown } | null;
  const status = EVENT_STATUS[o.type] ?? null;
  const bounceType = typeof bounce?.type === "string" ? bounce.type : null;
  const detail =
    status === "bounced"
      ? [bounceType, typeof bounce?.message === "string" ? bounce.message : null].filter(Boolean).join(": ").slice(0, 300) || null
      : null;
  const suppress = status === "complained" ? "complaint" : status === "bounced" && bounceType?.toLowerCase() !== "transient" ? "bounce" : null;
  const occurredAt = typeof o.created_at === "string" && !Number.isNaN(Date.parse(o.created_at)) ? o.created_at : null;
  return { type: o.type, status, providerId, to, occurredAt, detail, suppress };
}

/** İmza anahtarı (sunucu içi). */
export async function resolveWebhookSecret(): Promise<string | null> {
  const env = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (env) return env;
  try {
    return (await getSecret(EMAIL_WEBHOOK_SECRET_KEY))?.trim() || null;
  } catch {
    return null;
  }
}

const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

export type ApplyResult = "applied" | "duplicate" | "ignored" | "not_installed" | "pending";

/**
 * Yarış penceresi: `sendLoggedEmail` günlük satırını sağlayıcı yanıtından SONRA yazar; webhook satırdan önce
 * gelebilir. Bu pencere içindeki durum olayı (email.sent hariç) satır bulunamazsa "pending" döner → uç 503 →
 * Resend yeniden dener (5 sn, 5 dk ...). Pencere dışı (ör. günlüklenmeyen GoTrue SMTP e-postası) send_id=null yazılır.
 */
export const PENDING_WINDOW_MS = 15 * 60 * 1000;

/**
 * Olayı işler: (1) gönderim satırının durumunu öncelik kuralıyla ilerlet; (2) bounce/şikâyette alıcıyı bastırma
 * listesine ekle (adres düz saklanmaz); (3) email_events'e svix-id ile yaz (çakışma = daha önce işlendi → duplicate).
 * (1) ve (2) idempotenttir; olay satırı EN SON yazılır ki ara hatada Resend'in yeniden denemesi işi tamamlasın.
 */
export async function applyResendEvent(eventId: string, ev: ResendEvent): Promise<ApplyResult> {
  if (!ev.status) return "ignored";
  const admin = createAdminClient();
  const at = ev.occurredAt ?? new Date(now()).toISOString();

  const { data: sendRows, error: sendErr } = ev.providerId
    ? await admin.from("email_sends").select("id, status, tenant_id, delivered_at, opened_at").eq("provider_id", ev.providerId).limit(1)
    : { data: [], error: null };
  if (sendErr) {
    if (MISSING_TABLE.has(sendErr.code ?? "")) return "not_installed";
    throw new Error(`email_sends read failed: ${sendErr.code}`);
  }
  const send = ((sendRows ?? []) as { id: string; status: EmailLogStatus; tenant_id: string | null; delivered_at: string | null; opened_at: string | null }[])[0] ?? null;

  if (send) {
    const status = nextStatus(send.status, ev.status);
    const patch: Record<string, unknown> = { last_event_at: at };
    if (status !== send.status) patch.status = status;
    if (ev.status === "delivered" && !send.delivered_at) patch.delivered_at = at;
    if ((ev.status === "opened" || ev.status === "clicked") && !send.opened_at) patch.opened_at = at;
    if (ev.detail) patch.error = ev.detail;
    const { error } = await admin.from("email_sends").update(patch).eq("id", send.id);
    if (error) throw new Error(`email_sends update failed: ${error.code}`);
  }

  const fresh = ev.occurredAt !== null && now() - Date.parse(ev.occurredAt) < PENDING_WINDOW_MS;
  const awaitRow = !send && ev.providerId !== null && ev.status !== "sent" && fresh;

  // Bastırma satırı bulunmasa da uygulanır (data.to kullanılır, idempotent).
  if (ev.suppress && ev.to.length > 0) {
    const rows = ev.to.map((addr) => ({
      email_hash: emailHash(addr),
      email_masked: maskEmail(addr),
      reason: ev.suppress,
      detail: ev.detail,
      source_send_id: send?.id ?? null,
    }));
    const { error } = await admin.from("email_suppressions").upsert(rows, { onConflict: "email_hash", ignoreDuplicates: true });
    if (error) throw new Error(`email_suppressions upsert failed: ${error.code}`);
  }
  // Olay satırı yazılmaz: yeniden denemede svix-id "duplicate" sayılmasın, durum satıra işlensin.
  if (awaitRow) return "pending";
  const { error: evErr } = await admin.from("email_events").insert({
    event_id: eventId.slice(0, 120),
    send_id: send?.id ?? null,
    provider_id: ev.providerId,
    type: ev.type,
    detail: ev.detail,
    occurred_at: at,
  });
  if (evErr) {
    if (evErr.code === "23505") return "duplicate";
    if (MISSING_TABLE.has(evErr.code ?? "")) return "not_installed";
    throw new Error(`email_events insert failed: ${evErr.code}`);
  }
  return "applied";
}
