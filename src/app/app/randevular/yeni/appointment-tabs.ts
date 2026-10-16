/**
 * Yeni randevu formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 * `confirm_conflict`: çakışma uyarı bandındaki gizli onay alanı (sekmeden bağımsız, yalnız çakışmada render edilir).
 */
import { hasValue, type FormRuleIssue } from "@/lib/form-rules";

export const APPOINTMENT_FORM_ID = "yeni-randevu";

/**
 * Kolay randevu (sahip kuralı "randevu eklemede kolay olmalı"): tek sayfa; temel alanlar açık ("randevu"), az kullanılan
 * süre/konum kapalı "Ayrıntılar" bölümünde (`collapsible`). Zorunlu alanların hepsi ilk bölümdedir.
 */
export const APPOINTMENT_TABS = [
  {
    id: "randevu",
    label: "Randevu",
    description: "Kiminle, nerede ve ne zaman. Müşteri ve portföy yazarak aranır.",
    fields: ["customer_id", "property_id", "appointment_type", "date", "time", "assigned_to", "notes", "confirm_conflict"],
    required: ["appointment_type", "date", "time"],
  },
  {
    id: "ayrinti",
    label: "Ayrıntılar",
    description: "Süre ve konum (gösterimde portföy adresi kendiliğinden gelir).",
    fields: ["duration_min", "location"],
    required: [],
  },
] as const;

/** Sunucunun kabul ettiği randevu türü: yerleşik türler + ofis tanımları (DB yalnız 1-64 karakter ister). */
export function isValidAppointmentType(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v.length <= 64 && /^[\p{L}\p{N} _./-]+$/u.test(v);
}

/**
 * Katılımcı kuralı (istemci "N eksik" + sunucu `createAppointment` ortak): yer göstermede müşteri VE portföy,
 * diğer türlerde en az biri. Boş randevu (kimsiz, mülksüz) takvimi kirletir.
 */
export function appointmentMissing(values: {
  appointment_type?: string | null;
  customer_id?: string | null;
  property_id?: string | null;
}): FormRuleIssue[] {
  const hasCustomer = hasValue(values.customer_id);
  const hasProperty = hasValue(values.property_id);
  if ((values.appointment_type ?? "").trim() === "showing") {
    const out: FormRuleIssue[] = [];
    if (!hasCustomer) out.push({ key: "customer", label: "Müşteri", tab: "randevu", field: "appointment-customer" });
    if (!hasProperty) out.push({ key: "property", label: "Portföy", tab: "randevu", field: "appointment-property" });
    return out;
  }
  if (hasCustomer || hasProperty) return [];
  return [{ key: "party", label: "Müşteri ya da portföy", tab: "randevu", field: "appointment-customer" }];
}

/** Taslağa yalnız hassas olmayan, kontrolsüz alanlar (tür/tarih/saat kontrollü ve bağlamdan gelir; not YOK). */
export const APPOINTMENT_DRAFT_FIELDS = ["duration_min"] as const;
