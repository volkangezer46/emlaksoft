import type { PlatformModule } from "@/lib/platform-access";

/**
 * "Site yönetimi" merkezinin kart envanteri (TEK kaynak): admin'in ONLINE yönetebildiği alanlar.
 * Her `href` GERÇEK bir `page.tsx`'e gider (sözleşme testi doğrular); olmayan ekran için kart eklenmez
 * (ör. EmlakFiyati kontör tarifesi ekranı yazılınca buraya eklenir). Ekran kopyası yok: kartlar mevcut ekranlara bağlanır.
 * `audit`: son değişikliği bulmak için `platform_audit_logs.action` önekleri (kişisel veri okunmaz).
 */
export type HubCardId =
  | "site-menu"
  | "site-icerik"
  | "seo"
  | "bakim-kayit"
  | "duyuru"
  | "planlar"
  | "kuponlar"
  | "kullanici-rol"
  | "sistem"
  | "muhasebe";

export type HubCard = {
  id: HubCardId;
  title: string;
  description: string;
  href: string;
  module: PlatformModule;
  audit: readonly string[];
  /** Taslak/yayın akışı olan alanlar (durum satırında "taslak var mı" gösterilir). */
  hasDraft?: boolean;
};

export const HUB_CARDS: readonly HubCard[] = [
  { id: "site-menu", title: "Site menüsü", description: "Üst menü, alt bilgi ve duyuru şeridi (taslak/yayın, geri dönüş).", href: "/admin/site-menu", module: "sitemenu", audit: ["site_menu."], hasDraft: true },
  { id: "site-icerik", title: "Site içeriği", description: "Ana sayfa metinleri, SSS, değerleme bölümü, demo ve kayıt üst metinleri.", href: "/admin/site-icerik", module: "sitecontent", audit: ["site_content."], hasDraft: true },
  { id: "seo", title: "SEO merkezi", description: "Sayfa başlıkları, açıklamalar, sitemap, robots ve yönlendirmeler.", href: "/admin/seo", module: "seo", audit: ["seo."] },
  { id: "bakim-kayit", title: "Bakım modu ve kayıt", description: "Siteyi bakıma al, yeni ofis kaydını aç/kapat, deneme süresi.", href: "/admin/ayarlar", module: "sistem", audit: ["platform_settings."] },
  { id: "duyuru", title: "Duyurular", description: "Ofislere gönderilen platform duyuruları.", href: "/admin/duyuru", module: "broadcast", audit: [] },
  { id: "planlar", title: "Planlar ve fiyatlar", description: "Paket fiyatları, limitler, kampanya ve koltuk fiyatlandırması.", href: "/admin/billing/planlar", module: "billing", audit: ["billing.plan.", "billing.campaign.", "billing.seat_"] },
  { id: "kuponlar", title: "Kuponlar", description: "İndirim kuponları oluştur, düzenle, kapat.", href: "/admin/billing/kuponlar", module: "billing", audit: ["billing.coupon."] },
  { id: "kullanici-rol", title: "Kullanıcı ve roller", description: "Platform personeli, departman rolleri ve oturumlar.", href: "/admin/personel", module: "personel", audit: ["platform_staff."] },
  { id: "sistem", title: "Sistem sağlığı", description: "Geo, zamanlanmış görevler, bildirim ve şema denetimleri.", href: "/admin/sistem", module: "sistem", audit: ["platform_cron."] },
  { id: "muhasebe", title: "Muhasebe", description: "Abonelikler, faturalar, tahsilat ve iade kayıtları.", href: "/admin/billing", module: "billing", audit: ["billing.invoice."] },
];

/** `/admin/...` yolundan beklenen `page.tsx` dosyası (sözleşme testi için). */
export function pageFileFor(href: string): string {
  return `src/app${href.split("?")[0]!.split("#")[0]}/page.tsx`;
}
