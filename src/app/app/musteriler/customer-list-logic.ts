import type { PillTone } from "@/components/ui/list-kit";
import type { HeatSegment } from "@/lib/customer-heat";

/** Müşteri listesi saf yardımcıları (sayfadan ayrıldı: test edilebilir). */

/** Sıcaklık segmenti → kapsül tonu. */
export function heatTone(segment: HeatSegment): PillTone {
  switch (segment) {
    case "sicak":
      return "warning";
    case "ilgili":
      return "success";
    case "soguk":
      return "info";
    default:
      return "neutral"; // uykuda
  }
}

/** Müşteri tipi → kapsül tonu; özel/bilinmeyen tip nötr kalır. */
export function customerTypeTone(type: string): PillTone {
  const t = type.toLocaleLowerCase("tr-TR");
  if (t === "alıcı") return "info";
  if (t === "mülk sahibi") return "success";
  if (t === "yatırımcı") return "warning";
  return "neutral";
}

/** Geçen gün sayısı → "Bugün / Dün / N gün önce / N ay önce / N yıl önce". */
export function relativeFromDays(days: number): string {
  if (days <= 0) return "Bugün";
  if (days === 1) return "Dün";
  if (days < 30) return `${days} gün önce`;
  if (days < 365) return `${Math.floor(days / 30)} ay önce`;
  return `${Math.floor(days / 365)} yıl önce`;
}

/** customer_types dizilerinden tip → adet dağılımı (bir müşteri birden çok tipte sayılır). */
export function countCustomerTypes(rows: ReadonlyArray<{ customer_types: string[] | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const t of new Set(r.customer_types ?? [])) {
      const key = t.trim();
      if (key) out[key] = (out[key] ?? 0) + 1;
    }
  }
  return out;
}
