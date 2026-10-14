import { updateTag } from "next/cache";
import { setPlatformSetting } from "@/lib/platform-settings";
import { OFFICE_SECURITY_KEYS, OFFICE_SECURITY_PREFIX } from "@/lib/office-security/policy";
import { resetOfficeSecurityCache } from "@/lib/office-security/policy-cache";
import { settingsTenantTag } from "./read";
import { prepareWrite, type WriteItem } from "./prepare";
import type { WriteSettingResult } from "./types";

/**
 * DG7 ofis güvenlik politikası yazımı (köprü ayarlar: yalnız Ayarlar > Güvenlik eylemi ve Ofis 360 acil sıfırlama).
 * Çağıran kendi kapısını geçmiş olmalıdır (ofis: yalnız sahip; platform: süper admin + doğrulayıcı kodu).
 * Kayıt defteri doğrulaması (`prepareWrite`, `fromBridge`) + atomik `write_setting` (değer + settings_history).
 * Varsayılana eşit değer SATIR SİLER (null): politika kapalı ofis proxy görüntüsünde hiç yer almaz.
 * Önce HEPSİ doğrulanır; biri geçersizse hiçbiri yazılmaz. Değişmeyen anahtar yazılmaz (geçmiş gürültüsü yok).
 */
export async function writeOfficeSecurity(
  actor: { id: string; tenantId: string; actorType: "tenant_user" | "platform_staff" },
  writes: { key: string; value: unknown }[],
  opts: { reason: string; current?: Readonly<Record<string, string | null>> },
): Promise<WriteSettingResult> {
  const items: WriteItem[] = [];
  for (const w of writes) {
    if (!w.key.startsWith(OFFICE_SECURITY_PREFIX)) return { ok: false, error: "Bu yol yalnız ofis güvenlik ayarlarını yazar." };
    const p = prepareWrite({ key: w.key, value: w.value, reason: opts.reason, fromBridge: true });
    if (!p.ok) return { ok: false, error: p.error };
    const def = p.item.def;
    const isDefault = p.item.formatted !== null && p.item.formatted === def.codec.format(def.default);
    items.push(isDefault ? { ...p.item, formatted: null } : p.item);
  }
  let version = 0;
  let changed = false;
  for (const it of items) {
    if (opts.current && it.storage in opts.current && (opts.current[it.storage] ?? null) === it.formatted) continue;
    const out: { version?: number; conflict?: boolean } = {};
    const ok = await setPlatformSetting(it.storage, it.formatted, actor.id, {
      scope: "tenant",
      tenantId: actor.tenantId,
      isSecret: false,
      actorType: actor.actorType,
      reason: opts.reason,
      fingerprint: null,
      summary: it.formatted === null ? "varsayılana dönüldü" : null,
      expectedVersion: null,
      out,
    });
    if (!ok) return { ok: false, error: "Güvenlik politikası kaydedilemedi. Lütfen tekrar deneyin." };
    changed = true;
    version = out.version ?? version;
  }
  if (changed) {
    try {
      updateTag(settingsTenantTag(actor.tenantId));
    } catch {
      /* sunucu eylemi dışı bağlam: 30 sn'lik önbellek süresi yeter */
    }
    resetOfficeSecurityCache();
  }
  return { ok: true, version, changed };
}

/** Acil sıfırlama: tüm ofis güvenlik anahtarları varsayılana (satırlar silinir). */
export function resetOfficeSecurity(
  actor: { id: string; tenantId: string; actorType: "tenant_user" | "platform_staff" },
  reason: string,
): Promise<WriteSettingResult> {
  return writeOfficeSecurity(
    actor,
    OFFICE_SECURITY_KEYS.map((key) => ({ key, value: null })),
    { reason },
  );
}
