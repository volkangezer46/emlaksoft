import type { AdminHealth } from "@/lib/admin-badges";

/**
 * Sistem durumu çipinin SAF kararı (testli): veritabanı sorgusu hata verdiyse "sorunlu" (kırmızı); hatalı biten
 * zamanlanmış iş varsa "N uyarı" (amber); aksi hâlde "Sistem çevrimiçi" (yeşil).
 */
export type SystemStatus = { level: "ok" | "warn" | "down"; label: string };

export function systemStatusOf(h: Pick<AdminHealth, "ok" | "cronErrors">): SystemStatus {
  if (!h.ok) return { level: "down", label: "Veritabanı sorunlu" };
  const errs = h.cronErrors ?? 0;
  if (errs > 0) return { level: "warn", label: `${errs} uyarı` };
  return { level: "ok", label: "Sistem çevrimiçi" };
}
