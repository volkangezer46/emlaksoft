/**
 * Destek iletişimi TEK KAYNAK. Yasal sayfalar, SSS, menü, push ve bildirimler buradan okur;
 * kaynakta başka yerde sabit adres yazılmaz (contact-info-contract.test.ts).
 * Üretimde NEXT_PUBLIC_SUPPORT_EMAIL ile değiştirilir (docs/DEPLOY.md).
 */
export const SUPPORT_EMAIL: string = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "destek@emlaksoft.com.tr";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

/**
 * İsteğe bağlı destek telefonu / WhatsApp hattı. Varsayılan YOK: env tanımlı değilse null ve hiçbir yerde görünmez
 * (uydurma numara yazılmaz). Değer gösterim biçiminde girilir (ör. "0850 000 00 00"); bağlantı için rakamlar kullanılır.
 */
export const SUPPORT_PHONE: string | null = process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim() || null;
export const SUPPORT_TEL: string | null = SUPPORT_PHONE ? `tel:${telDigits(SUPPORT_PHONE)}` : null;
export const SUPPORT_WHATSAPP: string | null = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.trim() || null;
export const SUPPORT_WHATSAPP_URL: string | null = SUPPORT_WHATSAPP ? `https://wa.me/${waDigits(SUPPORT_WHATSAPP)}` : null;

/** tel: bağlantısı için yalnız rakam ve baştaki +. */
function telDigits(v: string): string {
  return (v.trim().startsWith("+") ? "+" : "") + v.replace(/\D/g, "");
}

/** wa.me uluslararası biçim ister (başında + ve 0 olmadan): TR "05XX…" → "905XX…". */
function waDigits(v: string): string {
  const d = v.replace(/\D/g, "");
  if (v.trim().startsWith("+")) return d;
  if (d.startsWith("0")) return `90${d.slice(1)}`;
  return d;
}
