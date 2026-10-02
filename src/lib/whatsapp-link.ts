/**
 * Ara çözüm: gerçek WhatsApp entegrasyonu gelene kadar wa.me deep-link üretir.
 * Mesajı kullanıcı kendi WhatsApp'ından gönderir; sistem otomatik gönderim yapmaz.
 */

/** Türk telefonunu uluslararası biçime (905XXXXXXXXX, +'sız) çevirir; geçersizse null. */
export function normalizeWhatsAppNumber(input: string | null | undefined): string | null {
  let digits = (input ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? `90${digits}` : null;
}

/** Alıcı seçmeden paylaşım: WhatsApp kişi seçtirir (wa.me/?text=). Mesaj boşsa null. */
export function buildWhatsAppShareLink(message: string | null | undefined): string | null {
  const text = (message ?? "").trim();
  return text ? `https://wa.me/?text=${encodeURIComponent(text)}` : null;
}

/** wa.me bağlantısı üretir; numara geçersizse null. */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  message?: string | null,
): string | null {
  const no = normalizeWhatsAppNumber(phone);
  if (!no) return null;
  const text = (message ?? "").trim();
  return text ? `https://wa.me/${no}?text=${encodeURIComponent(text)}` : `https://wa.me/${no}`;
}
