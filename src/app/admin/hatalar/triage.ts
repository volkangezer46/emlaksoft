import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Hata triyajı (AD10) ortak parçaları. Durum `error_logs.status` (open | ignored | snoozed | resolved); `resolved_at`
 * ile DB tetikleyicisi eşitler. Migration (20261013004900) uygulanmadan önce sütun yoktur: sayım/sorgu eski
 * `resolved_at IS NULL` kuralına düşer.
 */

export type TriageStatus = "open" | "ignored" | "snoozed" | "resolved";

export const TRIAGE_LABEL: Record<TriageStatus, string> = {
  open: "Açık",
  ignored: "Yok sayıldı",
  snoozed: "Ertelendi",
  resolved: "Çözüldü",
};

/** URL `durum` değeri ↔ durum. "" = açık (varsayılan). */
export const DURUM_TO_STATUS: Record<string, TriageStatus> = {
  "": "open",
  yoksayildi: "ignored",
  ertelendi: "snoozed",
  cozulmus: "resolved",
};

export function isMissingColumn(e: { code?: string } | null | undefined): boolean {
  return Boolean(e && (e.code === "42703" || e.code === "PGRST204"));
}

type Admin = ReturnType<typeof createAdminClient>;

/** "Açık hata türü": triyaj varsa yalnız durumu açık olanlar, yoksa çözülmemiş tümü. */
export async function countOpenErrors(admin: Admin): Promise<{ count: number | null }> {
  const r = await admin.from("error_logs").select("id", { count: "exact", head: true }).eq("status", "open");
  if (!r.error) return { count: r.count ?? 0 };
  const legacy = await admin.from("error_logs").select("id", { count: "exact", head: true }).is("resolved_at", null);
  return { count: legacy.count ?? null };
}
