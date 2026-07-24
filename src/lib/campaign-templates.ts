/**
 * Hazır kampanya mesaj şablonları (SMS/WhatsApp/e-posta).
 * {ad}, {ofis} gibi değişkenler gönderim sırasında müşteri/ofis verisiyle değişir.
 */
export type CampaignTemplate = {
  id: string;
  label: string;
  category: "firsat" | "bilgi" | "hatirlatma" | "kutlama";
  message: string;
};

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "yeni-portfoy",
    label: "Yeni portföy duyurusu",
    category: "firsat",
    message: "Merhaba {ad}, aradığınız kriterlere uygun yeni portföyler ekledik. Detaylar için bize ulaşın. {ofis}",
  },
  {
    id: "fiyat-indirimi",
    label: "Fiyat güncellemesi",
    category: "firsat",
    message: "Sayın {ad}, ilgilendiğiniz bölgede fiyatı güncellenen fırsatlar var. Kaçırmadan görüşelim mi? {ofis}",
  },
  {
    id: "randevu-daveti",
    label: "Yer gösterme daveti",
    category: "bilgi",
    message: "Merhaba {ad}, size özel seçtiğimiz portföyler için yerinde inceleme randevusu ayarlayalım. {ofis}",
  },
  {
    id: "degerleme-teklifi",
    label: "Ücretsiz değerleme",
    category: "firsat",
    message: "Sayın {ad}, mülkünüzün güncel piyasa değerini ücretsiz öğrenmek ister misiniz? {ofis}",
  },
  {
    id: "sozlesme-hatirlatma",
    label: "Sözleşme yenileme hatırlatması",
    category: "hatirlatma",
    message: "Merhaba {ad}, kira sözleşmenizin yenileme dönemi yaklaşıyor. Süreci birlikte planlayalım. {ofis}",
  },
  {
    id: "bayram-kutlama",
    label: "Bayram / özel gün kutlaması",
    category: "kutlama",
    message: "Sayın {ad}, özel gününüzü kutlar, sağlık ve mutluluk dileriz. {ofis}",
  },
  {
    id: "tesekkur",
    label: "İşlem sonrası teşekkür",
    category: "kutlama",
    message: "Sayın {ad}, bizi tercih ettiğiniz için teşekkür ederiz. Her zaman yanınızdayız. {ofis}",
  },
];

export const CAMPAIGN_CATEGORY_LABELS: Record<CampaignTemplate["category"], string> = {
  firsat: "Fırsat",
  bilgi: "Bilgilendirme",
  hatirlatma: "Hatırlatma",
  kutlama: "Kutlama",
};
