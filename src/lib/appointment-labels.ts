/**
 * Randevu türü etiketleri — TEK KAYNAK (ana ekran, takvim, hafta görünümü, liste, ICS, dışa aktarma, zaman çizelgesi
 * eskiden kendi kopyasını tutuyordu). Bilinmeyen tür ham değeriyle gösterilir.
 */
export const APPOINTMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  showing: "Yer gösterme",
  office: "Ofis görüşmesi",
  valuation: "Değerleme",
  contract: "Sözleşme",
};

export function appointmentTypeLabel(type: string | null | undefined): string {
  if (!type) return "";
  return APPOINTMENT_TYPE_LABELS[type] ?? type;
}
