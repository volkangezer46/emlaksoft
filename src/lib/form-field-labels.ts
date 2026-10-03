import { CRITERIA_LABELS, CRITERIA_REQUIRED_KEYS } from "@/lib/demand-criteria";

/**
 * Form alan adı -> Türkçe etiket sözlüğü. Etiketi DOM'dan çıkarılamayan (gizli girdi) alanların
 * özet panelinde ham anahtar ("phone", "required_keys") görünmesini engeller.
 */
export const DEFAULT_FIELD_LABELS: Record<string, string> = {
  full_name: "Ad soyad",
  phone: "Telefon",
  email: "E-posta",
  type: "Müşteri türü",
  branch_id: "Şube",
  province_id: "İl",
  birth_date: "Doğum tarihi",
  anniversary_date: "Yıldönümü",
  anniversary_note: "Yıldönümü notu",
  notes: "Not",
  transaction_type: "İşlem",
  property_type: "Portföy türü",
  urgency: "Aciliyet",
  budget_min: "Bütçe (en az)",
  budget_max: "Bütçe (en çok)",
  rooms: "Oda",
  min_sqm: "En az m²",
  max_sqm: "En çok m²",
  floor_min: "En düşük kat",
  floor_max: "En yüksek kat",
  heating: "Isınma",
  facade: "Cephe",
  feature_tags: "Özellikler",
  uses_loan: "Kredi",
  swap_ok: "Takas",
  required_keys: "Olmazsa olmaz kriterler",
  extra_locations: "Ek bölgeler",
  demand_province_id: "Talep ili",
  demand_district_id: "Talep ilçesi",
  demand_neighborhood_id: "Talep mahallesi",
};

/** Etiket çözümü: açık etiket > DOM etiketi > sözlük > ham ad. */
export function fieldLabelFor(name: string, explicit?: string | null): string {
  return explicit || DEFAULT_FIELD_LABELS[name] || name;
}

/** Gizli girdilerin ham değerini ("budget,rooms", JSON) okunur metne çevirir. */
export function fieldTextFor(name: string, text: string | null): string | null {
  if (text == null) return text;
  if (name === "required_keys") {
    const labels = text
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => (CRITERIA_REQUIRED_KEYS as readonly string[]).includes(k) ? CRITERIA_LABELS[k as keyof typeof CRITERIA_LABELS] : k);
    return labels.length ? labels.join(", ") : null;
  }
  if (name === "extra_locations") {
    try {
      const arr: unknown = JSON.parse(text);
      return Array.isArray(arr) && arr.length > 0 ? `${arr.length} bölge` : null;
    } catch {
      return text;
    }
  }
  return text;
}
