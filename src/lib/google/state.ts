import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { GoogleService } from "./keys";

/**
 * OAuth `state` + PKCE (S256). SAF çekirdek (imzalayıcı ve saat dışarıdan verilir; testli).
 *
 * `state` = base64url(JSON yük) + "." + HMAC. Yük: personel kimliği, Supabase oturum kimliği (session_id), hizmet,
 * PKCE doğrulayıcısının özeti, nonce, verilme ve bitiş zamanı (10 dk). Böylece:
 *  - başka bir oturumda/personelde doğrulanamaz (oturuma bağlı),
 *  - süresi dolunca reddedilir,
 *  - çerezdeki doğrulayıcı başka bir akışınkiyle değiştirilirse özet tutmaz.
 * İmzalayıcı üretimde `derivePlatformHmac("google-oauth-state", …)`; anahtar yoksa null → bağlama REDDEDİLİR.
 */

export const STATE_TTL_MS = 10 * 60_000;

export type StateSigner = (input: string) => string | null;

export type StateBinding = { staffId: string; sessionId: string };

export type StatePayload = {
  v: 1;
  staffId: string;
  sessionId: string;
  service: GoogleService;
  /** sha256(verifier) base64url — çerezdeki doğrulayıcıyla eşleşmeli. */
  vh: string;
  nonce: string;
  iat: number;
  exp: number;
};

export type StateCheck =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: "bicim" | "imza" | "oturum" | "sure" | "anahtar" | "dogrulayici" };

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** RFC 7636: 32 rastgele bayt → 43 karakterlik doğrulayıcı. */
export function createPkceVerifier(): string {
  return b64url(randomBytes(32));
}

/** S256: BASE64URL(SHA256(ASCII(verifier))), dolgu yok. */
export function pkceChallengeS256(verifier: string): string {
  return b64url(createHash("sha256").update(verifier, "ascii").digest());
}

export function isValidVerifier(v: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signState(
  input: { binding: StateBinding; service: GoogleService; verifier: string },
  nowMs: number,
  sign: StateSigner,
): string | null {
  const payload: StatePayload = {
    v: 1,
    staffId: input.binding.staffId,
    sessionId: input.binding.sessionId,
    service: input.service,
    vh: pkceChallengeS256(input.verifier),
    nonce: b64url(randomBytes(12)),
    iat: nowMs,
    exp: nowMs + STATE_TTL_MS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = sign(`state:${body}`);
  if (!mac) return null;
  return `${body}.${mac}`;
}

export function verifyState(
  state: string | null | undefined,
  binding: StateBinding,
  verifier: string | null | undefined,
  nowMs: number,
  sign: StateSigner,
): StateCheck {
  if (!state || state.length > 2048) return { ok: false, reason: "bicim" };
  const dot = state.indexOf(".");
  if (dot <= 0 || dot === state.length - 1) return { ok: false, reason: "bicim" };
  const body = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = sign(`state:${body}`);
  if (!expected) return { ok: false, reason: "anahtar" };
  if (!safeEqual(mac, expected)) return { ok: false, reason: "imza" };
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return { ok: false, reason: "bicim" };
  }
  if (payload?.v !== 1 || (payload.service !== "gsc" && payload.service !== "ads")) return { ok: false, reason: "bicim" };
  if (!binding.staffId || !binding.sessionId) return { ok: false, reason: "oturum" };
  if (!safeEqual(payload.staffId, binding.staffId) || !safeEqual(payload.sessionId, binding.sessionId)) {
    return { ok: false, reason: "oturum" };
  }
  if (!Number.isFinite(payload.exp) || nowMs > payload.exp || nowMs + 60_000 < payload.iat) return { ok: false, reason: "sure" };
  if (!verifier || !isValidVerifier(verifier) || !safeEqual(pkceChallengeS256(verifier), payload.vh)) {
    return { ok: false, reason: "dogrulayici" };
  }
  return { ok: true, payload };
}

export const STATE_REASON_LABELS: Record<Exclude<StateCheck, { ok: true }>["reason"], string> = {
  bicim: "Bağlantı isteği geçersiz.",
  imza: "Bağlantı isteğinin imzası doğrulanamadı.",
  oturum: "Bağlantı başka bir oturumda başlatılmış; lütfen bu oturumdan yeniden başlatın.",
  sure: "Bağlantı isteğinin süresi doldu (10 dakika); lütfen yeniden başlatın.",
  anahtar: "Şifreleme anahtarı tanımlı değil; bağlantı kurulamaz.",
  dogrulayici: "Güvenlik doğrulayıcısı (PKCE) eşleşmedi; lütfen yeniden başlatın.",
};
