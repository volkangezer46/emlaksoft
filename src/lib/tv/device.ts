import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";

/**
 * Ofis TV eşleştirmesi (OA6) — sunucu çekirdeği. TV tarayıcısı oturum açmaz: /tv ekranı rastgele bir cihaz sırrı
 * (httpOnly çerez) ve 6 haneli kod üretir; yönetici kodu Pano TV'de girince cihaz ofise bağlanır. Sır veritabanında
 * yalnız SHA-256 özetiyle durur; veri ucu bu çerezle yalnız PANO alanlarını (lib/tv/tv-data, kişisel veri maskeli,
 * gelir kapalı) döndürür. Okuma service_role ile yapılır ve her sorgu cihazın kiracısına kilitlidir.
 */

export const TV_COOKIE = "es_tv";
/** Çerez ömrü (sn): 400 gün (tarayıcı üst sınırı); iptal veritabanından anında etkilidir. */
export const TV_COOKIE_MAX_AGE = 400 * 86_400;
export const PAIR_CODE_TTL_MS = 10 * 60_000;
/** Karışan harf/rakamlar yok (I, O, 0, 1). DB CHECK ile aynı küme: ^[A-HJ-NP-Z2-9]{6}$ */
export const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

export function newDeviceSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function isDeviceSecret(v: string | null | undefined): v is string {
  return typeof v === "string" && SECRET_RE.test(v);
}

export function newPairCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
  return out;
}

/** Kullanıcının yazdığı kodu normalleştirir (boşluk/tire atılır, büyük harf); geçersizse null. */
export function normalizePairCode(raw: string): string | null {
  const v = raw.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(v) ? v : null;
}

export type TvDevice = { id: string; tenantId: string; name: string; officeName: string };

/**
 * Çerezdeki sırrı etkin cihaza çözer. Cihaz yok/iptal ya da ofis yayından kalkmış (askıda/iptal) ise null.
 * `touch`: son görülme en çok 5 dakikada bir yazılır (her yoklamada yazma yok).
 */
export async function resolveTvDevice(secret: string | null | undefined, opts: { touch?: boolean; nowMs: number }): Promise<TvDevice | null> {
  if (!isDeviceSecret(secret)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tv_devices")
    .select("id, tenant_id, name, last_seen_at, revoked_at, tenant:tenants!tv_devices_tenant_id_fkey(name, status)")
    .eq("token_hash", hashDeviceSecret(secret))
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  const tenant = (Array.isArray(data.tenant) ? data.tenant[0] : data.tenant) as { name?: string | null; status?: string | null } | null;
  if (!isPublicTenantActive(tenant?.status ?? null)) return null;
  if (opts.touch) {
    const last = data.last_seen_at ? Date.parse(String(data.last_seen_at)) : 0;
    if (!Number.isFinite(last) || opts.nowMs - last > 5 * 60_000) {
      await admin.from("tv_devices").update({ last_seen_at: new Date(opts.nowMs).toISOString() }).eq("id", data.id);
    }
  }
  return { id: String(data.id), tenantId: String(data.tenant_id), name: String(data.name), officeName: tenant?.name || "Ofis" };
}

export type PairState =
  | { state: "paired" }
  | { state: "pending"; code: string; expiresAt: string }
  | { state: "none" }
  | { state: "unavailable" };

/** /tv ekranının durumu: eşleşti mi, bekleyen kod var mı. Tablo yoksa `unavailable`. */
export async function pairStateFor(secret: string | null | undefined, nowMs: number): Promise<PairState> {
  if (!isDeviceSecret(secret)) return { state: "none" };
  const admin = createAdminClient();
  const hash = hashDeviceSecret(secret);
  const [device, pairing] = await Promise.all([
    admin.from("tv_devices").select("id, revoked_at").eq("token_hash", hash).maybeSingle(),
    admin.from("tv_pairing_codes").select("code, expires_at, claimed_at").eq("secret_hash", hash).maybeSingle(),
  ]);
  if (device.error || pairing.error) return { state: "unavailable" };
  if (device.data && !device.data.revoked_at) return { state: "paired" };
  const p = pairing.data as { code: string; expires_at: string; claimed_at: string | null } | null;
  if (p && !p.claimed_at && Date.parse(p.expires_at) > nowMs) return { state: "pending", code: p.code, expiresAt: p.expires_at };
  return { state: "none" };
}

/**
 * Yeni eşleştirme kodu: yeni sır + kod üretir ve yazar (kod çakışırsa 3 kez yeniden dener); süresi bir günden eski
 * kodlar temizlenir. Dönüş: çereze yazılacak sır + ekranda gösterilecek kod. Tablo yoksa null.
 */
export async function createPairing(nowMs: number): Promise<{ secret: string; code: string; expiresAt: string } | null> {
  const admin = createAdminClient();
  await admin.from("tv_pairing_codes").delete().lt("expires_at", new Date(nowMs - 86_400_000).toISOString());
  const secret = newDeviceSecret();
  const expiresAt = new Date(nowMs + PAIR_CODE_TTL_MS).toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newPairCode();
    const { error } = await admin
      .from("tv_pairing_codes")
      .insert({ code, secret_hash: hashDeviceSecret(secret), created_at: new Date(nowMs).toISOString(), expires_at: expiresAt });
    if (!error) return { secret, code, expiresAt };
    if (error.code !== "23505") return null;
  }
  return null;
}
