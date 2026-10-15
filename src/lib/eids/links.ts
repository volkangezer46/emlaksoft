/**
 * EİDS kurulum ve kılavuz bağlantıları — TEK yer (SAF, istemci güvenli; içerik modülü çekmez).
 * Yeni menü öğesi YOK: hepsi mevcut merkezlerin sekme/çapalarıdır.
 */

/** Yardım merkezi rehberinin slug'ı (kod içerik: src/lib/help-center/eids.ts; CMS aynı slug ile düzenler). */
export const EIDS_HELP_SLUG = "eids-bakanlik-epostalari";
/** Yardım > Rehberler > EİDS rehberi (help-center/core `helpGuideHref` ile aynı biçim). */
export const EIDS_HELP_HREF = `/app/yardim?sekme=rehberler#${EIDS_HELP_SLUG}`;
/** Ayarlar > Entegrasyonlar: "Bakanlık (EİDS) e-postaları" kartı (EP3) burada durur. */
export const EIDS_MAILBOX_SETTINGS_HREF = "/app/ayarlar/entegrasyonlar#eids";
/** Ayarlar > Marka ve kimlik > Yetki belgesi no alanı (company-form `#yetki-belgesi` çapası). */
export const LICENSE_SETTINGS_HREF = "/app/ayarlar?sekme=kimlik#yetki-belgesi";
/** İlan Kontrol > Yetki (yetki kuyruğu, kılavuz paneli, "Bakanlık e-postası ekle"). */
export const EIDS_AUTHORITY_HREF = "/app/ilan-kontrol/yetki";
