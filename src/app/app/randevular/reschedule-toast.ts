import type { RescheduleNotice } from "@/lib/appointment-customer-messages";

/**
 * GA-01/GA-02 ortak bildirim metni: saat değişince müşteriye yeni saat SMS ile gitti mi, yoksa danışman WhatsApp'tan mı
 * iletmeli? (Düzenleme paneli ve takvimde sürükle-bırak aynı metni gösterir.)
 */
export function rescheduleToast(r: RescheduleNotice | undefined): {
  message: string;
  action?: { action: { label: string; onClick: () => void } };
} {
  if (!r) return { message: "Randevu güncellendi." };
  if (r.outcome === "sms_sent") return { message: "Randevu taşındı; müşteriye yeni saat SMS ile iletildi, teyit yenilendi." };
  const href = r.waHref;
  if (href) {
    return {
      message: "Randevu taşındı; müşteri teyidi sıfırlandı. Yeni saati müşteriye bildirin.",
      action: { action: { label: "WhatsApp'tan bildirin", onClick: () => window.open(href, "_blank", "noopener,noreferrer") } },
    };
  }
  return { message: "Randevu taşındı; müşteri teyidi sıfırlandı." };
}
