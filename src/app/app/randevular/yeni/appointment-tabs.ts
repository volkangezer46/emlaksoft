/**
 * Yeni randevu formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 * `confirm_conflict`: çakışma uyarı bandındaki gizli onay alanı (sekmeden bağımsız, yalnız çakışmada render edilir).
 */
import { hasValue, type FormRuleIssue } from "@/lib/form-rules";

export const APPOINTMENT_FORM_ID = "yeni-randevu";

export const APPOINTMENT_TABS = [
  {
    id: "zaman",
    label: "Zaman",
    description: "Randevunun türü, günü ve süresi.",
    fields: ["appointment_type", "duration_min", "date", "time", "confirm_conflict"],
    required: ["appointment_type", "date", "time"],
  },
  {
    id: "katilimci",
    label: "Katılımcılar ve yer",
    description: "Müşteri ve portföy yazarak aranır (Türkçe karakter duyarsız).",
    fields: ["assigned_to", "customer_id", "property_id", "location", "notes"],
    required: [],
  },
] as const;

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
    if (!hasCustomer) out.push({ key: "customer", label: "Müşteri", tab: "katilimci", field: "appointment-customer" });
    if (!hasProperty) out.push({ key: "property", label: "Portföy", tab: "katilimci", field: "appointment-property" });
    return out;
  }
  if (hasCustomer || hasProperty) return [];
  return [{ key: "party", label: "Müşteri ya da portföy", tab: "katilimci", field: "appointment-customer" }];
}

/** Taslağa yalnız hassas olmayan, kontrolsüz seçimler (tarih/saat ?tarih ?saat ön dolgusunu ezmesin; not YOK). */
export const APPOINTMENT_DRAFT_FIELDS = ["appointment_type", "duration_min"] as const;
