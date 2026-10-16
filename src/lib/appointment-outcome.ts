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

export const APPOINTMENT_OUTCOMES = ["olumlu", "kararsiz", "olumsuz", "gelmedi"] as const;

export type AppointmentOutcome = (typeof APPOINTMENT_OUTCOMES)[number];

export const APPOINTMENT_OUTCOME_META: Record<
  AppointmentOutcome,
  { label: string; cls: string }
> = {
  olumlu:   { label: "Olumlu",   cls: "bg-mint-500/10 text-mint-600" },
  kararsiz: { label: "Kararsız", cls: "bg-amber-400/15 text-amber-600" },
  olumsuz:  { label: "Olumsuz",  cls: "bg-danger-500/10 text-danger-500" },
  // GA-14 (migration 20261018040000): müşteri randevuya gelmedi — takip görevi + "yeniden planlayalım mı" taslağı.
  gelmedi:  { label: "Gelmedi",  cls: "bg-danger-500/10 text-danger-600" },
};

export function isAppointmentOutcome(v: string): v is AppointmentOutcome {
  return (APPOINTMENT_OUTCOMES as readonly string[]).includes(v);
}
