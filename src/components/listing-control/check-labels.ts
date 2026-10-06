import type { KpiVisual } from "./helpers";

export const CHECK_STATE_LABELS: Record<string, string> = {
  unchecked: "Henüz kontrol edilmedi",
  verified: "Portalda doğrulandı",
  suspect: "Şüpheli (tekrar bakılacak)",
  probable_missing: "Olası kayıp",
  confirmed_missing: "Portalda yok (onaylı)",
  unverifiable: "Kontrol edilemedi",
  paused: "Duraklatıldı",
};

export function checkStateVisual(state: string): KpiVisual {
  switch (state) {
    case "verified":
      return "healthy";
    case "unchecked":
    case "suspect":
      return "pending";
    case "probable_missing":
    case "confirmed_missing":
      return "critical";
    case "unverifiable":
      return "unverifiable";
    default:
      return "neutral";
  }
}

export function formatPct(n: number | null): string {
  return n === null ? "-" : `%${n}`;
}

export const STATUS_LABELS: Record<string, string> = {
  open: "Açık",
  acknowledged: "Görüldü",
  explained: "Açıklandı",
  resolved: "Çözüldü",
  false_positive: "Yanlış alarm",
  auto_closed: "Otomatik kapandı",
};
