import type { PlaybookAssignTo, PlaybookTriggerEvent } from "@/lib/playbook-engine";

/**
 * Hazır iş akışı şablonları — "boş ekran" problemine karşı.
 *
 * Bir emlak ofisi "iş akışı" kavramını soyut bulur; ama "yeni satılık portföy
 * alınca tapu fotokopisi + fotoğraf + portal + komşu + fiyat kontrolü" listesini
 * zaten kafasında taşır. Bu sabitler o listeyi tek tıkla kopyalanabilir hâle
 * getirir. Kopya PASİF açılır (playbooks.is_active default false): ofis adımları
 * kendine göre düzenleyip yayına alır.
 *
 * Şablonlar SERVER ACTION dosyasında değil burada yaşar — `"use server"` taşıyan
 * bir dosyadan export edilen her şey uç nokta olur; sabit veri orada duramaz.
 */

export type PlaybookTemplateStep = {
  title: string;
  kind: "followup" | "call" | "visit" | "document" | "other";
  priority: "low" | "normal" | "high";
  offset_days: number;
  assign_to: PlaybookAssignTo;
  note?: string;
};

export type PlaybookTemplate = {
  key: string;
  name: string;
  description: string;
  trigger_event: PlaybookTriggerEvent;
  /** Basit eşitlik filtresi — null ise akış olayın her örneğinde çalışır. */
  filter: Record<string, string> | null;
  steps: PlaybookTemplateStep[];
};

export const PLAYBOOK_TEMPLATES: PlaybookTemplate[] = [
  {
    key: "yeni_satilik_portfoy",
    name: "Yeni satılık portföy — ilk 14 gün",
    description:
      "Satılık portföy alındığında evrak, görsel, portal ve fiyat kontrolü adımlarını sırayla açar.",
    trigger_event: "yeni_portfoy",
    filter: { transaction_type: "Satılık" },
    steps: [
      { title: "Tapu fotokopisi ve kimlik iste", kind: "document", priority: "high",   offset_days: 0,  assign_to: "owner", note: "Yetki belgesi eklerine konulacak." },
      { title: "Profesyonel fotoğraf çekimi yap",  kind: "visit",    priority: "high",   offset_days: 2,  assign_to: "owner" },
      { title: "İlanı portallara yükle",           kind: "other",    priority: "high",   offset_days: 3,  assign_to: "owner", note: "Sahibinden / Hepsiemlak / vitrin." },
      { title: "Komşulara ve çevreye haber ver",   kind: "call",     priority: "normal", offset_days: 5,  assign_to: "owner", note: "Alıcı çoğu zaman aynı sokaktan çıkar." },
      { title: "İlk fiyat değerlendirmesi yap",    kind: "followup", priority: "normal", offset_days: 14, assign_to: "owner", note: "14 günde gelen talep sayısına göre fiyat revizyonu konuş." },
    ],
  },
  {
    key: "yeni_musteri_karsilama",
    name: "Yeni müşteri karşılama akışı",
    description:
      "Yeni müşteri kaydında ilk arama, ihtiyaç analizi, portföy sunumu ve geri bildirim adımlarını açar.",
    trigger_event: "yeni_musteri",
    filter: null,
    steps: [
      { title: "Hoş geldin araması yap",             kind: "call",     priority: "high",   offset_days: 0,  assign_to: "creator", note: "İlk 5 dakika kuralı — en geç bugün aranmalı." },
      { title: "İhtiyaç analizi görüşmesi",          kind: "followup", priority: "high",   offset_days: 1,  assign_to: "owner",   note: "Bütçe, bölge, oda sayısı, taşınma tarihi netleşsin." },
      { title: "Uygun portföy listesi gönder",       kind: "other",    priority: "normal", offset_days: 3,  assign_to: "owner" },
      { title: "Gönderilen portföyler için geri bildirim al", kind: "call", priority: "normal", offset_days: 7, assign_to: "owner" },
      { title: "30. gün ilgi kontrolü",              kind: "followup", priority: "low",    offset_days: 30, assign_to: "owner",   note: "Hâlâ arıyor mu, kriterleri değişti mi?" },
    ],
  },
  {
    key: "anlasma_kapanis_takibi",
    name: "Anlaşma kapanış takibi",
    description:
      "Anlaşma kazanıldığında tapu, komisyon faturası, teşekkür ve tavsiye adımlarını takvimler.",
    trigger_event: "anlasma_kazanildi",
    filter: null,
    steps: [
      { title: "Tapu randevusunu planla",             kind: "visit",    priority: "high",   offset_days: 0,  assign_to: "owner" },
      { title: "Komisyon faturasını kes",             kind: "document", priority: "high",   offset_days: 2,  assign_to: "owner" },
      { title: "Müşteriye teşekkür et ve tavsiye iste", kind: "call",   priority: "normal", offset_days: 5,  assign_to: "owner", note: "Referans en ucuz müşteri kaynağı." },
      { title: "Memnuniyet anketi gönder",            kind: "followup", priority: "normal", offset_days: 10, assign_to: "owner" },
      { title: "3. ay yeniden temas",                 kind: "followup", priority: "low",    offset_days: 90, assign_to: "owner", note: "Yatırımcıysa yeni fırsat, oturacaksa referans." },
    ],
  },
  {
    key: "kira_sozlesmesi_sonrasi",
    name: "Kira sözleşmesi sonrası",
    description:
      "Kira kaydı açıldığında sözleşme, depozito, anahtar teslim ve ilk ay kontrolü adımlarını açar.",
    trigger_event: "kira_sozlesmesi",
    filter: null,
    steps: [
      { title: "Sözleşme nüshalarını imzalat ve arşivle", kind: "document", priority: "high",   offset_days: 0,  assign_to: "owner" },
      { title: "Depozito ve ilk kira tahsilatını doğrula", kind: "followup", priority: "high",  offset_days: 1,  assign_to: "owner" },
      { title: "Anahtar teslim tutanağını tamamla",       kind: "visit",    priority: "normal", offset_days: 2,  assign_to: "owner", note: "Sayaç endeksleri tutanağa yazılsın." },
      { title: "İlk ay kira ödemesi kontrolü",            kind: "followup", priority: "normal", offset_days: 30, assign_to: "owner" },
    ],
  },
  {
    key: "yeni_talep_eslestirme",
    name: "Yeni talep — eşleştirme takibi",
    description:
      "Talep kaydedildiğinde portföy taraması, sunum ve geri bildirim adımlarını sıraya koyar.",
    trigger_event: "talep_olusturuldu",
    filter: null,
    steps: [
      { title: "Uygun portföyleri tara ve listele", kind: "followup", priority: "high",   offset_days: 0, assign_to: "creator" },
      { title: "Seçilen portföyleri müşteriye sun", kind: "other",    priority: "normal", offset_days: 1, assign_to: "owner" },
      { title: "Yerinde gezme randevusu ayarla",    kind: "call",     priority: "normal", offset_days: 3, assign_to: "owner" },
      { title: "Gezme sonrası geri bildirim al",    kind: "followup", priority: "normal", offset_days: 7, assign_to: "owner" },
    ],
  },
];

export function findPlaybookTemplate(key: string): PlaybookTemplate | undefined {
  return PLAYBOOK_TEMPLATES.find((t) => t.key === key);
}
