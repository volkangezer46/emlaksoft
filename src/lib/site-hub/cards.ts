import type { PlatformModule } from "@/lib/platform-access";

/**
 * "Site yönetimi" merkezinin kart envanteri (TEK kaynak): admin'in ONLINE yönetebildiği alanlar.
 * Her `href` GERÇEK bir `page.tsx`'e gider (sözleşme testi doğrular); olmayan ekran için kart eklenmez
 * (ör. EmlakFiyati analiz tarifesi ekranı yazılınca buraya eklenir). Ekran kopyası yok: kartlar mevcut ekranlara bağlanır.
 * `audit`: son değişikliği bulmak için `platform_audit_logs.action` önekleri; `eylem#kimlik` biçimi eylemi tam ve kayıt
 * kimliğini (ayar anahtarı) eşler (kişisel veri ve meta okunmaz). Yalnız Site, SEO ve Reklam alanının kartları burada;
 * Abonelik, personel, sistem ve duyuru kendi menü öğelerindedir (kokpitte kopya kart yok).
 */
export type HubCardId =
  | "site-menu"
  | "site-icerik"
  | "seo"
  | "hiz"
  | "reklam"
  | "medya"
  | "rehber"
  | "yardim"
  | "baglantilar"
  | "bakim-kayit";

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
  { id: "site-menu", title: "Site menüsü", description: "Üst menü, alt bilgi ve duyuru şeridi (taslak/yayın, geri dönüş).", href: "/admin/site/menu", module: "sitemenu", audit: ["site_menu."], hasDraft: true },
  { id: "site-icerik", title: "Site içeriği", description: "Ana sayfa metinleri, SSS, değerleme bölümü, demo ve kayıt üst metinleri.", href: "/admin/site/sayfalar/ana-sayfa", module: "sitecontent", audit: ["site_content."], hasDraft: true },
  { id: "seo", title: "SEO merkezi", description: "Sayfa başlıkları, açıklamalar, sitemap, robots ve yönlendirmeler; robot bulguları Kokpitteki öneri kuyruğuna düşer.", href: "/admin/site/seo", module: "seo", audit: ["seo."] },
  // S1 dikişi: kendi paketleriyle gelen ekranlar (modül = sayfa kapısı). Rehber taslaklı olsa da bağlantı kartıdır:
  // yazı listesi her zaman buradan açılır; bekleyen taslaklar ayrıca Yayın masasında görünür.
  { id: "hiz", title: "Hız", description: "Statik (hızlı) sayfalar, hız bütçesi, saha ve laboratuvar ölçümleri.", href: "/admin/site/hiz", module: "sitecontent", audit: [] },
  { id: "reklam", title: "Reklam ve huni", description: "Ziyaretten kayda huni, iniş yolları ve ziyaret sayacı ayarları.", href: "/admin/site/reklam", module: "reklam", audit: ["measure."] },
  { id: "medya", title: "Medya", description: "Site görselleri: yükleme, alternatif metin, kullanım yerleri ve görsel bütçesi.", href: "/admin/site/medya", module: "sitecontent", audit: ["site_media."] },
  { id: "rehber", title: "Rehber", description: "Rehber (blog) yazıları: taslak, yayın, sürümler; /rehber ve site haritası.", href: "/admin/site/rehber", module: "sitecontent", audit: ["site_guide."] },
  { id: "yardim", title: "Yardım merkezi", description: "Ofislerin Yardım ekranındaki rehber, SSS ve sözlük: taslak, yayın, 'işe yaradı mı' oyları.", href: "/admin/tickets/yardim", module: "sitecontent", audit: ["help_article."] },
  { id: "baglantilar", title: "Google bağlantıları", description: "Search Console ve Google Ads bağlantıları; kopan bağlantı Kokpit kuyruğuna düşer.", href: "/admin/site/baglantilar", module: "reklam", audit: ["google."] },
  { id: "bakim-kayit", title: "Bakım modu ve kayıt", description: "Bakım modu (varsayılan kapsam ofis paneli), bakım mesajı ve yeni ofis kaydı.", href: "/admin/ayarlar?kategori=kayit-bakim", module: "sistem", audit: ["settings.write#platform.maintenance_mode", "settings.write#platform.maintenance_message", "settings.write#platform.registration_open", "security.maintenance_scope"] },
];

/** `/admin/...` yolundan beklenen `page.tsx` dosyası (sözleşme testi için). */
export function pageFileFor(href: string): string {
  return `src/app${href.split("?")[0]!.split("#")[0]}/page.tsx`;
}
