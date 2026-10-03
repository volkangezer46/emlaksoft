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
