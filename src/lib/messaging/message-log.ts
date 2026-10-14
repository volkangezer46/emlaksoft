import { createHmac, hkdfSync } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { PLATFORM_SECRETS_DERIVE_SOURCES } from "@/lib/platform-secrets";
import { isDemoTenantId } from "@/lib/demo-sandbox";
import { DEMO_SANDBOX_CODE, DEMO_SANDBOX_MESSAGE } from "@/lib/demo-tenant";

/**
 * SMS VE WHATSAPP GÖNDERİM GÜNLÜĞÜ (SN3; e-posta günlüğünün eşi, `src/lib/email/send.ts`). Uygulamadaki her giden SMS ve
 * WhatsApp gönderimi sağlayıcı yanıtından sonra `message_sends`'e BİR satır yazar: kanal, hesap (platform/ofis), kitle
 * (ofisin kendisi / ofisin kişisi), kaynak akış, maskeli alıcı + özeti, sağlayıcı kimliği, durum, hata nedeni ve SMS kredi
 * boyu (maliyet). Teslim raporu (Netgsm, `/api/webhooks/netgsm-rapor`) ve Meta durum webhook'u (imzalı,
 * `/api/webhooks/meta`) durumu `applyMessageLogStatus` ile öncelik kuralına göre İLERLETİR.
 * Kişisel veri: numara düz saklanmaz, mesaj gövdesi hiç saklanmaz. Günlük EN İYİ ÇABADIR: tablo yoksa (migration
 * 20261014023000 öncesi) ya da yazma hatasında gönderim sonucu değişmez, kayıt sessizce atlanır.
 */

export type MessageChannel = "sms" | "whatsapp";
export type MessageLogStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "unknown";
export type MessageAudience = "office" | "contact";
export type MessageAccount = "platform" | "tenant";

/** Gönderimi çağıran akışın etiketi (Ofis 360 ve günlük ekranında okunur ad: `message-log-read.ts`). */
export type MessageLogContext = {
  source: string;
  tenantId?: string | null;
  audience?: MessageAudience;
};

/** Sağlayıcı sonucu: SMS (`jobid`) ve WhatsApp (`messageId`) sonuç tiplerinin ortak alt kümesi. */
export type ProviderSendOutcome = { ok: boolean; jobid?: string; messageId?: string; code?: string; error?: string };

/** Durum önceliği: geç gelen "zayıf" olay (ör. okunduktan sonra gelen "gönderildi") durumu geri çekmez. */
const RANK: Record<MessageLogStatus, number> = {
  unknown: 0,
  queued: 1,
  sent: 2,
  failed: 2.5,
  delivered: 3,
  read: 4,
};

export function nextMessageStatus(current: MessageLogStatus, incoming: MessageLogStatus): MessageLogStatus {
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0) ? incoming : current;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = new Set(["42P01", "PGRST205"]);

