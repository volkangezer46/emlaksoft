import "server-only";
import { getPlatformSetting } from "@/lib/platform-settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PLATFORM AI KOTASI (G9): kiracı kredisi KULLANMAYAN platform çağrılarının (SEO AI önerisi, platform danışmanı) aylık
 * sınırı. Sayaç `platform_ai_quota` tablosunda, artış `platform_ai_quota_take` RPC'siyle ATOMİK yapılır (tek UPDATE ...
 * WHERE used < limit RETURNING; ay değişince sıfırlanır). Migration: 20261013003100_platform_ai_quota.
 *
 * Fail-CLOSED: tablo/RPC yoksa ya da okunamazsa çağrı YAPILMAZ ("kota kurulmadı" / "kota okunamadı").
 */

export type PlatformQuotaResult = { ok: true } | { ok: false; reason: "limit" | "kurulmadi" | "hata"; message: string };

const MISSING_CODES = new Set(["42883", "42P01", "PGRST202", "PGRST205"]);

/** Anahtar biçimi: "seo.ai", "advisor.ai" (küçük harf, nokta/alt çizgi). */
export const PLATFORM_QUOTA_KEY_RE = /^[a-z][a-z0-9_.]{1,40}$/;

export async function takePlatformAiQuota(key: string, limit: number): Promise<PlatformQuotaResult> {
  if (!PLATFORM_QUOTA_KEY_RE.test(key) || !Number.isInteger(limit) || limit < 1) {
    return { ok: false, reason: "hata", message: "Kota ayarı geçersiz." };
  }
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("platform_ai_quota_take", { p_key: key, p_limit: limit });
    if (error) {
      if (MISSING_CODES.has(error.code ?? "")) return { ok: false, reason: "kurulmadi", message: "Platform AI kotası kurulmadı (veritabanı güncellemesi bekleniyor)." };
      return { ok: false, reason: "hata", message: "Platform AI kotası okunamadı." };
    }
    if (data === true) return { ok: true };
    return { ok: false, reason: "limit", message: `Bu ayın AI sınırı (${limit}) doldu.` };
  } catch {
    return { ok: false, reason: "hata", message: "Platform AI kotası okunamadı." };
  }
}

/** Ayardaki aylık sınırı okur: platform_settings[key] = `{"monthlyLimit": N}`. Yok/bozuksa null. */
export function parseMonthlyLimit(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { monthlyLimit?: unknown } | null;
    const n = v?.monthlyLimit;
    return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * İSTEĞE BAĞLI kapı (platform danışmanı gibi mevcut özellikler): ayar anahtarında `monthlyLimit` YOKSA kapı uygulanmaz
 * (mevcut davranış değişmez, true); varsa aynı anahtarla atomik kota alınır.
 */
export async function platformQuotaGateOpen(key: string): Promise<boolean> {
  const limit = parseMonthlyLimit(await getPlatformSetting(key));
  if (limit === null) return true;
  return (await takePlatformAiQuota(key, limit)).ok;
}

/** Ekranda gösterim için bu ayın kullanımı (tablo yoksa null; salt okunur). */
export async function readPlatformAiQuota(key: string): Promise<{ period: string; used: number } | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("platform_ai_quota").select("period, used").eq("key", key).maybeSingle();
    if (error || !data) return null;
    return { period: String(data.period), used: Number(data.used) || 0 };
  } catch {
    return null;
  }
}
