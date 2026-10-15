import { CLOSED_APPOINTMENT_STATUSES, isAppointmentStatus, type AppointmentStatus } from "@/lib/workflow-state";

/**
 * Malik portalı randevu rozeti + anonim özet. Portal son 30 günün randevularını HER durumda yükler; rozet yalnız
 * "confirmed"e bakınca tamamlanmış/iptal randevular "Teyit Bekliyor" görünüyordu. Etiket/ton durumdan türetilir;
 * geçmişte kalıp kapanmamış (bekleyen/onaylı) randevu "Sonuç bekleniyor" olur.
 * Gizlilik: özet yalnız SAYI üretir — ziyaretçi kimliği ve danışman notu (outcome_note) malike asla taşınmaz.
 */
export type OwnerApptTone = "success" | "warning" | "info" | "neutral" | "danger";

export const OWNER_APPT_STATUS_LABELS: Readonly<Record<AppointmentStatus, string>> = {
  pending: "Teyit bekliyor",
  confirmed: "Onaylandı",
  signature: "İmza aşamasında",
  completed: "Gerçekleşti",
  cancelled: "İptal edildi",
};

const STATUS_TONES: Readonly<Record<AppointmentStatus, OwnerApptTone>> = {
  pending: "warning",
  confirmed: "success",
  signature: "info",
  completed: "neutral",
  cancelled: "danger",
};

export const OWNER_APPT_TONE_CLASSES: Readonly<Record<OwnerApptTone, string>> = {
  success: "bg-mint-500/12 text-mint-700",
  warning: "bg-amber-400/15 text-amber-700",
  info: "bg-brand-600/10 text-brand-600",
  neutral: "bg-ink-950/5 text-text-muted",
  danger: "bg-danger-500/10 text-danger-600",
};

export function ownerAppointmentBadge(
  status: string,
  scheduledAt: string,
  nowMs: number,
): { label: string; tone: OwnerApptTone } {
  if (!isAppointmentStatus(status)) return { label: "Durum bilinmiyor", tone: "neutral" };
  const isPast = new Date(scheduledAt).getTime() < nowMs;
  if (isPast && !CLOSED_APPOINTMENT_STATUSES.includes(status) && status !== "signature") {
    return { label: "Sonuç bekleniyor", tone: "neutral" };
  }
  return { label: OWNER_APPT_STATUS_LABELS[status], tone: STATUS_TONES[status] };
}

export type OwnerShowingSummary = { showings: number; positive: number };

/**
 * Son 30 günde GERÇEKLEŞEN (completed) yer göstermeler ve bunların "olumlu" değerlendirilenleri. Girdi satırları
 * yalnız tür/durum/sonuç taşır; başka alan okunmaz.
 */
export function summarizeOwnerShowings(
  rows: readonly { appointment_type: string | null; status: string | null; outcome?: string | null }[],
): OwnerShowingSummary {
  let showings = 0;
  let positive = 0;
  for (const r of rows) {
    if (r.appointment_type !== "showing" || r.status !== "completed") continue;
    showings += 1;
    if (r.outcome === "olumlu") positive += 1;
  }
  return { showings, positive };
}

export function ownerShowingSummaryText(s: OwnerShowingSummary): string {
  return `Son 30 gün: ${s.showings} gösterim, ${s.positive} olumlu`;
}
