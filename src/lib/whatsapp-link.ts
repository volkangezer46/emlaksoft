/**
 * Ara çözüm: gerçek WhatsApp entegrasyonu gelene kadar wa.me deep-link üretir.
 * Mesajı kullanıcı kendi WhatsApp'ından gönderir; sistem otomatik gönderim yapmaz.
 * Tek kaynak: `@/lib/phone` — bu dosya yalnız ince sarmalayıcıdır (yalnız cep numarası kabul eder).
 */
import { toWhatsAppLink, toWhatsAppMsisdn, toWhatsAppShareLink } from "./phone";

/** Türk cep telefonunu uluslararası biçime (905XXXXXXXXX, +'sız) çevirir; geçersizse null. */
export function normalizeWhatsAppNumber(input: string | null | undefined): string | null {
  const msisdn = toWhatsAppMsisdn(input);
  return /^905\d{9}$/.test(msisdn) ? msisdn : null;
}

/** Alıcı seçmeden paylaşım: WhatsApp kişi seçtirir (wa.me/?text=). Mesaj boşsa null. */
export function buildWhatsAppShareLink(message: string | null | undefined): string | null {
  return toWhatsAppShareLink(message);
}

/** wa.me bağlantısı üretir; numara geçersizse null. */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  message?: string | null,
): string | null {
  if (!normalizeWhatsAppNumber(phone)) return null;
  return toWhatsAppLink(phone, (message ?? "").trim() || undefined);
}
