import type { PillTone } from "@/components/ui/list-kit";
import { priceHealthLabel } from "@/lib/property-labels";

/**
 * Portföy listesi saf yardımcıları (sayfadan ayrıldı: test edilebilir).
 */

/** properties.status → kapsül tonu. Bilinmeyen/özel durum nötr kalır (renk uydurulmaz). */
export function propertyStatusTone(status: string | null | undefined): PillTone {
  switch ((status ?? "").toLowerCase()) {
    case "live":
    case "yayında":
    case "active":
      return "success";
    case "reserved":
    case "pending":
    case "teyit":
    case "confirming":
      return "warning";
    case "sold":
    case "rented":
      return "info";
    case "withdrawn":
      return "danger";
    default:
      return "neutral"; // draft, passive, archived, bilinmeyen
  }
}

/** price_health kolonu → ton + etiket (etiket `priceHealthLabel`, detay rozetiyle aynı); bilinmiyorsa null (kapsül hiç çizilmez). */
export function priceHealthPill(health: string | null | undefined): { tone: PillTone; label: string } | null {
  if (health === "green" || health === "Yeşil") return { tone: "success", label: priceHealthLabel("green") };
  if (health === "yellow" || health === "Sarı") return { tone: "warning", label: priceHealthLabel("yellow") };
  if (health === "red" || health === "Kırmızı") return { tone: "danger", label: priceHealthLabel("red") };
  return null;
}

/** Satır alt başlığı: "140 m² · 3+1 · 4. kat" — yalnız dolu alanlar; hiçbiri yoksa null. */
export function featureSummary(features: Record<string, unknown> | null | undefined): string | null {
  const f = features ?? {};
  const parts: string[] = [];
  const sqm = Number(f.sqm);
  if (Number.isFinite(sqm) && sqm > 0) parts.push(`${new Intl.NumberFormat("tr-TR").format(sqm)} m²`);
  if (typeof f.rooms === "string" && f.rooms.trim()) parts.push(f.rooms.trim());
  if (f.floor !== undefined && f.floor !== null && String(f.floor).trim() !== "") parts.push(`${String(f.floor).trim()}. kat`);
  return parts.length ? parts.join(" · ") : null;
}

/** KPI kartı TL gösterimi: tam tutar ("₺93.549.500"); kısaltma (Mn/Mr) yok. */
export function compactTry(amount: number): string {
  return `₺${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(amount)}`;
}

/** Sayım satırlarından property_type dağılımı (ham değer → adet). */
export function countByType(rows: ReadonlyArray<{ property_type: string | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = r.property_type?.trim();
    if (!key) continue;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
