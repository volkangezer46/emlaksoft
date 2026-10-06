/**
 * Veri tazeliği — saf mantık (DOM'suz, birim testli).
 * Eşikler tek yerde: taze < 5 dk, "güncel" < 60 dk, sonrası bayat.
 */
export type FreshnessLevel = "taze" | "guncel" | "bayat";

export const FRESH_MS = 5 * 60_000;
export const STALE_MS = 60 * 60_000;

export function freshnessLevel(ageMs: number): FreshnessLevel {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "taze";
  if (ageMs < FRESH_MS) return "taze";
  if (ageMs < STALE_MS) return "guncel";
  return "bayat";
}

export const FRESHNESS_LABEL: Record<FreshnessLevel, string> = {
  taze: "Taze",
  guncel: "Güncel",
  bayat: "Bayat",
};

/** "az önce" / "12 dk önce" / "3 sa önce" / "2 gün önce". */
export function ageText(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < 60_000) return "az önce";
  const min = Math.floor(ageMs / 60_000);
  if (min < 60) return `${min} dk önce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}
