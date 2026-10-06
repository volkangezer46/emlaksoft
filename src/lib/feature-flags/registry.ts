import { isDemoLoginEnabled } from "@/lib/demo-environment";
import { isPlatformMfaRequired } from "@/lib/platform-mfa";
import { serverTimingEnabled } from "@/lib/server-timing-core";

/**
 * ÖZELLİK BAYRAKLARI — envanter (TEK KAYNAK, saf). Dağınık açma/kapama bayraklarının hepsi burada listelenir;
 * okuma tek kapıdan: `isFeatureEnabled(key)` (sunucu, `./server.ts`). Ekran: /admin/ayarlar/bayraklar.
 *
 * Kaynak türleri:
 *  - "setting": ayar defterindeki açık/kapalı ayar (`settingKey`); düzenleme ayarın kendi bölümünde (`editHref`),
 *    değişiklik geçmişi `settings_history`. Her ayar tek yerde düzenlenir; bayrak ekranı durumu ve etkiyi gösterir.
 *  - "platform": ayar defterinde olmayan ham platform ayarı (`storageKey`, açık değeri `onValue`); kendi ekranında.
 *  - "env": Vercel ortam değişkeni; buradan DEĞİŞTİRİLEMEZ (değişiklik + yeniden dağıtım sahibin işi).
 * `requires`: bu bayrak yalnız bağlı bayrak da açıkken etkindir (ör. nakit ödeme yalnız ortak programı açıkken).
 */

export type FeatureFlagSource = "setting" | "platform" | "env";

export type FeatureFlagDef = {
  key: string;
  label: string;
  description: string;
  impact: string;
  source: FeatureFlagSource;
  settingKey?: string;
  storageKey?: string;
  onValue?: string;
  envVar?: string;
  /** Ortam bayrağının mevcut kod yolundaki değerlendirmesi (anlam değişmez). */
  env?: (env: NodeJS.ProcessEnv) => boolean;
  editHref?: string;
  requires?: string;
};

/** ALLOW_BILLING_DEMO: canlıda yalnız "true" iken iyzico'suz demo abonelik ödemesi (geliştirmede her zaman açık). */
export function billingDemoAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" || env.ALLOW_BILLING_DEMO === "true";
}

/** ALLOW_PAYMENT_LINK_DEMO: canlıda yalnız "1" iken ödeme bağlantısında demo tahsilat. */
export function paymentLinkDemoAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" || env.ALLOW_PAYMENT_LINK_DEMO === "1";
}

/** ALLOW_PLATFORM_MESSAGING_FALLBACK: kendi sağlayıcısı olmayan ofisin platform SMS/WhatsApp hesabından göndermesi. */
export function platformMessagingFallbackEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALLOW_PLATFORM_MESSAGING_FALLBACK?.trim().toLowerCase() === "true";
}

