import { SUPPORT_MAILTO } from "@/lib/contact-info";

/**
 * Google bağlantı merkezinin SABİTLERİ (saf; istemci/sunucu ortak). Depo anahtarları, hizmetler, kapsamlar, adresler.
 *
 * Tüm `google.*` platform_settings değerleri MÜHÜRLÜDÜR (`sealSecret`, AAD = `platform_settings:<anahtar>`);
 * düz metin okunursa reddedilir (`token-store.ts` → `requireSealed`). Bu turda YOK: reklam hesabında değişiklik (yazma uç noktası),
 * Data Manager dönüşüm gönderimi, GA4, gclid, tarayıcı etiketi.
 */

export type GoogleService = "gsc" | "ads";

export const GOOGLE_SERVICES: readonly GoogleService[] = ["gsc", "ads"];

export const GOOGLE_SERVICE_LABELS: Record<GoogleService, string> = {
  gsc: "Search Console",
  ads: "Google Ads",
};

/** platform_settings depo anahtarları (hepsi mühürlü). */
export const GOOGLE_KEYS = {
  /** OAuth istemcisi: { clientId, clientSecret } — yalnız super_admin girer. */
  client: "google.oauth.client",
  /** Hizmet başına ayrı yenileme belirteci kaydı (TokenRecord). */
  gsc: "google.oauth.gsc",
  ads: "google.oauth.ads",
  /** Ads hesap ayarları: { customerId, loginCustomerId, developerToken }. */
  adsAccount: "google.ads.account",
  /** Seçili Search Console mülkü: { siteUrl }. */
  gscProperty: "google.gsc.property",
  /** Günlük kota sayaçları: google.quota.<hizmet>. */
  quotaGsc: "google.quota.gsc",
  quotaInspection: "google.quota.inspection",
  quotaAds: "google.quota.ads",
} as const;

export type GoogleSettingKey = (typeof GOOGLE_KEYS)[keyof typeof GOOGLE_KEYS];

export function tokenKeyOf(service: GoogleService): typeof GOOGLE_KEYS.gsc | typeof GOOGLE_KEYS.ads {
  return service === "gsc" ? GOOGLE_KEYS.gsc : GOOGLE_KEYS.ads;
}

/** Hizmet başına TEK kapsam (artımlı yetkilendirme; reklam için yalnız okuma kodu vardır). */
export const GOOGLE_SCOPES: Record<GoogleService, string> = {
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
  ads: "https://www.googleapis.com/auth/adwords",
};

/** Google Cloud konsolunda TAM olarak bu adres kayıtlı olmalıdır (sabit; ortamdan türetilmez). */
export const GOOGLE_REDIRECT_URI = "https://emlaksoft.com.tr/api/admin/google/callback";

/** Kendi canlı adresimiz (sitemap okuma, Search Console mülk önerisi). */
export const SITE_ORIGIN = "https://emlaksoft.com.tr";
export const SITE_DOMAIN = "emlaksoft.com.tr";

/** Saklama süreleri (budama cron'da). */
export const GSC_RETENTION_MONTHS = 16;
export const ADS_RETENTION_MONTHS = 25;

/** Resmî belge bağlantıları (sihirbaz). */
export const GOOGLE_DOCS = {
  oauthClient: "https://developers.google.com/identity/protocols/oauth2/web-server",
  consentScreen: "https://support.google.com/cloud/answer/10311615",
  searchConsole: "https://support.google.com/webmasters/answer/34592",
  adsDeveloperToken: "https://developers.google.com/google-ads/api/docs/get-started/dev-token",
  adsAccessLevels: "https://developers.google.com/google-ads/api/docs/api-policy/access-levels",
} as const;

/** "Bunu ekibimiz yapsın": önceden doldurulmuş destek e-postası (adres tek kaynaktan: contact-info.ts). */
export function helpRequestHref(step: string): string {
  const subject = `Google bağlantısı kurulum desteği: ${step}`;
  const body = `Merhaba,\n\nGoogle bağlantı sihirbazında "${step}" adımını sizin yapmanızı istiyoruz.\nSite: ${SITE_ORIGIN}\n\nTeşekkürler.`;
  return `${SUPPORT_MAILTO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
