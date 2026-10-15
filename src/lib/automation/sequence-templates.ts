import type { SequenceStepDraft } from "@/lib/automation/sequence-rules";

/**
 * Hazır takip dizileri (COM-05): "Yeni dizi" ekranına `?sablon=<anahtar>` ile dolu gelir; kullanıcı düzenleyip kaydeder.
 * WhatsApp adımı onaylı şablon adı ister, bu yüzden hazır dizilerde mesaj adımları SMS + görevdir.
 */
export type SequenceTemplate = {
  key: string;
  name: string;
  description: string;
  steps: SequenceStepDraft[];
};

export const SEQUENCE_TEMPLATES: readonly SequenceTemplate[] = [
  {
    key: "yeni-talep",
    name: "Yeni talep: ilk 2 hafta",
    description: "Yeni gelen talebe gün 0 karşılama, gün 1 arama, gün 3 hatırlatma, gün 7 ve gün 14 takip.",
    steps: [
      { step_type: "sms", delay_days: 0, config: { text: "Merhaba {{name}}, talebiniz bize ulaştı. Size uygun portföyleri hazırlıyoruz; danışmanımız kısa süre içinde sizi arayacak." } },
      { step_type: "task", delay_days: 1, config: { title: "Talep sahibini ara, ihtiyacı netleştir", priority: "high" } },
      { step_type: "sms", delay_days: 2, config: { text: "Merhaba {{name}}, aradığınız mülk için birkaç seçenek hazırladık. Uygun olduğunuz bir zamanı yazarsanız sizi arayalım." } },
      { step_type: "task", delay_days: 4, config: { title: "Uygun portföyleri gönder, yer gösterme öner", priority: "normal" } },
      { step_type: "task", delay_days: 7, config: { title: "İki haftalık takip: talep hâlâ güncel mi?", priority: "normal" } },
    ],
  },
  {
    key: "yer-gosterme-sonrasi",
    name: "Yer gösterme sonrası takip",
    description: "Gezilen mülkten sonra ertesi gün geri bildirim, 3. gün yeni seçenek, 10. gün yeniden temas.",
    steps: [
      { step_type: "task", delay_days: 1, config: { title: "Yer gösterme geri bildirimini al", priority: "high" } },
      { step_type: "sms", delay_days: 2, config: { text: "Merhaba {{name}}, gezdiğiniz mülk hakkında aklınıza takılan bir şey olursa bize yazabilirsiniz. Benzer yeni seçenekleri de paylaşabiliriz." } },
      { step_type: "task", delay_days: 7, config: { title: "Yeni benzer portföyleri öner", priority: "normal" } },
    ],
  },
  {
    key: "uyuyan-musteri",
    name: "Uzun süredir sessiz müşteri",
    description: "Bir süredir temas olmayan müşteriyi yeniden ısıtmak için iki mesaj ve bir arama görevi.",
    steps: [
      { step_type: "sms", delay_days: 0, config: { text: "Merhaba {{name}}, uzun zamandır görüşemedik. Emlak planlarınızda bir değişiklik varsa size güncel piyasa bilgisini paylaşmak isteriz." } },
      { step_type: "task", delay_days: 5, config: { title: "Sessiz müşteriyi ara, ihtiyacı güncelle", priority: "normal" } },
      { step_type: "sms", delay_days: 25, config: { text: "Merhaba {{name}}, bölgenizde bu ay yeni portföyler yayına girdi. İlgilenirseniz size özel bir liste hazırlayabiliriz." } },
    ],
  },
];

export function sequenceTemplate(key: string | null | undefined): SequenceTemplate | null {
  return SEQUENCE_TEMPLATES.find((t) => t.key === key) ?? null;
}