export const FEATURE_FLAGS: readonly FeatureFlagDef[] = [
  {
    key: "registration_open",
    label: "Yeni kayıt açık",
    description: "Self-servis ofis kaydı (/kayit).",
    impact: "Kapatılırsa yeni ofis açılamaz; mevcut hesaplar giriş yapar.",
    source: "setting",
    settingKey: "platform.registration_open",
    editHref: "/admin/sistem#ayarlar",
  },
  {
    key: "maintenance_mode",
    label: "Bakım modu",
    description: "Ofis panelleri bakım ekranı gösterir.",
    impact: "Tüm ofis kullanıcıları bakım ekranını görür; platform personeli etkilenmez.",
    source: "setting",
    settingKey: "platform.maintenance_mode",
    editHref: "/admin/sistem#ayarlar",
  },
  {
    key: "auto_renew",
    label: "Otomatik yenileme (kart)",
    description: "Kayıtlı karttan abonelik yenileme tahsilatı.",
    impact: "Açılırsa rıza veren ofislerin kartından yenileme denenir.",
    source: "setting",
    settingKey: "billing.auto_renew_enabled",
    editHref: "/admin/billing#ayarlar",
  },
  {
    key: "growth_referral",
    label: "Referans (davet) programı",
    description: "Ofis davet ve ödül programı.",
    impact: "Açılırsa ofislerde Büyüme ekranı davet bağlantısı üretir; ödül kuralları ayrıca tanımlanır.",
    source: "setting",
    settingKey: "growth.referral_enabled",
    editHref: "/admin/growth",
  },
  {
    key: "growth_partner",
    label: "Ortak programı",
    description: "Ortak (partner) komisyon programı.",
    impact: "Açılırsa ortak kodlarıyla gelen kayıtlar atfedilir.",
    source: "setting",
    settingKey: "growth.partner_enabled",
    editHref: "/admin/growth",
  },
  {
    key: "growth_cash_payout",
    label: "Nakit ortak ödemesi",
    description: "Ortak kazançlarının nakit ödenmesi.",
    impact: "Yalnız ortak programı da açıkken etkindir.",
    source: "setting",
    settingKey: "growth.cash_payout_enabled",
    editHref: "/admin/growth",
    requires: "growth_partner",
  },
  {
    key: "ef_ortak",
    label: "EmlakFiyati ortak uçları",
    description: "Değerleme/rapor için EmlakFiyati ortak API'si ve kontör akışı.",
    impact: "Açılsa bile son bağlantı denemesi başarılı ve taze değilse kullanıcıya açılmaz.",
    source: "platform",
    storageKey: "emlakfiyati_ortak_enabled",
    onValue: "1",
    editHref: "/admin/sistem?sekme=emlakfiyati",
  },
  {
    key: "platform_mfa",
    label: "Platform personeli için zorunlu iki adımlı doğrulama",
    description: "Ortam değişkeni PLATFORM_MFA_ENFORCEMENT=on (yayın öncesi açılacak).",
    impact: "Açıkken /admin girişinde TOTP zorunlu; veritabanı ayarı platform.mfa_enforced ile tutarlı olmalı.",
    source: "env",
    envVar: "PLATFORM_MFA_ENFORCEMENT",
    env: () => isPlatformMfaRequired(),
  },
  {
    key: "demo_login",
    label: "Hızlı demo girişleri",
    description: "Giriş sayfasındaki demo kişi kartları (ENABLE_DEMO_LOGIN; canlıda ayrıca açık izin gerekir).",
    impact: "Canlıda açık olmamalıdır.",
    source: "env",
    envVar: "ENABLE_DEMO_LOGIN",
    env: (env) => isDemoLoginEnabled(env),
  },
  {
    key: "billing_demo",
    label: "Demo abonelik ödemesi",
    description: "iyzico yokken demo ödeme (ALLOW_BILLING_DEMO=true; geliştirmede her zaman açık).",
    impact: "Canlıda açıksa para alınmadan paket aktifleşebilir.",
    source: "env",
    envVar: "ALLOW_BILLING_DEMO",
    env: billingDemoAllowed,
  },
  {
    key: "payment_link_demo",
    label: "Ödeme bağlantısında demo tahsilat",
    description: "ALLOW_PAYMENT_LINK_DEMO=1 (geliştirmede her zaman açık).",
    impact: "Canlıda açıksa ödeme bağlantısı gerçek tahsilat yapmadan kapanabilir.",
    source: "env",
    envVar: "ALLOW_PAYMENT_LINK_DEMO",
    env: paymentLinkDemoAllowed,
  },
  {
    key: "messaging_fallback",
    label: "Platform SMS/WhatsApp hesabına düşme",
    description: "Kendi sağlayıcısı olmayan ofis platform hesabından gönderir (ALLOW_PLATFORM_MESSAGING_FALLBACK=true).",
    impact: "Açıksa ofis mesajları platformun hesabından ve maliyetiyle gider.",
    source: "env",
    envVar: "ALLOW_PLATFORM_MESSAGING_FALLBACK",
    env: platformMessagingFallbackEnv,
  },
  {
    key: "server_timing",
    label: "Sunucu süre ölçümü",
    description: "EMLAKSOFT_SERVER_TIMING=1 iken sunucu loglarına süre satırı yazılır.",
    impact: "Yalnız teşhis içindir; log hacmini artırır.",
    source: "env",
    envVar: "EMLAKSOFT_SERVER_TIMING",
    env: (env) => serverTimingEnabled(env),
  },
];

export function getFeatureFlagDef(key: string): FeatureFlagDef | undefined {
  return FEATURE_FLAGS.find((f) => f.key === key);
}
