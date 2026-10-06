/**
 * Süresi geçmiş kapsam istisnalarının temizliği — mevcut günlük `operational-retention` cron'unun küçük adımı
 * (yeni cron YOK). Admin istemci PARAMETRE olarak gelir.
 *
 * Süresi geçen satır okumada zaten yok sayılır (RPC + TS); ekranda "soluk" görünmesi için bir süre tutulur,
 * `keepDays` sonra silinir. İdempotent; tablo yoksa `{ deleted: 0, skipped: true }`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export const EXPIRED_OVERRIDE_KEEP_DAYS = 90;

export async function purgeExpiredScopeOverrides(
  admin: AnyClient,
  opts: { nowMs: number; keepDays?: number },
): Promise<{ deleted: number; skipped: boolean }> {
  const keepDays = opts.keepDays ?? EXPIRED_OVERRIDE_KEEP_DAYS;
  const cutoff = new Date(opts.nowMs - keepDays * 86_400_000).toISOString();
  const { data, error } = await admin.from("scope_overrides").delete().lt("expires_at", cutoff).select("id");
  if (error) {
    // 42P01 / PGRST205: tablo yok (migration uygulanmadı) → sessiz atla; diğer hatalar görünür.
    if (!["42P01", "PGRST205"].includes(String(error.code))) console.error("purgeExpiredScopeOverrides", error);
    return { deleted: 0, skipped: true };
  }
  return { deleted: (data ?? []).length, skipped: false };
}
