import type { PillTone } from "@/components/ui/list-kit";

/** Teklif listesi saf yardımcıları (sayfadan ayrıldı: test edilebilir). */

export const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  submitted: "Sunuldu",
  countered: "Karşı teklif",
  accepted: "Kabul edildi",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
};

/** Durum → kapsül tonu (renk tek başına anlam taşımaz; metin her zaman var). */
export function offerStatusTone(status: string): PillTone {
  switch (status) {
    case "submitted":
      return "info";
    case "countered":
      return "warning";
    case "accepted":
      return "success";
    case "rejected":
      return "danger";
    default:
      return "neutral"; // draft, withdrawn
  }
}

/** Masadaki rakam: karşı teklif geldiyse odur, yoksa ilk teklif. */
export function offerTableValue(o: { amount: number | null; counter: number | null }): number {
  return o.counter ?? o.amount ?? 0;
}

/** Tutar toplamı; tarama tavana dayandıysa (kesik olabilir) null → rakam gösterilmez. */
export function offerVolume(
  rows: ReadonlyArray<{ amount: number | null; counter: number | null }>,
  scanLimit: number,
): number | null {
  if (rows.length >= scanLimit) return null;
  return rows.reduce((s, o) => s + offerTableValue(o), 0);
}
