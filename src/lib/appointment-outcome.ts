/**
 * Randevu sonucu — danışmanın "Tamamlandı" derken verdiği kısa değerlendirme
 * (migration 20260729000126, `appointments.outcome` + `outcome_note`).
 *
 * DİKKAT: bu, müşteri portalındaki eşleştirme geri bildirimi
 * (`portal_match_feedback`, liked/disliked) DEĞİLDİR. O geri bildirim
 * eşleştirme skorunu besler; buradaki outcome yalnız randevunun nasıl geçtiğini
 * kaydeder ve skora girmez.
 *
 * Server action ("use server") dosyalarından sabit export edilemediği için
 * (orada yalnız async fonksiyon export edilebilir) tek doğruluk kaynağı burası.
 */

export const APPOINTMENT_OUTCOMES = ["olumlu", "kararsiz", "olumsuz"] as const;

export type AppointmentOutcome = (typeof APPOINTMENT_OUTCOMES)[number];

export const APPOINTMENT_OUTCOME_META: Record<
  AppointmentOutcome,
  { label: string; emoji: string; cls: string }
> = {
  olumlu:   { label: "Olumlu",   emoji: "👍", cls: "bg-mint-500/10 text-mint-600" },
  kararsiz: { label: "Kararsız", emoji: "🤔", cls: "bg-amber-400/15 text-amber-600" },
  olumsuz:  { label: "Olumsuz",  emoji: "👎", cls: "bg-danger-500/10 text-danger-500" },
};

export function isAppointmentOutcome(v: string): v is AppointmentOutcome {
  return (APPOINTMENT_OUTCOMES as readonly string[]).includes(v);
}
