import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Taslak önizleme bağlantısı (yalnız sunucu): HMAC-SHA256 imzalı, süreli, TEK taslağa bağlı belirteç.
 *   gövde  = base64url(JSON {s: yüzey, h: taslak özeti, e: bitiş (epoch sn)})
 *   imza   = base64url(HMAC-SHA256(anahtar, gövde))
 *   belirteç = gövde + "." + imza
 * Anahtar mevcut sunucu sırrından ALAN AYRIMLI türetilir: HMAC(PLATFORM_SECRETS_KEY ?? CRON_SECRET, "emlaksoft-preview-v1");
 * ikisi de yoksa önizleme bağlantısı KAPALIDIR (null). Taslak değişince özet uyuşmaz ve eski bağlantı geçersiz olur.
 * Belirteç yalnız "sitecontent" taslağını salt okunur gösterir; başka veri taşımaz ve hiçbir yetki vermez.
 */

export const PREVIEW_SURFACES = ["sitecontent"] as const;
export type PreviewSurface = (typeof PREVIEW_SURFACES)[number];

/** Paylaşım süresi seçenekleri (saat). */
export const PREVIEW_TTL_HOURS = [1, 24, 168] as const;
export type PreviewTtlHours = (typeof PREVIEW_TTL_HOURS)[number];
export const DEFAULT_PREVIEW_TTL_HOURS: PreviewTtlHours = 24;

const DOMAIN = "emlaksoft-preview-v1";

export type PreviewEnv = Readonly<Record<string, string | undefined>>;

/** İmza anahtarı; sır yoksa null (önizleme kapalı). */
export function previewKey(env: PreviewEnv = process.env): Buffer | null {
  const base = env.PLATFORM_SECRETS_KEY?.trim() || env.CRON_SECRET?.trim();
  if (!base) return null;
  return createHmac("sha256", base).update(DOMAIN).digest();
}

export function isPreviewEnabled(env: PreviewEnv = process.env): boolean {
  return previewKey(env) !== null;
}

/** İçeriğin kararlı özeti (aynı şemadan gelen JSON; alan sırası sabit). */
export function draftHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 32);
}

const sign = (key: Buffer, body: string) => createHmac("sha256", key).update(body).digest("base64url");

export function isPreviewTtl(value: unknown): value is PreviewTtlHours {
  return typeof value === "number" && (PREVIEW_TTL_HOURS as readonly number[]).includes(value);
}

/** Belirteç üretir; sır yoksa null. `nowMs` çağırandan gelir (src/lib/clock.ts `now()`), test edilebilirlik için. */
export function createPreviewToken(
  input: { surface: PreviewSurface; draftHash: string; ttlHours: PreviewTtlHours; nowMs: number },
  env: PreviewEnv = process.env,
): { token: string; exp: number } | null {
  const key = previewKey(env);
  if (!key) return null;
  const exp = Math.floor(input.nowMs / 1000) + input.ttlHours * 3600;
  const body = Buffer.from(JSON.stringify({ s: input.surface, h: input.draftHash, e: exp })).toString("base64url");
  return { token: `${body}.${sign(key, body)}`, exp };
}

export type PreviewVerdict =
  | { ok: true; surface: PreviewSurface; draftHash: string; exp: number }
  | { ok: false; reason: "disabled" | "malformed" | "signature" | "expired" | "surface" };

/** İmzayı (sabit zamanlı), yüzeyi ve süreyi doğrular. Taslak özeti karşılaştırması çağıranda (güncel taslağı o okur). */
export function verifyPreviewToken(token: unknown, expected: { surface: PreviewSurface; nowMs: number }, env: PreviewEnv = process.env): PreviewVerdict {
  const key = previewKey(env);
  if (!key) return { ok: false, reason: "disabled" };
  if (typeof token !== "string" || token.length > 512) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]+$/.test(parts[1]!)) return { ok: false, reason: "malformed" };
  const [body, sig] = parts as [string, string];
  const want = Buffer.from(sign(key, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "signature" };
  let payload: { s?: unknown; h?: unknown; e?: unknown };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as typeof payload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || typeof payload !== "object" || typeof payload.h !== "string" || typeof payload.e !== "number") return { ok: false, reason: "malformed" };
  if (payload.s !== expected.surface) return { ok: false, reason: "surface" };
  if (payload.e * 1000 <= expected.nowMs) return { ok: false, reason: "expired" };
  return { ok: true, surface: expected.surface, draftHash: payload.h, exp: payload.e };
}
