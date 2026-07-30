/**
 * Entegrasyon kayıt defteri — dış servislerin tek merkezden durumu.
 *
 * NEDEN: EmlakSoft'un dış dünyaya açılan tüm bağlantı noktalarını (resmi kayıt,
 * iletişim, değerleme, medya-AI) tek listede toplar. Her kalem "bağlı" mı yoksa
 * "bağlantı bekliyor" mu — env/DB anahtarından GERÇEK durumu okunur; hiçbir şey
 * uydurulmaz. Anahtar girildiğinde ilgili adaptör (src/lib/integrations/*.ts)
 * canlıya geçer. Yeni entegrasyon = buraya bir kayıt + bir adaptör dosyası.
 */

import { isEndeksaConfigured } from "./endeksa";
import { isTapusorConfigured } from "./tapusor";

export type IntegrationCategory =
  | "resmi" // resmi kayıt / kamu
  | "iletisim" // müşteri iletişim kanalları
  | "degerleme" // değerleme & finans
  | "medya"; // görsel / AI medya

export type IntegrationStatus = "connected" | "pending";

export type Integration = {
  key: string;
  name: string;
  category: IntegrationCategory;
  /** Ne işe yarar — kısa. */
  description: string;
  /** Bağlanınca hangi yeteneği açar. */
  unlocks: string;
  status: IntegrationStatus;
  /** Bağlanmak için gereken ortam değişkeni / kimlik bilgisi. */
  requires: string;
  /** Türk pazarına özgü savunma değeri var mı. */
  turkish?: boolean;
};

const env = (k: string): boolean => Boolean(process.env[k]?.trim());

/** Tüm entegrasyonları CANLI durumlarıyla döndürür (yalnız sunucuda çağır). */
export function listIntegrations(): Integration[] {
  return [
    {
      key: "takbis",
      name: "TAKBİS / Tapu",
      category: "resmi",
      description: "Ada/parsel ile malik, yüzölçüm ve mülkiyet geçmişini resmi tapu sisteminden çeker.",
      unlocks: "Portföy açarken malik bilgisini otomatik doldurma + malik doğrulama.",
      status: env("TAKBIS_API_KEY") ? "connected" : "pending",
      requires: "TAKBİS entegratör anlaşması + TAKBIS_API_KEY",
      turkish: true,
    },
    {
      key: "iys",
      name: "İYS (İleti Yönetim Sistemi)",
      category: "resmi",
      description: "Ticari ileti izinlerini resmi entegratör API'sinden gerçek zamanlı doğrular.",
      unlocks: "Toplu SMS/WhatsApp öncesi otomatik izin kontrolü — izinsiz gönderimi bloklar.",
      status: env("IYS_API_KEY") || env("IYS_INTEGRATOR_TOKEN") ? "connected" : "pending",
      requires: "İYS entegratör (Netgsm/İleti vb.) API anahtarı",
      turkish: true,
    },
    {
      key: "whatsapp",
      name: "WhatsApp Business API",
      category: "iletisim",
      description: "İki yönlü WhatsApp: mesaj müşteri kartına düşer, onaylı şablonlar, ekip gelen kutusu.",
      unlocks: "Canlı WhatsApp yazışması + kampanyaların gerçek gönderimi.",
      status: env("WHATSAPP_PHONE_ID") && env("WHATSAPP_TOKEN") ? "connected" : "pending",
      requires: "Meta WhatsApp Business hesabı + WHATSAPP_TOKEN, WHATSAPP_PHONE_ID",
      turkish: true,
    },
    {
      key: "meta_lead_ads",
      name: "Facebook / Instagram Lead Ads",
      category: "iletisim",
      description: "Sosyal reklam formlarından gelen lead otomatik müşteri + talep olur.",
      unlocks: "Sosyal reklam lead'lerinin otomatik yakalanması + hız-lead tetiği.",
      status: env("META_APP_SECRET") && env("META_PAGE_TOKEN") ? "connected" : "pending",
      requires: "Meta uygulaması + sayfa erişim tokenı (META_PAGE_TOKEN)",
    },
    {
      key: "endeksa",
      name: "Endeksa",
      category: "degerleme",
      description: "Bölge endeksi ve emsal m² verisiyle değerleme motorunu besler.",
      unlocks: "Emsal motorunda gerçek piyasa verisiyle otomatik değerleme.",
      status: isEndeksaConfigured() ? "connected" : "pending",
      requires: "Endeksa API (ENDEKSA_CLIENT_ID / SECRET) veya ayarlardan anahtar",
    },
    {
      key: "tapusor",
      name: "Tapusor EDİ",
      category: "degerleme",
      description: "Yapay zekâ destekli konut değerleme raporu (EDİ).",
      unlocks: "Değerlemede ikinci bağımsız AI görüşü.",
      status: isTapusorConfigured() ? "connected" : "pending",
      requires: "Tapusor API anahtarı (TAPUSOR_API_KEY)",
    },
    {
      key: "bank_rates",
      name: "Banka kredi oranları",
      category: "degerleme",
      description: "Canlı konut kredisi faiz akışı ile en uygun banka/taksit karşılaştırması.",
      unlocks: "Müşteri portalında canlı kredi karşılaştırma; danışman = finansman danışmanı.",
      status: env("BANK_RATES_API_KEY") ? "connected" : "pending",
      requires: "Kredi oran sağlayıcısı API anahtarı",
    },
    {
      key: "ai_media",
      name: "AI sanal staging & video",
      category: "medya",
      description: "Boş oda döşeme önizlemesi, otomatik ilan videosu ve akıllı kapak seçimi.",
      unlocks: "Fotoğrafları AI ile döşeme, story/video üretimi, kalite skoruyla kapak.",
      status: env("AI_MEDIA_API_KEY") ? "connected" : "pending",
      requires: "Görsel AI sağlayıcısı API anahtarı (ör. staging/generation servisi)",
    },
  ];
}