/** Numaranın E.164 rakamları (TR cep: 90XXXXXXXXXX; yabancı: + ve 00 öneki atılmış rakamlar). Geçersizse null. */
export function recipientDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return digits;
  if (digits.startsWith("0") && !digits.startsWith("00") && digits.length === 11) return `90${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 10) return `90${digits}`;
  const intl = digits.startsWith("00") ? digits.slice(2) : digits;
  return intl.length >= 8 && intl.length <= 15 ? intl : null;
}

const RECIPIENT_HKDF_SALT = "emlaksoft:message-log-recipient:v1";
const RECIPIENT_HKDF_INFO = "emlaksoft/message-log-recipient/v1";

/**
 * Alıcı özeti anahtarı: canlıda zaten zorunlu sunucu sırrından HKDF ile türetilmiş ALAN-AYRIMLI anahtar (phone-hash.ts deseni).
 * Düz SHA-256 kullanılmaz: TR cep numarası uzayı küçük (~10^10), maskeli alıcıyla birlikte saniyeler içinde çözülür.
 */
function recipientKey(): Buffer | null {
  for (const name of PLATFORM_SECRETS_DERIVE_SOURCES) {
    const secret = process.env[name]?.trim();
    if (!secret || secret.length < 24) continue;
    return Buffer.from(hkdfSync("sha256", secret, RECIPIENT_HKDF_SALT, RECIPIENT_HKDF_INFO, 32));
  }
  return null;
}

/**
 * Alıcı özeti (teslim raporundaki numarayı doğrulamak ve aynı alıcıyı süzmek için): E.164 rakamlarının HMAC-SHA256'sı.
 * Geçersiz numarada ya da sunucu anahtarı yoksa null (o satırda rapordaki numara denetimi atlanır).
 * UYARI: kaynak sır döndürülürse, döndürmeden önce gönderilip raporu henüz gelmemiş satırlarda numara "uyuşmaz" sayılır ve
 * o rapor işlenmez (kısa pencere; satır son durumunda kalır).
 */
export function recipientHash(raw: string): string | null {
  const d = recipientDigits(raw);
  if (!d) return null;
  const key = recipientKey();
  return key ? createHmac("sha256", key).update(d, "utf8").digest("hex") : null;
}

/** "05321234542" → "05** *** ** 42"; yabancı numara "+49*** 23". Yalnız son iki hane görünür. */
export function maskRecipient(raw: string): string {
  const d = recipientDigits(raw);
  if (!d) return "***";
  if (d.startsWith("90") && d.length === 12) return `0${d.slice(2, 3)}** *** ** ${d.slice(-2)}`;
  return `+${d.slice(0, 2)}*** ${d.slice(-2)}`;
}

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€\f";

/**
 * SMS kredi boyu (tahmini maliyet): yalnız GSM-7 karakterleri 160 (çok parçada 153), başka karakter (Türkçe ı/ş/ğ vb.)
 * varsa UCS-2: 70 (çok parçada 67). Netgsm raporu boy bildirirse günlükteki değer onunla güncellenir.
 */
export function smsSegments(text: string): number {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) septets += 1;
    else if (GSM7_EXT.includes(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (!text) return 0;
  if (gsm) return septets <= 160 ? 1 : Math.ceil(septets / 153);
  const units = [...text].length;
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

/** Sağlayıcı sonucunu günlük durumuna çevirir (SAF): kabul → kuyrukta; belirsiz → belirsiz; diğer hata → başarısız. */
export function outcomeStatus(result: ProviderSendOutcome): MessageLogStatus {
  if (result.ok) return "queued";
  return result.code === "unknown_provider_outcome" || result.code === "transport_error" ? "unknown" : "failed";
}

export type RecordMessageInput = {
  channel: MessageChannel;
  account: MessageAccount;
  context: MessageLogContext;
  to: string;
  result: ProviderSendOutcome;
  /** Yalnız SMS: kredi boyu (`smsSegments`). */
  segments?: number | null;
};

/** Gönderimi günlüğe yazar (EN İYİ ÇABA; asla fırlatmaz, gönderim sonucunu değiştirmez). */
export async function recordMessageSend(input: RecordMessageInput, client?: SupabaseClient | null): Promise<void> {
  try {
    let admin = client ?? null;
    if (!admin) {
      try {
        admin = createAdminClient();
      } catch {
        return; // ortam eksik (test/önizleme): günlük atlanır
      }
    }
    const providerId = (input.result.ok ? (input.result.jobid ?? input.result.messageId) : null)?.trim().slice(0, 512) || null;
    const tenantId = input.context.tenantId && UUID_RE.test(input.context.tenantId) ? input.context.tenantId : null;
    const { error } = await admin.from("message_sends").insert({
      tenant_id: tenantId,
      channel: input.channel,
      account: input.account,
      audience: input.context.audience ?? "contact",
      source: (input.context.source || "system").slice(0, 64),
      to_hash: recipientHash(input.to),
      to_masked: maskRecipient(input.to),
      status: outcomeStatus(input.result),
      provider_id: providerId,
      error_code: input.result.ok ? null : (input.result.code ?? null)?.slice(0, 64) ?? null,
      error: input.result.ok ? null : (input.result.error ?? null)?.slice(0, 300) ?? null,
      segments: input.channel === "sms" && typeof input.segments === "number" ? Math.min(100, Math.max(0, input.segments)) : null,
    });
    if (error && !MISSING.has(error.code ?? "")) console.error("[message-log] insert failed", { code: error.code });
  } catch {
    // Günlük hatası gönderimi etkilemez.
  }
}

/**
 * YD1 demo sandbox: demo kiracının gönderimi sağlayıcıya GİTMEZ; yerine başarısız sonuç döner ve günlüğe
 * `demo_sandbox` / "demo: gönderilmedi" yazılır (kampanya, otomasyon, kira hatırlatma, imza SMS'i dahil tüm akışlar
 * bu iki sarmalayıcıdan geçer). Demo değilse null.
 */
async function demoSandboxOutcome<T extends ProviderSendOutcome>(context: MessageLogContext): Promise<T | null> {
  if (!(await isDemoTenantId(context.tenantId))) return null;
  return { ok: false, code: DEMO_SANDBOX_CODE, error: DEMO_SANDBOX_MESSAGE } as T;
}

/** SMS gönderimini sarar: sağlayıcı çağrılır (demo kiracıda çağrılmaz), sonuç günlüğe yazılır, sonuç AYNEN döner. */
export async function withSmsLog<T extends ProviderSendOutcome>(
  account: MessageAccount,
  context: MessageLogContext,
  to: string,
  text: string,
  send: () => Promise<T>,
): Promise<T> {
  const result = (await demoSandboxOutcome<T>(context)) ?? (await send());
  await recordMessageSend({ channel: "sms", account, context, to, result, segments: smsSegments(text) });
  return result;
}

/** WhatsApp gönderimini sarar (maliyet satırı yok: Meta konuşma bazlı ücretlendirir). */
export async function withWhatsAppLog<T extends ProviderSendOutcome>(
  account: MessageAccount,
  context: MessageLogContext,
  to: string,
  send: () => Promise<T>,
): Promise<T> {
  const result = (await demoSandboxOutcome<T>(context)) ?? (await send());
  await recordMessageSend({ channel: "whatsapp", account, context, to, result });
  return result;
}

export type MessageStatusUpdate = {
  channel: MessageChannel;
  providerId: string;
  status: MessageLogStatus;
  occurredAt?: string | null;
  errorCode?: string | null;
  error?: string | null;
  /** Raporda numara varsa: günlükteki özetle eşleşmezse güncelleme yapılmaz. */
  to?: string | null;
  segments?: number | null;
  pricingCategory?: string | null;
};

export type MessageStatusApplyResult = "applied" | "unchanged" | "not_found" | "mismatch" | "not_installed";

type SendRow = {
  id: string;
  tenant_id: string | null;
  status: MessageLogStatus;
  to_hash: string | null;
  delivered_at: string | null;
  read_at: string | null;
};

/**
 * Sağlayıcı durum olayını günlüğe işler (idempotent): satır sağlayıcı kimliğiyle bulunur, durum öncelik kuralıyla ilerler,
 * teslim/okunma zamanı ilk kez yazılır, başarısızlıkta hata nedeni eklenir. Yarışta (eşzamanlı iki olay) iyimser kilit:
 * güncelleme okunan duruma koşulludur, tutmazsa bir kez yeniden okunur.
 */
export async function applyMessageLogStatus(u: MessageStatusUpdate, client?: SupabaseClient | null): Promise<MessageStatusApplyResult> {
  let admin = client ?? null;
  if (!admin) {
    try {
      admin = createAdminClient();
    } catch {
      return "not_installed"; // ortam eksik (test/önizleme)
    }
  }
  const providerId = u.providerId.trim().slice(0, 512);
  if (!providerId) return "not_found";
  const at = u.occurredAt && !Number.isNaN(Date.parse(u.occurredAt)) ? u.occurredAt : new Date(now()).toISOString();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await admin
      .from("message_sends")
      .select("id, tenant_id, status, to_hash, delivered_at, read_at")
      .eq("channel", u.channel)
      .eq("provider_id", providerId)
      .maybeSingle();
    if (error) {
      if (MISSING.has(error.code ?? "")) return "not_installed";
      throw new Error(`message_sends read failed: ${error.code}`);
    }
    const row = data as SendRow | null;
    if (!row) return "not_found";
    if (u.to && row.to_hash) {
      const hash = recipientHash(u.to);
      if (hash && hash !== row.to_hash) return "mismatch";
    }
    const next = nextMessageStatus(row.status, u.status);
    const patch: Record<string, unknown> = { last_event_at: at };
    if (next !== row.status) patch.status = next;
    if ((u.status === "delivered" || u.status === "read") && !row.delivered_at) patch.delivered_at = at;
    if (u.status === "read" && !row.read_at) patch.read_at = at;
    if (u.status === "failed" && next === "failed") {
      if (u.errorCode) patch.error_code = u.errorCode.slice(0, 64);
      if (u.error) patch.error = u.error.slice(0, 300);
    }
    if (u.channel === "sms" && typeof u.segments === "number" && u.segments > 0) patch.segments = Math.min(100, u.segments);
    if (u.pricingCategory) patch.pricing_category = u.pricingCategory.slice(0, 32);
    const changed = Object.keys(patch).some((k) => k !== "last_event_at");
    if (!changed) return "unchanged";
    const { data: updated, error: upErr } = await admin
      .from("message_sends")
      .update(patch)
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id")
      .maybeSingle();
    if (upErr) throw new Error(`message_sends update failed: ${upErr.code}`);
    if (updated) return "applied";
  }
  return "unchanged";
}
