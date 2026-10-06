import type { SupabaseClient } from "@supabase/supabase-js";
import { getSettingDef, storageKeyOf } from "./registry";
import { isSecretDef } from "./registry";
import { coerceInput } from "./view";

/**
 * Ofis ayarı okuyucusu — CRON / service_role için. `getSetting` (read.ts) oturumlu istemciyle okur ve oturumsuz cron'da
 * boş döner; bu okuyucu çağıranın verdiği istemciyi kullanır ve HER SORGUDA `tenant_id`'yi AÇIK parametre alır
 * (RLS yok sayıldığından izolasyon bu filtreye dayanır). Kendi istemcisini OLUŞTURMAZ: çağıran, mevcut kapalı iş
 * seçicisinden (kabul listesindeki yol) gelen istemciyi verir; yeni createAdminClient kullanımı doğmaz.
 *
 * Çözümleme read.ts ile aynıdır: ofis değeri geçerliyse o, değilse/yoksa/bozuksa kayıt defterindeki varsayılan.
 * Tablo yoksa/hata olursa tüm değerler varsayılan (asla fırlatmaz): ofis değiştirmedikçe davranış bugünküyle aynıdır.
 */
export async function readTenantSettings(
  db: SupabaseClient,
  tenantId: string,
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const defs = keys
    .map((k) => getSettingDef(k))
    .filter((d): d is NonNullable<typeof d> => !!d && d.scope !== "platform" && !isSecretDef(d));
  const stored = new Map<string, unknown>();
  if (tenantId && defs.length > 0) {
    try {
      const { data } = await db
        .from("tenant_settings")
        .select("key, value")
        .eq("tenant_id", tenantId)
        .in("key", defs.map(storageKeyOf));
      for (const r of (data ?? []) as { key: string; value: unknown }[]) stored.set(r.key, r.value);
    } catch {
      /* tablo yok = varsayılan */
    }
  }
  for (const def of defs) {
    const raw = stored.get(storageKeyOf(def));
    let value: unknown = def.codec.parse(null);
    if (raw !== undefined && raw !== null) {
      const parsed = coerceInput(def, raw);
      if (parsed.ok) value = parsed.value;
    }
    out[def.key] = value;
  }
  return out;
}

/** Sayısal ayar (bozuk/yok = verilen yedek). */
export function numberSetting(values: Record<string, unknown>, key: string, fallback: number): number {
  const v = values[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
