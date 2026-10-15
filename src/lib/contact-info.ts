/**
 * Destek iletişimi TEK KAYNAK. Kaynakta başka yerde sabit adres yazılmaz (contact-info-contract.test.ts).
 *
 * Gerçek değerler SUNUCUDA ayar defterinden okunur (`support.email`, `support.phone`, `support.whatsapp`;
 * /admin/ayarlar/yasal?sekme=sirket): `getSupportContact()` (src/lib/contact-info-server.ts). Yasal sayfalar ve askı
 * ekranı onu kullanır; deploy gerekmez. Bu dosya SAF kalır (istemci ve statik varsayılanlar da import eder) ve yalnız
 * koddaki varsayılanı + biçim yardımcılarını taşır. NEXT_PUBLIC_SUPPORT_* artık GEREKMEZ; tanımlıysa yalnız eski kurulumla
 * uyum için son yedek olarak okunur (derlemeye gömülür; değiştirmek için ayarı kullanın).
 */
export const DEFAULT_SUPPORT_EMAIL = "destek@emlaksoft.com.tr";

/**
 * Derleme anı e-postası (eski env yedeği > koddaki varsayılan): istemci önizlemesi, push konusu ve menü varsayılanları.
 * Herkese açık sunucu yüzeyleri (ana sayfa SSS'si, üst menü, alt bilgi) bunu `getSupportContact()` ile değiştirir.
 */
export const SUPPORT_EMAIL: string = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL;
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

/** Sunucuda çözülmüş destek iletişimi (istemciye düz veri olarak geçebilir). */
export type SupportContact = {
  email: string;
  mailto: string;
  phone: string | null;
  tel: string | null;
  whatsapp: string | null;
  whatsappUrl: string | null;
};

/**
 * SAF: ham değerlerden iletişim nesnesi. Boş telefon/WhatsApp = null (hiçbir yerde görünmez; uydurma numara yazılmaz).
 * Değer gösterim biçiminde girilir (ör. "0850 000 00 00"); bağlantı için rakamlar kullanılır.
 */
export function buildSupportContact(input: { email?: string | null; phone?: string | null; whatsapp?: string | null }): SupportContact {
  const email = input.email?.trim() || DEFAULT_SUPPORT_EMAIL;
  const phone = input.phone?.trim() || null;
  const whatsapp = input.whatsapp?.trim() || null;
  return {
    email,
    mailto: `mailto:${email}`,
    phone,
    tel: phone ? `tel:${telDigits(phone)}` : null,
    whatsapp,
    whatsappUrl: whatsapp ? `https://wa.me/${waDigits(whatsapp)}` : null,
  };
}

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
