/** İletişim kanal ve sonuç tanımları — client+server tarafında kullanılabilir */

export const COMM_CHANNELS = [
  { value: "call",      label: "Telefon",  emoji: "📞" },
  { value: "whatsapp",  label: "WhatsApp", emoji: "💬" },
  { value: "sms",       label: "SMS",      emoji: "✉️" },
  { value: "email",     label: "E-posta",  emoji: "📧" },
  { value: "meeting",   label: "Görüşme",  emoji: "🤝" },
  { value: "note",      label: "Not",      emoji: "📝" },
] as const;

export type CommChannel = typeof COMM_CHANNELS[number]["value"];

export const COMM_OUTCOMES = [
  { value: "randevu_alindi",     label: "Randevu alındı" },
  { value: "geri_aranacak",      label: "Geri aranacak" },
  { value: "mesaj_gonderildi",   label: "Mesaj gönderildi" },
  { value: "portfoy_gonderildi", label: "Portföy gönderildi" },
  { value: "ilgileniyor",        label: "İlgileniyor" },
  { value: "ilgilenmiyor",       label: "İlgilenmiyor" },
  { value: "ulasilamadi",        label: "Ulaşılamadı" },
  { value: "mesgul",             label: "Meşgul" },
  { value: "bilgi_verildi",      label: "Bilgi verildi" },
  { value: "teklif_yapildi",     label: "Teklif yapıldı" },
  { value: "kaybedildi",         label: "Kaybedildi" },
] as const;

export type CommOutcome = typeof COMM_OUTCOMES[number]["value"];
