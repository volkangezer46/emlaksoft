/**
 * Hata gürültüsü sınıflandırması (SAF). Sürüm geçişi hataları (yeni dağıtımdan sonra eski sekmenin artık olmayan
 * parçayı istemesi) gerçek arıza değildir; listede "Sürüm geçişi" etiketiyle ayrılır ve süzülebilir.
 */

export type ErrorClass = "surum_gecisi" | "react_render" | "diger";

/** Sürüm geçişi imzaları. Hata listesi süzgeci aynı ifadeleri ILIKE ile kullanır (tek kaynak). */
export const VERSION_SKEW_PATTERNS = [
  "ChunkLoadError",
  "Loading chunk",
  "Loading CSS chunk",
  "Failed to fetch dynamically imported module",
  "Failed to find Server Action",
] as const;

const REACT_RENDER_PATTERNS = [
  "Minified React error",
  "Server Components render",
  "Functions cannot be passed directly to Client Components",
  "Hydration failed",
  "hydration",
  "Rendered more hooks",
  "Rendered fewer hooks",
] as const;

export function classifyError(message: string | null | undefined): ErrorClass {
  const m = (message ?? "").toLowerCase();
  if (!m) return "diger";
  if (VERSION_SKEW_PATTERNS.some((p) => m.includes(p.toLowerCase()))) return "surum_gecisi";
  if (REACT_RENDER_PATTERNS.some((p) => m.includes(p.toLowerCase()))) return "react_render";
  return "diger";
}

export const ERROR_CLASS_LABELS: Record<ErrorClass, string> = {
  surum_gecisi: "Sürüm geçişi",
  react_render: "React çizim",
  diger: "Diğer",
};

/**
 * Otomatik kapanma seçicisi (SAF): açık (resolved_at boş) ve `last_seen` eşikten eski olan kayıtlar.
 * Cron aynı kuralı SQL'de uygular (`resolved_at is null and last_seen < esik`); bu fonksiyon kuralı test eder.
 */
export function autoResolveCutoffIso(nowMs: number, days: number): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

export function selectAutoResolvable<T extends { resolved_at: string | null; last_seen: string }>(rows: readonly T[], nowMs: number, days: number): T[] {
  const cutoff = nowMs - days * 86_400_000;
  return rows.filter((r) => r.resolved_at === null && new Date(r.last_seen).getTime() < cutoff);
}
