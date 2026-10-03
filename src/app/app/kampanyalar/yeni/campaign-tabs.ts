/**
 * Yeni kampanya formunun sekme tanımı (veri: ikon yok) — form bileşeni ve
 * `src/lib/form-tabs-contract.test.ts` aynı kaynağı kullanır.
 *
 * `required` burada STATİK taban: WhatsApp şablon alanları ve SMS mesajı kanala göre
 * zorunlu olur; form bileşeni sekme listesini kanala göre genişletir.
 */
export const CAMPAIGN_FORM_ID = "yeni-kampanya";

export const CAMPAIGN_TABS = [
  {
    id: "kanal",
    label: "Kampanya ve kanal",
    description: "Başlık, gönderim kanalı ve hedef kitle. Yalnız açık kanal izni olan alıcılara teslim edilir.",
    fields: ["title", "channel", "filter"],
    required: ["title"],
  },
  {
    id: "icerik",
    label: "Mesaj ve şablon",
    description: "SMS metni ya da Meta onaylı WhatsApp şablonu.",
    fields: ["whatsappTemplateName", "whatsappTemplateLanguage", "message"],
    required: [],
  },
] as const;

/** Kanala göre ek zorunlu alanlar (sekme id -> alanlar). */
export const CAMPAIGN_REQUIRED_BY_CHANNEL = {
  sms: { icerik: ["message"] },
  whatsapp: { icerik: ["whatsappTemplateName", "whatsappTemplateLanguage"] },
} as const;

/** Taslağa yazılabilen alanlar: yalnız hedef kitle seçimi (mesaj gövdesi hassas; kanal kontrollü). */
export const CAMPAIGN_DRAFT_FIELDS = ["filter"] as const;
