import type { AdminHealth } from "@/lib/admin-badges";

/**
 * Sistem durumu çipinin SAF kararı (testli): veritabanı sorgusu hata verdiyse "sorunlu" (kırmızı); hatalı biten
 * zamanlanmış iş ya da operasyon hazırlık sinyali (uyarı kanalı yok, kimseye gitmemiş kritik uyarı, şifresiz / yalnız
 * yerel / eski yedek, tatbikat yok, e-posta kanalı kapalı; `ops-readiness`) varsa "uyarı" (amber); aksi hâlde
 * "Sistem çevrimiçi" (yeşil). Tek sorun varsa adıyla ("Uyarı kanalı yok"), birden çoksa "N uyarı" yazılır.
 */
export type SystemStatus = { level: "ok" | "warn" | "down"; label: string };

export function systemStatusOf(h: Pick<AdminHealth, "ok" | "cronErrors" | "readiness">): SystemStatus {
  if (!h.ok) return { level: "down", label: "Veritabanı sorunlu" };
  const errs = h.cronErrors ?? 0;
  const signals = h.readiness ?? [];
  const total = errs + signals.length;
  if (total === 0) return { level: "ok", label: "Sistem çevrimiçi" };
  // Uyarı kanalı yoksa hiçbir uyarı kimseye ulaşmaz: sayının yerine bu söylenir (en önemli bilgi).
  if (signals.some((s) => s.id === "alert-channels")) return { level: "warn", label: total > 1 ? `Uyarı kanalı yok · ${total} uyarı` : "Uyarı kanalı yok" };
  if (total === 1 && signals[0]) return { level: "warn", label: signals[0].label };
  return { level: "warn", label: `${total} uyarı` };
}
