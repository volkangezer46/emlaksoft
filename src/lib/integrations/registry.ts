/**
 * Entegrasyon kayıt defteri — dış servislerin tek merkezden durumu.
 *
 * NEDEN: EmlakSoft'un dış dünyaya açılan tüm bağlantı noktalarını (resmi kayıt,
 * iletişim, değerleme, medya-AI) tek listede toplar. Her kalem "bağlı" mı yoksa
 * "bağlantı bekliyor" mu — tenant binding/secret doğrulamasından GERÇEK durum
 * okunur; hiçbir şey uydurulmaz. Adaptörün varlığı tek başına "hazır" sayılmaz.
 * Yeni entegrasyon = buraya kayıt + adaptör + uçtan uca kabul sözleşmesi.
 */

import { isEmlakFiyatiConfigured } from "./emlakfiyati/client";
import { isTenantEInvoiceConnected } from "./einvoice/service";
import { isIyzicoConfigured } from "@/lib/billing/iyzico";
import { isPortalConfigured } from "@/lib/integrations/portals";
import { getNetgsmConfig, getWhatsAppConfig } from "@/lib/messaging/netgsm";
import {
  isTenantSmsAvailable,
  isTenantWhatsAppAvailable,
} from "@/lib/messaging/tenant-providers";

export type IntegrationCategory =
  | "resmi" // resmi kayıt / kamu
  | "iletisim" // müşteri iletişim kanalları
  | "degerleme" // değerleme & finans
  | "medya" // görsel / AI medya
  | "operasyon"; // ödeme, fatura ve ilan yayını

export type IntegrationStatus = "configured" | "setup_required" | "planned";

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

