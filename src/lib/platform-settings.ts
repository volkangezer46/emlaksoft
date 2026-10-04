import { createAdminClient } from "@/lib/supabase/admin";

/** Platform ayarını okur (service role — RLS bypass). Yoksa null. */
export async function getPlatformSetting(key: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("platform_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return data?.value ?? null;
  } catch (e) {
    console.error("getPlatformSetting", e);
    return null;
  }
}

/** Birden çok platform ayarını TEK sorguyla okur (yoksa değer null). */
export async function getPlatformSettingsMany(keys: readonly string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = null;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("platform_settings").select("key, value").in("key", [...keys]);
    for (const row of data ?? []) out[row.key as string] = (row.value as string | null) ?? null;
  } catch (e) {
    console.error("getPlatformSettingsMany", e);
  }
  return out;
}

/** Platform ayarını yazar/günceller. Başarı bilgisini döner (eski çağıranlar dönüşü yok sayabilir). */
export async function setPlatformSetting(key: string, value: string | null, staffId?: string): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.from("platform_settings").upsert(
    {
      key,
      value,
      updated_by: staffId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) console.error("setPlatformSetting", key, error.message);
  return !error;
}
