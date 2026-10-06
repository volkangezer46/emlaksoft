import type { PillTone } from "@/components/ui/list-kit";

/** Randevu listesi saf yardımcıları (sayfadan ayrıldı: test edilebilir). */

export { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Teyit bekliyor",
  confirmed: "Onaylandı",
  signature: "İmza eksik",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

/** Süzgeç çipi olarak sunulan durumlar (iptaller listede hiç yok). */
export const FILTERABLE_STATUSES = ["pending", "confirmed", "signature", "completed"] as const;

export function appointmentStatusTone(status: string): PillTone {
  switch (status) {
    case "pending":
      return "warning";
    case "confirmed":
      return "info";
    case "signature":
      return "danger";
    case "completed":
      return "success";
    default:
      return "neutral"; // cancelled
  }
}

export function appointmentTypeTone(type: string): PillTone {
  switch (type) {
    case "showing":
      return "info";
    case "valuation":
      return "warning";
    case "contract":
      return "success";
    default:
      return "neutral"; // office
  }
}

/** Müşterinin teyit linkinden verdiği yanıt. */
export const CUSTOMER_RESPONSE_META: Record<string, { label: string; tone: PillTone }> = {
  coming: { label: "Geliyorum", tone: "success" },
  cancelled: { label: "İptal etti", tone: "danger" },
};

export const OUTCOME_TONE: Record<string, PillTone> = {
  olumlu: "success",
  kararsiz: "warning",
  olumsuz: "danger",
};

/** Süresi geçmiş (bugünden önceki) randevuda "bekliyor/imza" durumları takip gerektirir. */
export function needsFollowUp(status: string, scheduledAtMs: number, nowMs: number): boolean {
  return scheduledAtMs < nowMs && (status === "pending" || status === "signature");
}

/** Tür sayaçlarından "Tümü" toplamı. */
export function sumCounts(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