/** Tüm entegrasyonları CANLI durumlarıyla döndürür (yalnız sunucuda çağır). */
export async function listIntegrations(tenantId: string | null = null): Promise<Integration[]> {
  const emlakFiyatiConfigured = await isEmlakFiyatiConfigured();
  // Oturumlu sayfa bağlamında ofisin e-Fatura bağlantısı (tenantId yoksa platform görünümü: bağlı sayılmaz).
  const einvoiceConnected = tenantId ? await isTenantEInvoiceConnected() : false;
  const [
    netgsmConfigured,
    whatsappConfigured,
    portalConfigured,
  ] = await Promise.all([
    tenantId
      ? isTenantSmsAvailable(tenantId)
      : getNetgsmConfig().then(Boolean),
    tenantId
      ? isTenantWhatsAppAvailable(tenantId)
      : getWhatsAppConfig().then(Boolean),
    Promise.all([
      isPortalConfigured("sahibinden"),
      isPortalConfigured("hepsiemlak"),
      isPortalConfigured("zingat"),
      isPortalConfigured("emlakjet"),
    ]).then((states) => states.some(Boolean)),
  ]);
  return [
    {
      key: "takbis",
      name: "TAKBİS / Tapu",
      category: "resmi",
      description: "Ada/parsel ile malik, yüzölçüm ve mülkiyet geçmişini resmi tapu sisteminden çeker.",
      unlocks: "Portföy açarken malik bilgisini otomatik doldurma + malik doğrulama.",
      status: "planned",
      requires: "TAKBİS entegratör anlaşması + TAKBIS_API_KEY",
      turkish: true,
    },
    {
      key: "iys",
      name: "İYS (İleti Yönetim Sistemi)",
      category: "resmi",
      description: "Ticari ileti izinlerinin resmi entegratör API'siyle doğrulanması için planlanan bağlantı.",
      unlocks: "Toplu SMS/WhatsApp öncesi otomatik izin kontrolü — izinsiz gönderimi bloklar.",
      status: "planned",
      requires: "İYS entegratör (Netgsm/İleti vb.) API anahtarı",
      turkish: true,
    },
    {
      key: "netgsm",
      name: "Netgsm SMS",
      category: "iletisim",
      description: "Ofise ait izole kimlik bilgileriyle işlem ve kampanya SMS'leri gönderir; teslim sonuçları kayıt altına alınır.",
      unlocks: "Randevu, imza, güvenlik ve izinli kampanya bildirimlerinde gerçek SMS gönderimi.",
      status: netgsmConfigured ? "configured" : "setup_required",
      requires: "Ayarlar'da Netgsm kullanıcı kodu, parola ve onaylı mesaj başlığı",
      turkish: true,
    },
    {
      key: "iyzico",
      name: "iyzico Ödeme",
      category: "operasyon",
      description: "Abonelik ve güvenli ödeme bağlantılarında imzalı iyzico tahsilat akışını kullanır.",
      unlocks: "Doğrulanmış callback/webhook mutabakatıyla otomatik ödeme ve fatura durum yönetimi.",
      status: isIyzicoConfigured() ? "configured" : "setup_required",
      requires: "IYZICO_API_KEY, IYZICO_SECRET_KEY ve doğru sandbox/canlı API kökü",
      turkish: true,
    },
    {
      key: "property_portals",
      name: "Kurumsal İlan Portalları",
      category: "operasyon",
      description: "Sahibinden, Hepsiemlak, Zingat veya Emlakjet kurumsal API'sine ilan gönderir ve kaldırır.",
      unlocks: "Portföy ekranından seçili portala yayın, güncelleme ve yayından kaldırma.",
      status: portalConfigured ? "configured" : "setup_required",
      requires: "En az bir portal için kurumsal sözleşme, API anahtarı ve sağlayıcının verdiği HTTPS API kökü",
      turkish: true,
    },
    {
      key: "efatura",
      name: "e-Fatura / e-Arşiv (Nilvera, Paraşüt)",
      category: "operasyon",
      description: "Komisyon ve hizmet bedeli için ofisin kendi sağlayıcı hesabından e-Fatura / e-Arşiv keser, durumunu izler. Tüm paketlerde, ek ücretsiz.",
      unlocks: "Anlaşma/komisyondan önceden doldurulmuş taslak, onaylı resmileştirme, durum ve PDF takibi (Finans > Faturalar).",
      status: einvoiceConnected ? "configured" : "setup_required",
      requires: "Aşağıdaki e-Fatura kartından Nilvera API anahtarı ya da Paraşüt hesabı bağlantısı",
      turkish: true,
    },
    {
      key: "whatsapp",
      name: "WhatsApp Business API",
      category: "iletisim",
      description: "Meta kimliği doğrulanmış ofis hesabından onaylı şablonlarla WhatsApp gönderimi yapar.",
      unlocks: "İzinli kampanya ve işlem bildirimlerinde tenant'a izole WhatsApp gönderimi.",
      status: whatsappConfigured ? "configured" : "setup_required",
      requires: "Meta Cloud API: doğrulanmış telefon kimliği, WABA kimliği, Graph sürümü ve erişim belirteci",
      turkish: true,
    },
    {
      key: "meta_lead_ads",
      name: "Facebook / Instagram Lead Ads",
      category: "iletisim",
      description: "Sosyal reklam formlarından gelen aday otomatik müşteri + talep olur.",
      unlocks: "Sosyal reklam adaylarının otomatik yakalanması + ilk yanıt hızı tetiği.",
      status: "planned",
      requires: "Meta uygulaması + sayfa erişim tokenı (META_PAGE_TOKEN)",
    },
    {
      key: "emlakfiyati",
      name: "EmlakFiyati",
      category: "degerleme",
      description: "Aylık bölge fiyat endeksi (medyan TL/m², çeyrekler arası bant, değişim ve 12 aylık trend). Yalnız coğrafi yol ve tip gönderilir; kişisel veri gitmez.",
      unlocks: "Değerleme motorunda piyasa endeksi kaynağı, bölge analizinde medyan/trend ve portföyde bölge referansı.",
      status: emlakFiyatiConfigured ? "configured" : "setup_required",
      requires: "Admin > Sistem > EmlakFiyati sekmesinde API anahtarı (yedek: sunucu ortam değişkeni EMLAKFIYATI_API_KEY)",
    },
    {
      key: "bank_rates",
      name: "Banka kredi oranları",
      category: "degerleme",
      description: "Canlı konut kredisi faiz akışı ile en uygun banka/taksit karşılaştırması.",
      unlocks: "Müşteri portalında canlı kredi karşılaştırma; danışman = finansman danışmanı.",
      status: "planned",
      requires: "Kredi oran sağlayıcısı API anahtarı",
    },
    {
      key: "ai_media",
      name: "AI sanal staging & video",
      category: "medya",
      description: "Boş oda döşeme önizlemesi, otomatik ilan videosu ve akıllı kapak seçimi.",
      unlocks: "Fotoğrafları AI ile döşeme, story/video üretimi, kalite skoruyla kapak.",
      status: "planned",
      requires: "Görsel AI sağlayıcısı API anahtarı (ör. staging/generation servisi)",
    },
  ];
}
