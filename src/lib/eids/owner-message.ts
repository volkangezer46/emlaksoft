import { MIN_AUTHORITY_MONTHS } from "./authority-term";

/**
 * Maliğe gönderilecek hazır EİDS yetki mesajı (SAF; portföy formu "İlan sahibi" sekmesi kopyalar).
 * İçerik: e-Devlet yetkilendirme adımları + ofisin yetki belge numarası + taşınmaz numarası ricası. Sistem mesajı
 * GÖNDERMEZ; danışman kendi kanalından iletir (işlem amaçlı bilgi; ticari ileti değildir).
 */

export const LICENSE_NO_PLACEHOLDER = "[yetki belge no]";

/** Taşınmaz numarasının bulunduğu yerler (ipucu ve mesaj aynı metni kullanır). */
export const PROPERTY_NO_WHERE: readonly string[] = [
  "Yeni tip tapu senedinin üzerinde \"Taşınmaz No\" olarak yazar.",
  "e-Devlet'te \"Tapu Bilgileri Sorgulama\" > \"Taşınmaz Bilgileri\" ekranında görünür.",
  "Numara malikin kendisindedir; danışman tapu kaydına erişemez, maliğe sorulur.",
];

export function buildOwnerAuthorityMessage(i: { officeName: string; licenseNo: string | null | undefined; ownerName?: string | null }): string {
  const greeting = i.ownerName?.trim() ? `Merhaba ${i.ownerName.trim()},` : "Merhaba,";
  const lic = i.licenseNo?.trim() || LICENSE_NO_PLACEHOLDER;
  const office = i.officeName.trim() || "ofisimiz";
  return [
    greeting,
    `Taşınmazınızın ilanını yayınlayabilmemiz için e-Devlet'ten ${office} adına ilan yetkisi vermeniz gerekiyor (Elektronik İlan Doğrulama Sistemi, EİDS):`,
    "1. turkiye.gov.tr adresinden e-Devlet'e girin ve \"EİDS Taşınmaz İlanı Yetkilendirme İşlemleri\" hizmetini açın.",
    "2. Yetkilendirme İşlemleri bölümünde ilan verilecek taşınmazınızı ve işlemi (satış ya da kiralama) seçin.",
    `3. İşletme yetki belge numarası olarak ${lic} yazın (${office}).`,
    `4. Yetki süresini en az ${MIN_AUTHORITY_MONTHS} ay seçip onaylayın.`,
    "Ayrıca taşınmaz numarasını bize iletir misiniz? Yeni tip tapu senedinizde ya da e-Devlet'te \"Tapu Bilgileri Sorgulama\" ekranında yazar.",
    "Yetkiyi istediğiniz zaman aynı ekrandan uzatabilir ya da iptal edebilirsiniz. Teşekkürler.",
  ].join("\n");
}
