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

/**
 * Sıkı tek ayar okuması: satır yoksa null döner, okuma hatasında FIRLATIR (getPlatformSetting'in aksine "okunamadı"
 * "kayıt yok" sayılmaz; önbelleğe boş girmez, yazmalar boş listeyi ezmez). `version` iyimser kilit içindir
 * (write_setting RPC'sinin p_expected_version'ı); version sütunu yoksa (migration 002300 öncesi) null.
 */
export async function readPlatformSettingStrict(key: string): Promise<{ value: string | null; version: number | null } | null> {
  const admin = createAdminClient();
  const res = await admin.from("platform_settings").select("value, version").eq("key", key).maybeSingle();
  if (!res.error) {
    if (!res.data) return null;
    const row = res.data as { value: string | null; version: number | null };
    return { value: row.value ?? null, version: typeof row.version === "number" ? row.version : null };
  }
  if (res.error.code !== "42703") throw new Error(res.error.message);
  const legacy = await admin.from("platform_settings").select("value").eq("key", key).maybeSingle();
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.data ? { value: (legacy.data.value as string | null) ?? null, version: null } : null;
}

/** Birden çok platform ayarını TEK sorguyla okur (yoksa değer null). */
export async function getPlatformSettingsMany(
  keys: readonly string[],
  opts?: { strict?: boolean },
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("platform_settings").select("key, value").in("key", [...keys]);
    if (error && opts?.strict) throw new Error(error.message);
    for (const row of data ?? []) out[row.key as string] = (row.value as string | null) ?? null;
  } catch (e) {
    // strict: cron gibi "okunamadı = başarılı say" diyemeyen çağıranlar hatayı görür (varsayılan: sessiz varsayılan).
    if (opts?.strict) throw e;
    console.error("getPlatformSettingsMany", e);
  }
  return out;
}

/**
 * Ayar Kayıt Defteri yazım meta verisi (`src/lib/settings/write.ts` doldurur). Verilirse yazım ATOMİK `write_setting`
 * RPC'siyle (değer + settings_history aynı işlemde) yapılır; verilmezse eski doğrudan upsert (tetikleyici
 * "doğrudan yazım" satırı bırakır). RPC henüz uygulanmamışsa eski yola düşülür ve `out.degraded` işaretlenir.
 */
export type RegistryWriteMeta = {
  scope?: "platform" | "tenant";
  tenantId?: string | null;
  isSecret?: boolean;
  actorType?: "platform_staff" | "tenant_user" | "system";
  reason?: string | null;
  fingerprint?: string | null;
  summary?: string | null;
  expectedVersion?: number | null;
  /** Sonuç çıktısı (çağıran okur). */
  out?: { version?: number; conflict?: boolean; degraded?: boolean };
};

/** Platform ayarını yazar/günceller. Başarı bilgisini döner (eski çağıranlar dönüşü yok sayabilir). */
export async function setPlatformSetting(
  key: string,
  value: string | null,
  staffId?: string,
  meta?: RegistryWriteMeta,
): Promise<boolean> {
  const admin = createAdminClient();
  if (meta) {
    const out = meta.out ?? {};
    const { data, error } = await admin.rpc("write_setting", {
      p_scope: meta.scope ?? "platform",
      p_tenant_id: meta.tenantId ?? null,
      p_key: key,
      p_value: value,
      p_is_secret: meta.isSecret ?? false,
      p_changed_by: staffId ?? null,
      p_actor_type: meta.actorType ?? "platform_staff",
      p_reason: meta.reason ?? null,
      p_fingerprint: meta.fingerprint ?? null,
      p_summary: meta.summary ?? null,
      p_expected_version: meta.expectedVersion ?? null,
    });
    if (!error) {
      const res = (data ?? {}) as { ok?: boolean; conflict?: boolean; version?: number };
      out.version = res.version;
      out.conflict = Boolean(res.conflict);
      return res.ok === true;
    }
    // RPC yok (migration 20260826002400 uygulanmadı): platform kapsamında eski doğrudan yazıma düş.
    const missing = error.code === "PGRST202" || error.code === "42883" || /write_setting/i.test(error.message);
    if (!missing || (meta.scope ?? "platform") !== "platform") {
      console.error("setPlatformSetting rpc", key, error.message);
      return false;
    }
    out.degraded = true;
  }
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