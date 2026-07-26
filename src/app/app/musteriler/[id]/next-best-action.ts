/**
 * Sonraki en iyi aksiyon — kural motoru (şema değişikliği yok, AI yok).
 * Müşteri 360 sayfasının zaten çektiği verilerden tek bir öneri üretir;
 * hiçbir kural eşleşmezse `null` döner ve kart hiç gösterilmez.
 *
 * Kural önceliği (ilk eşleşen kazanır):
 * 1. Son temas 14+ gün + sıcak lead + telefon var → "Şimdi ara"
 * 2. Açık talep var + aday portföy var → "Eşleştir"
 * 3. Sunulmuş (submitted) teklif yanıt bekliyor → "Teklifi takip et"
 * 4. Geçmiş randevunun sonucu girilmemiş → "Sonucu kaydet"
 */

import { DAY_MS, msSince } from "@/lib/clock";

export type NextBestActionInput = {
  customerId: string;
  leadTier: "hot" | "warm" | "cold";
  leadLabel: string;            // "Sıcak" | "Ilık" | "Soğuk"
  hasPhone: boolean;
  lastActivityAt: string | null; // en son çağrı/randevu/iletişim (ISO)
  createdAt: string;             // müşteri kaydı (ISO)
  openDemandCount: number;       // new/active talepler
  candidatePropertyCount: number; // eşleşmeye aday aktif portföy sayısı
  submittedOfferId: string | null; // status=submitted ilk teklif
  pastAppointmentPending: boolean; // scheduled_at geçmiş + pending/confirmed
};

export type NextBestAction = {
  key: "call" | "match" | "offer" | "appointment";
  title: string;   // kart başlığı
  action: string;  // buton etiketi
  reason: string;  // gerekçe alt yazısı
  /** `tel:` gibi harici href — varsa <a>, yoksa `href` ile <Link> kullanılır */
  externalHref?: string;
  href?: string;
};

const CONTACT_GAP_DAYS = 14;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor(msSince(t) / DAY_MS);
}

export function computeNextBestAction(
  input: NextBestActionInput,
  telHref: string | null,
): NextBestAction | null {
  const gap = daysSince(input.lastActivityAt ?? input.createdAt);

  // 1) Sıcak lead soğumasın — 14+ gün temassız
  if (
    gap !== null &&
    gap >= CONTACT_GAP_DAYS &&
    input.leadTier === "hot" &&
    input.hasPhone &&
    telHref
  ) {
    return {
      key: "call",
      title: "Sıcak müşteri soğumak üzere",
      action: "Şimdi ara",
      reason: `${gap} gündür temas yok · skor: ${input.leadLabel.toLocaleLowerCase("tr-TR")}`,
      externalHref: telHref,
    };
  }

  // 2) Açık talep + aday portföy → eşleştirme fırsatı
  if (input.openDemandCount > 0 && input.candidatePropertyCount > 0) {
    return {
      key: "match",
      title: "Yeni eşleşme fırsatı olabilir",
      action: "Eşleştir",
      reason: `${input.openDemandCount} açık talep · ${input.candidatePropertyCount} aktif portföy taranabilir`,
      href: `/app/eslestirme?customer=${input.customerId}`,
    };
  }

  // 3) Sunulmuş teklif yanıt bekliyor
  if (input.submittedOfferId) {
    return {
      key: "offer",
      title: "Teklif yanıt bekliyor",
      action: "Teklifi takip et",
      reason: "Sunulan teklif henüz yanıtlanmadı · nazik bir hatırlatma zamanı",
      href: `/app/teklifler/${input.submittedOfferId}`,
    };
  }

  // 4) Geçmiş randevunun sonucu girilmemiş
  if (input.pastAppointmentPending) {
    return {
      key: "appointment",
      title: "Randevu sonucu eksik",
      action: "Sonucu kaydet",
      reason: "Tarihi geçmiş randevu tamamlandı/iptal olarak işaretlenmedi",
      href: `/app/randevular?customer=${input.customerId}`,
    };
  }

  return null;
}
