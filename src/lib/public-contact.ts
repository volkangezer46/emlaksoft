import { formatPhoneDisplay, toTelHref, toWhatsAppLink, toWhatsAppMsisdn } from "@/lib/phone";

/**
 * Herkese açık müşteri yüzeylerinin (vitrin, ilan, paylaşım, sunum, müşteri/malik portalı, randevu teyidi, açık ev,
 * tavsiye) iletişim kaynağı — TEK KAYNAK (SK8 B148). Sayfalar telefonu kendileri seçmez; bunu çağırır ve sonucu
 * `PublicContactActions` ile basar.
 *
 * Sıra: (1) danışman telefonu (ilana/müşteriye atanmış ya da linki hazırlayan aktif danışman), (2) ofisin BİLEREK
 * girdiği ofis telefonu (`tenants.phone`). Ofis sahibinin kişisel profil telefonu YEDEK OLARAK KULLANILMAZ (gizlilik;
 * kayıt telefonunun ofis telefonu sayılması sahip kararına bağlı). İkisi de yoksa `null` döner: sayfa sahte "Telefon
 * yok" / tıklanamayan "Soru sor" basmaz, `officeMessageHref` ile "Ofise mesaj bırakın" bağlantısı gösterir.
 *
 * SAF modül (sorgu yok): telefonlar sayfanın zaten okuduğu satırlardan gelir, ek ağ turu yoktur.
 */
export type PublicContact = {
  source: "advisor" | "office";
  /** "Danışmanı ara" ya da "Ofisi ara". */
  callLabel: string;
  /** Görünen numara ("0532 123 45 67" / "+49 151 …"). */
  display: string;
  telHref: string;
  /** Yalnız cep (TR 05…) ya da yabancı numarada; sabit hatta WhatsApp bağlantısı üretilmez. */
  waHref: string | null;
};

export type PublicContactInput = {
  advisorPhone?: string | null;
  officePhone?: string | null;
  /** WhatsApp ön yazısı (ilan başlığı vb.). */
  whatsappText?: string;
};

function whatsAppCapable(phone: string): boolean {
  const msisdn = toWhatsAppMsisdn(phone);
  if (!msisdn) return false;
  // Türkiye: yalnız cep hatları (90 5xx); yabancı numara olduğu gibi kabul edilir.
  return !msisdn.startsWith("90") || msisdn.startsWith("905");
}

export function resolvePublicContact(input: PublicContactInput): PublicContact | null {
  const candidates: [PublicContact["source"], string | null | undefined][] = [
    ["advisor", input.advisorPhone],
    ["office", input.officePhone],
  ];
  for (const [source, raw] of candidates) {
    const phone = (raw ?? "").trim();
    if (!phone) continue;
    const telHref = toTelHref(phone);
    if (!telHref) continue;
    return {
      source,
      callLabel: source === "advisor" ? "Danışmanı ara" : "Ofisi ara",
      display: formatPhoneDisplay(phone),
      telHref,
      waHref: whatsAppCapable(phone) ? toWhatsAppLink(phone, input.whatsappText) : null,
    };
  }
  return null;
}

/** "Ofise mesaj bırakın" hedefi: ofisin açık talep formu (`/lead/<token>`); form kapalıysa null (bağlantı basılmaz). */
export function officeMessageHref(tenant: {
  lead_capture_token?: string | null;
  lead_capture_enabled?: boolean | null;
} | null | undefined): string | null {
  if (!tenant?.lead_capture_token || tenant.lead_capture_enabled === false) return null;
  return `/lead/${tenant.lead_capture_token}`;
}
