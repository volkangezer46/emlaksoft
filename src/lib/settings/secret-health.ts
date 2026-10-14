import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { openPlatformSecret } from "@/lib/platform-secrets";
import { createClient } from "@/lib/supabase/server";
import { EF_SETTING } from "@/lib/integrations/emlakfiyati/keys";
import { listSettingDefs, isSecretDef, storageKeyOf } from "./registry";
import { isSealed } from "./secrets";

/**
 * Şifreli anahtar sağlığı (SUNUCU): ayar defterindeki her gizli ayarı ve EmlakFiyati anahtarını çözmeyi DENER.
 * Değer ASLA dönmez; yalnız durum. 'cozulemedi' tipik nedeni PLATFORM_SECRETS_KEY değişmesi/kaybıdır.
 * Eski düz metin (geçiş dönemi) çözme gerektirmez → 'ok' (düz metin uyarısı merkezdeki SecretsMigration kartındadır).
 */

export type SecretHealthStatus = "ok" | "cozulemedi" | "tanimsiz";

export type SecretHealthEntry = {
  key: string;
  label: string;
  durum: SecretHealthStatus;
  changedAt: string | null;
  /** "Yeniden gir" hedefi. */
  href: string;
};

export type SecretCandidate = { key: string; storageKey: string; label: string; href: string };

/** SAF değerlendirme: `open` çözücü enjekte edilir (test edilebilir). */
export function evaluateSecretHealth(
  candidates: readonly SecretCandidate[],
  raw: Record<string, string | null | undefined>,
  changedAt: Record<string, string | null | undefined>,
  open: (storageKey: string, raw: string) => string | null,
): SecretHealthEntry[] {
  return candidates.map((c) => {
    const value = raw[c.storageKey];
    let durum: SecretHealthStatus;
    if (value == null || value === "") durum = "tanimsiz";
    else if (!isSealed(value)) durum = "ok";
    else durum = open(c.storageKey, value) === null ? "cozulemedi" : "ok";
    return { key: c.key, label: c.label, durum, changedAt: changedAt[c.storageKey] ?? null, href: c.href };
  });
}

export const EMLAKFIYATI_SECRET_CANDIDATE: SecretCandidate = {
  key: "emlakfiyati.api_key",
  storageKey: EF_SETTING.current,
  label: "EmlakFiyati API anahtarı",
  href: "/admin/sistem?sekme=entegrasyonlar#anahtar-emlakfiyati",
};

export function secretCandidates(): SecretCandidate[] {
  const fromRegistry = listSettingDefs({ scope: "platform" })
    .filter(isSecretDef)
    .map((d) => ({
      key: d.key,
      storageKey: storageKeyOf(d),
      label: d.label,
      href: d.home?.href ?? d.editHref ?? `/admin/ayarlar?ara=${encodeURIComponent(d.key)}`,
    }));
  return [...fromRegistry, EMLAKFIYATI_SECRET_CANDIDATE];
}

/** Son değişiklik zamanı: settings_history (oturumlu istemci; platform personeli okur). Okunamazsa boş. */
async function lastChanged(storageKeys: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("settings_history")
      .select("key, created_at")
      .eq("scope", "platform")
      .in("key", storageKeys)
      .order("created_at", { ascending: false })
      .limit(500);
    for (const r of (data ?? []) as { key: string; created_at: string }[]) if (!(r.key in out)) out[r.key] = r.created_at;
  } catch {
    /* geçmiş okunamadı: zaman boş kalır */
  }
  return out;
}

export async function getSecretHealth(): Promise<SecretHealthEntry[]> {
  const candidates = secretCandidates();
  const keys = candidates.map((c) => c.storageKey);
  const [raw, changed] = await Promise.all([getPlatformSettingsMany(keys), lastChanged(keys)]);
  if (changed[EF_SETTING.current] == null) {
    const efChanged = (await getPlatformSettingsMany([EF_SETTING.changedAt]))[EF_SETTING.changedAt];
    if (efChanged) changed[EF_SETTING.current] = efChanged;
  }
  return evaluateSecretHealth(candidates, raw, changed, openPlatformSecret);
}
