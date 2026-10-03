/**
 * Ortak durum etiket sözlükleri — yalnız birden çok ekranda BİREBİR aynı olanlar.
 * (Ekrana özgü etiketler yerelde kalır; farklı anlam taşıyanlar birleştirilmez.)
 */

/** `projects.status` etiketleri. */
export const PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: "Planlama",
  selling: "Satışta",
  delivered: "Teslim edildi",
};

/** `open_houses.status` etiketleri. */
export const OPEN_HOUSE_STATUS_LABELS: Record<string, string> = {
  planned: "Planlandı",
  active: "Devam ediyor",
  completed: "Tamamlandı",
  cancelled: "İptal",
};
