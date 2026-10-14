/**
 * "WhatsApp taslağı" (SAF; istemci + sunucu): ofis şablonu değişkenleriyle doldurulur, wa.me bağlantısı üretilir.
 * Mesajı kullanıcı KENDİ WhatsApp'ından gönderir; sistem otomatik göndermez.
 *  - Alıcının numarası geçerliyse doğrudan ona (`wa.me/<msisdn>?text=`).
 *  - Numara yoksa (portföy: alıcıyı WhatsApp'ta kullanıcı seçer) paylaşım bağlantısı (`wa.me/?text=`); metin boşsa null.
 * Müşteri kartı ve portföy detayındaki `WaTemplateMenu` bu tek yoldan bağlantı kurar.
 *
 * Kategoriye bağlı değişkenler (`CategoryVars`): genel anlamı başka olan bir değişken (ör. `{adres}` = ilanın
 * konumu) yalnız ilgili kategorideki şablonlarda başka değerle (randevu yeri) dolar; ilan şablonu sızıntı almaz.
 */
import { renderTemplate, type TemplateCategory, type TemplateVars } from "@/lib/message-templates";
import { toWhatsAppLink, toWhatsAppShareLink } from "@/lib/phone";

export type CategoryVars = Partial<Record<TemplateCategory, TemplateVars>>;

/** Şablonun kategorisine göre ortak değişkenlerin üstüne o kategoriye özel değerleri bindirir. */
export function varsForCategory(category: string | null | undefined, vars: TemplateVars, categoryVars?: CategoryVars): TemplateVars {
  const scoped = category ? categoryVars?.[category as TemplateCategory] : undefined;
  return scoped ? { ...vars, ...scoped } : vars;
}

export type WhatsAppDraft = {
  message: string;
  /** Açılacak bağlantı; ne numara ne metin varsa null. */
  href: string | null;
  /** true: belirli kişiye (numara); false: alıcıyı WhatsApp'ta seçtiren paylaşım. */
  direct: boolean;
};

export function whatsAppDraftHref(phone: string | null | undefined, message: string): Pick<WhatsAppDraft, "href" | "direct"> {
  const text = message.trim();
  const direct = toWhatsAppLink(phone, text || undefined);
  if (direct) return { href: direct, direct: true };
  return { href: toWhatsAppShareLink(text), direct: false };
}

/** Şablon gövdesini değişkenlerle doldurur ve bağlantıyı kurar (şablon yoksa boş mesaj). */
export function buildWhatsAppDraft(phone: string | null | undefined, body: string | null | undefined, vars: TemplateVars): WhatsAppDraft {
  const message = body ? renderTemplate(body, vars) : "";
  return { message, ...whatsAppDraftHref(phone, message) };
}
