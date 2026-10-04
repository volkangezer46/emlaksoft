import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultApprovalRules,
  normalizeApprovalRules,
  normalizeThresholds,
  DEFAULT_THRESHOLDS,
  type ApprovalRules,
  type OversightThresholds,
} from "@/lib/oversight/settings";

/**
 * Ayar / "incelendi" deposu (oversight_settings, oversight_alert_reviews).
 * Migration henuz uygulanmadiysa tablolar yoktur: `available:false` doner, varsayilanlarla calisilir.
 */

type DbError = { code?: string; message?: string } | null | undefined;

/** Tablo yok / sema onbellegi bilmiyor. */
export function isMissingTable(error: DbError): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || error.code === "PGRST205" || msg.includes("does not exist") || msg.includes("schema cache");
}

export type OversightSettingsLoad = {
  thresholds: OversightThresholds;
  approvalRules: ApprovalRules;
  /** false: ayar tablosu yok (migration uygulanmamis) — varsayilanlar kullaniliyor, kaydetme devre disi. */
  available: boolean;
};

export async function loadOversightSettings(supabase: SupabaseClient, tenantId: string): Promise<OversightSettingsLoad> {
  const { data, error } = await supabase
    .from("oversight_settings")
    .select("thresholds, approval_rules")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    return { thresholds: DEFAULT_THRESHOLDS, approvalRules: defaultApprovalRules(), available: !isMissingTable(error) };
  }
  return {
    thresholds: normalizeThresholds(data?.thresholds),
    approvalRules: normalizeApprovalRules(data?.approval_rules),
    available: true,
  };
}

export async function loadApprovalRules(supabase: SupabaseClient, tenantId: string): Promise<ApprovalRules> {
  const { data, error } = await supabase
    .from("oversight_settings")
    .select("approval_rules")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    // Yalniz TABLO YOKSA varsayilan "kapali"ya dus. Baska okuma hatasi fail-open olamaz: firlat, kapi `error` doner.
    if (isMissingTable(error)) return defaultApprovalRules();
    throw new Error(`oversight_settings okunamadi: ${error.code ?? ""} ${error.message ?? ""}`.trim());
  }
  return normalizeApprovalRules(data?.approval_rules);
}

export type ReviewInfo = { at: string; by: string | null; note: string | null };

export type ReviewsLoad = { reviews: Map<string, ReviewInfo>; available: boolean };

/** Verilen anahtarlarin "incelendi" durumu (anahtar yoksa bos). */
export async function loadReviews(supabase: SupabaseClient, tenantId: string, keys: readonly string[]): Promise<ReviewsLoad> {
  const reviews = new Map<string, ReviewInfo>();
  if (keys.length === 0) return { reviews, available: true };
  const unique = [...new Set(keys)];
  // URL uzunlugu icin parcali okuma.
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase
      .from("oversight_alert_reviews")
      .select("alert_key, reviewed_at, reviewed_by, note")
      .eq("tenant_id", tenantId)
      .in("alert_key", unique.slice(i, i + 100));
    if (error) return { reviews, available: !isMissingTable(error) };
    for (const r of (data ?? []) as { alert_key: string; reviewed_at: string; reviewed_by: string | null; note: string | null }[]) {
      reviews.set(r.alert_key, { at: r.reviewed_at, by: r.reviewed_by, note: r.note });
    }
  }
  return { reviews, available: true };
}
