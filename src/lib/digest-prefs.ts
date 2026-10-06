import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyKey } from "@/lib/settings/registry/tenant";
import { readTenantSettings } from "@/lib/settings/tenant-read";

/**
 * Özet bildirimi (günlük/haftalık) alıcı kuralı. Kullanıcı kendi `digest` tercihini kaydettiyse o geçerlidir; kaydetmediyse
 * OFİS varsayılanı (`office.notify.default_digest`, kayıt yoksa açık) uygulanır. Saf: test edilebilir.
 */
export function wantsDigest(prefs: unknown, officeDefault = true): boolean {
  if (!prefs || typeof prefs !== "object") return officeDefault;
  const digest = (prefs as { digest?: unknown }).digest;
  if (typeof digest === "boolean") return digest;
  return officeDefault;
}

/** Ofisin özet varsayılanı (cron için; çağıranın istemcisiyle, açık tenant_id). Okunamazsa açık (eski davranış). */
export async function officeDigestDefault(db: SupabaseClient, tenantId: string): Promise<boolean> {
  const key = notifyKey("digest");
  const v = (await readTenantSettings(db, tenantId, [key]))[key];
  return v !== false;
}
