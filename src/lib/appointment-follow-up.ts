/**
 * Gösterim sonrası takip zinciri — SAF çekirdek (istemci ve sunucu güvenle import eder; DB/ağ yok).
 *
 * Randevu "Tamamlandı" + sonuç seçilince bir sonraki adım:
 *  - olumlu   → "Teklif gir" (/app/teklifler/yeni, müşteri + portföy ön dolgulu)
 *  - kararsız → danışmana 2 iş günü sonrasına takip görevi (sunucu eylemi açar) + "2. gösterim planla"
 *  - olumsuz  → "Talebi güncelle" (müşteri kartının Talepler sekmesi)
 * Bağlantılar ön dolgu sözleşmesinin kanonik adlarını kullanır (`prefillHref`).
 */
import { addBusinessDaysMs } from "@/lib/eids/actions-core";
import type { AppointmentOutcome } from "@/lib/appointment-outcome";
import { prefillHref } from "@/lib/prefill-params";

/** Kararsız sonucun takip görevi kaç İŞ GÜNÜ sonrasına açılır (Cumartesi/Pazar atlanır). */
export const UNDECIDED_FOLLOW_UP_BUSINESS_DAYS = 2;

/**
 * Takip görevinin not alanına yazılan iz: aynı randevu yeniden kaydedilse (geri al → tekrar tamamla) de ikinci
 * görev açılmaz — sunucu bu izi taşıyan görev var mı diye bakar.
 */
export function followUpTaskMarker(appointmentId: string): string {
  return `randevu-takip:${appointmentId}`;
}

export function followUpTaskTitle(customerName: string | null | undefined): string {
  const name = (customerName ?? "").trim();
  return `${name || "Müşteri"} — gösterim sonrası takip (kararsız)`;
}

export function followUpTaskNotes(appointmentId: string, outcomeNote: string | null | undefined): string {
  const note = (outcomeNote ?? "").trim();
  return [
    "Gösterim kararsız geçti: müşteriyi arayıp tereddüdünü öğrenin, gerekirse ikinci gösterim planlayın.",
    note ? `Randevu notu: ${note}` : null,
    `(${followUpTaskMarker(appointmentId)})`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Takip görevinin bitiş zamanı (ISO): `nowMs`'den 2 iş günü sonra, TR 18:00. */
export function followUpDueIso(nowMs: number): string {
  return new Date(addBusinessDaysMs(nowMs, UNDECIDED_FOLLOW_UP_BUSINESS_DAYS)).toISOString();
}

export type AppointmentNextStep = { label: string; href: string; hint: string };

/** Sonuca göre önerilen sonraki adım bağlantıları (müşteri yoksa bağlantı üretilmez). */
export function appointmentNextSteps(
  outcome: AppointmentOutcome | null | undefined,
  ids: { customerId: string | null; propertyId: string | null },
): AppointmentNextStep[] {
  if (!outcome || !ids.customerId) return [];
  if (outcome === "olumlu") {
    return [
      {
        label: "Teklif gir",
        href: prefillHref("/app/teklifler/yeni", ids),
        hint: "Müşteri ve portföy hazır gelir.",
      },
    ];
  }
  if (outcome === "kararsiz") {
    return [
      {
        label: "2. gösterim planla",
        href: prefillHref("/app/randevular/yeni", ids),
        hint: "Aynı müşteri ve portföyle yeni randevu.",
      },
    ];
  }
  return [
    {
      label: "Talebi güncelle",
      href: `/app/musteriler/${ids.customerId}?sekme=talepler`,
      hint: "Müşterinin arama kriterlerini gözden geçirin.",
    },
  ];
}
