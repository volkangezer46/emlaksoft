import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeListingControlConfig, type ListingControlConfig } from "../config";

/**
 * İlan kontrol sunucu katmanı ORTAK parçaları. DİKKAT: bu klasördeki dosyalar `createAdminClient` ÇAĞIRMAZ; istemci
 * (service_role ya da kullanıcı oturumu) ÇAĞIRAN tarafından enjekte edilir. Yeni service_role kullanımı
 * `admin-client-allowlist.ts` kabul listesine girmeden eklenemez (test kırar); bu yüzden yalnız MEVCUT kabul edilmiş
 * yollar (cron GET'leri) service_role istemcisini buraya geçirir.
 */
export type Db = SupabaseClient;

type PgError = { code?: string | null; message?: string | null } | null | undefined;

/** Tablo/kolon/RPC henüz yok (migration uygulanmamış): kod zarifçe kapalı çalışır. */
export function isMissingSchema(error: PgError): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "42P01" || code === "42703" || code === "42883" || code === "PGRST205" || code === "PGRST204" || code === "PGRST202") return true;
  return /does not exist|schema cache|could not find the function/i.test(String(error.message ?? ""));
}

/** Ofisin ilan kontrol ayarı (oversight_settings.listing_control). Satır/kolon yoksa varsayılanlar. Asla fırlatmaz. */
export async function loadListingControlConfig(db: Db, tenantId: string): Promise<ListingControlConfig> {
  try {
    const { data, error } = await db.from("oversight_settings").select("listing_control").eq("tenant_id", tenantId).maybeSingle();
    if (error) return normalizeListingControlConfig(null);
    return normalizeListingControlConfig((data as { listing_control?: unknown } | null)?.listing_control);
  } catch {
    return normalizeListingControlConfig(null);
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
