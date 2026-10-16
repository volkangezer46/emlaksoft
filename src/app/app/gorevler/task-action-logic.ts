/**
 * Görevi işine bağlama (sadeleştirme C19) — SAF. "Tamamla" düğmesi işi yaptırmadan görevi kapatıyordu; görev bir
 * eylem tarif ediyorsa kartın birincil düğmesi o eylemi başlatır, eylem bitince görev kapanır:
 *  - Arama görevi (tür `call` ya da başlıkta "ara") + müşterinin telefonu → "Ara": telefon açılır, dönüşte sonuç seçilir
 *    (Ulaşıldı → görüşme kaydı + görev biter; Açmadı → görüşme kaydı + görev yarın 10:00'a taşınır).
 *  - "Eşleşen portföyleri / ilanları gönder" görevi + müşteri → "Gönder": müşterinin uygun ilan ekranı açılır ve görev
 *    kapanır (geri alınabilir).
 * Diğer görevlerde yalnız "Bitti" kalır.
 */

export type TaskAction =
  | { type: "call"; label: "Ara"; phone: string; customerId: string }
  | { type: "send"; label: "Gönder"; href: string; customerId: string };

const SEND_RE = /(eşleş|uygun)[^\n]*(portföy|ilan)|(portföy|ilan)[^\n]*(gönder|paylaş)|sunum[^\n]*gönder/iu;
const CALL_RE = /(^|\s)(ara|arayın|aranacak|geri ara)(\s|$|[.,!])/iu;

export function taskActionFor(task: {
  id: string;
  kind: string;
  title: string;
  status: string;
  customer_id: string | null;
  customerPhone?: string | null;
}): TaskAction | null {
  if (task.status !== "open" || !task.customer_id) return null;
  const title = task.title.toLocaleLowerCase("tr-TR");
  if (SEND_RE.test(title)) {
    return {
      type: "send",
      label: "Gönder",
      customerId: task.customer_id,
      href: `/app/talepler?sekme=eslesme&customer=${task.customer_id}`,
    };
  }
  const phone = (task.customerPhone ?? "").trim();
  if (phone && (task.kind === "call" || CALL_RE.test(title))) {
    return { type: "call", label: "Ara", phone, customerId: task.customer_id };
  }
  return null;
}

/** tel: bağlantısı: yalnız rakam ve baştaki +. */
export function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
}
