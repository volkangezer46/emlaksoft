import type { ICONS } from "@/lib/icons";
import type { AppModule, AppRole } from "@/lib/permissions";
import { MANAGEMENT_ROLES } from "@/lib/ui/scope";
import { ROLE_LABELS } from "@/lib/role-labels";
import { earningsPath, financePath } from "@/lib/finance/routes";

/**
 * Yan menünün rol -> yapısı (TEK yer, TEK görünüm). Yalnız GÖRÜNÜRLÜK ve GRUPLAMADIR: yetki matrisi (`permissions.ts`)
 * değişmez, hiçbir sayfa silinmez, sayfa yolları sabittir; doğrudan adresler ve Ctrl+K araması tüm yetkili sayfalara
 * ulaşır.
 *
 * Menü (sahip kararı 2026-10-16, "iyi tespitler" turu): ofis yönetiminde 13 satır, beş grup başlığı altında —
 * Ana Sayfa · GÜNLÜK İŞ (Ajanda, Onaylar, Gelen kutusu) · MÜŞTERİ & PORTFÖY (Müşteriler, Portföyler, İlanlar & Portal) ·
 * SATIŞ (Anlaşmalar) · PARA (Finans, Mülk yönetimi) · YÖNETİM (Ekibim, Raporlar, Pazarlama); alt sabit bölümde Ayarlar
 * (Entegrasyonlar ve Uyum içinde), Yardım ve Paketim kartı (Abonelik). Her satır bir "merkez"dir (hub): kardeş sayfalar
 * sayfanın üstündeki TEK sekme şeridindedir; çok sayfalı merkezde satırın sağında ok vardır (alt liste yalnız istenince
 * açılır, şeritteki listeyi yan menüde tekrar etmez). Grup başlığı `group` değişince çizilir. Alt sabit satırlar
 * bütçeye sayılmaz. Bütçeyi `nav-budget-contract.test.ts` korur.
 */

/**
 * Admin (sahip kararı 2026-10-16, "çok gelişmiş özellikler menüler olsun"): satır bütçesi değil GRUP bütçesi; en çok 8
 * grup, grup başına en çok 6 satır; gruplar satır içi akordeondur (kapalı grup tek başlık satırı).
 */
/** adminGroups 9 (genişleme 2026-10, sahip "adminde çok fazla menü ve işlevsellik olacak"): Güvenlik & veri grubu. */
export const NAV_BUDGET = { advisor: 8, office: 13, admin: 6, adminGroups: 9 } as const;

export type HubIconKey = keyof typeof ICONS;

/** Merkez içi sayfa: yol (nav-config kataloğundaki öğe/sekme yolu) + merkez içinde gösterilecek ad (verilmezse katalog adı). */
export type HubPageRef = {
  href: string;
  label?: string;
  /** true: yalnız sayfanın KENDİ modül izni aranır (sahibi öğenin ek koşulu `needsItemModule` yok sayılır; ör. danışmanın Hedefim sayfası). */
  ownModule?: boolean;
  /** Yalnız bu rollerde görünür (ör. Sahiplik devri yalnız ofis sahibine; sayfa başkasına yalnız bilgi gösterir). */
  roles?: readonly AppRole[];
  /**
   * Temel sekme (C04): şeritte önce `core` sekmeler görünür (mobilde en çok 4, masaüstünde 6), kalanı "Tümü"
   * menüsündedir. Sayfa silinmez, yalnız katlanır.
   */
  core?: boolean;
  /** "bigOffice": sekme yalnız büyük ofiste (5 kişiden fazla ya da şubeli) temeldir; küçük ofiste "Tümü" altındadır. */
  needs?: "bigOffice";
};

export type HubDef = {
  id: string;
  label: string;
  icon: HubIconKey;
  /**
   * Grup başlığı (yan menüde satırların üstünde küçük büyük harfli başlık; önceki görünen satırın grubundan farklıysa
   * çizilir) ve tanıtım sayfasındaki "iş başlığı" sayısı.
   */
  group?: string;
  /** true: yan menüde satırın sağında ok; tıklayınca alt sayfalar satır içinde açılır (yalnız birden çok sayfada). */
  sub?: boolean;
  /** Mobil alt çubukta (360 px, 5 yuva) sığmayan uzun etiketin kısası; yalnız alt çubukta kullanılır. */
  short?: string;
  /** Şeritteki sıra = dizi sırası. İlk 5 sayfa görünür, kalanı "Diğer" menüsündedir. */
  pages: readonly HubPageRef[];
  /**
   * Merkezin ANA sayfasının modül kapısı (`requireModulePage` ile aynı izin): rolde bu modülün görüntüleme izni yoksa
   * merkez hiç çıkmaz; başka modüldeki tek bir alt sayfa ("Aidatlar") merkezi tek başına ayakta tutmaz (SK10: muhasebe
   * rolünde "Mülk yönetimi" çıkmaz, Aidatlar Muhasebe merkezindedir).
   */
  gate?: AppModule;
};

/** Mobil alt çubuk yuvası: bir merkez kimliği, "new" (+ Yeni eylem sayfası) ya da "menu" (tam menü çekmecesi). */
export type MobileSlot = string;

export type RoleNav = {
  /** Yan menünün ana satırları (bütçe sayılan). */
  hubs: readonly HubDef[];
  /** Menünün altındaki sabit merkezler (Ayarlar, Abonelik, Yardım): satır bütçesine sayılmaz. */
  dock: readonly HubDef[];
  /** "Araçlar" listesi: menü satırı DEĞİL; yol kataloğu. Modül kapalı/yetkisizse görünmez. */
  tools: readonly string[];
  /** Mobil alt çubuk (en çok 5 yuva). */
  mobile: readonly MobileSlot[];
};

const p = (href: string, label?: string, ownModule?: boolean, roles?: readonly AppRole[]): HubPageRef => ({
  href,
  ...(label ? { label } : {}),
  ...(ownModule ? { ownModule } : {}),
  ...(roles ? { roles } : {}),
});
/** Temel (core) sekme kısayolu: şeritte önde görünür. */
const c = (href: string, label?: string, extra: Omit<HubPageRef, "href" | "label" | "core"> = {}): HubPageRef => ({ ...p(href, label), ...extra, core: true });

/* ------------------------------- Ortak merkezler ------------------------------- */

/**
 * Finans (WP6, tek menü satırı): komisyon, hakediş, tahsilat ve mini muhasebe alt alanları gerçek yollardır
 * (`@/lib/finance/routes`). Sayfalar kendi modülüyle süzülür: muhasebe yetkisi olmayan müdür yalnız Komisyon / Hakediş /
 * Kazancım'ı görür ve satır Komisyon'a açılır.
 */
const FINANS: HubDef = {
  id: "finans",
  label: "Finans",
  group: "Finans",
  icon: "baslikFinans",
  pages: [
    p(financePath("genel"), "Genel bakış"),
    p(financePath("hareketler"), "Hareketler"),
    p(financePath("kasa-banka"), "Kasa ve banka"),
    p(financePath("cari"), "Alacak ve borç"),
    p(financePath("komisyon"), "Komisyon"),
    p(financePath("hakedis"), "Danışman ödemeleri"),
    p(financePath("tahsilat"), "Tahsilatlar"),
    p(financePath("faturalar"), "Faturalar"),
    p(financePath("belgeler"), "Belgeler"),
    p(financePath("tekrarlayan"), "Tekrarlayanlar"),
    p(financePath("butce"), "Bütçe"),
    p(financePath("vergi"), "Vergi"),
    p(financePath("raporlar"), "Finans raporları"),
    p(financePath("ayarlar"), "Finans ayarları"),
    p(earningsPath(), "Kazancım"),
  ],
};

const KIRALAMA_AIDAT: HubDef = {
  id: "kiralama",
  label: "Mülk yönetimi",
  group: "Finans",
  icon: "anahtar",
  gate: "rentals",
  pages: [p("/app/kiralama", "Kiralar"), p("/app/aidat", "Aidatlar"), p("/app/kira-artis", "Kira artışı")],
};

/** Ofis içi duyuru yönetimi (Bildirimler sayfasının yönetim sekmesi; `settings` izniyle görünür). */
export const DUYURU_YONETIM_HREF = "/app/bildirimler?sekme=yonetim";

/** Talepler sayfasının eşleşme görünümü: Müşteriler şeridinde KENDİ sekmesidir (sayfa içinde ikinci şerit yok). */
export const ESLESME_HREF = "/app/talepler?sekme=eslesme";
/** Raporlar sayfasının rapor merkezi görünümü (dışa aktarma): Raporlar şeridinde kendi sekmesi. */
export const RAPOR_MERKEZI_HREF = "/app/raporlar?sekme=merkez";

const RAPORLAR: HubDef = {
  id: "raporlar",
  label: "Raporlar",
  group: "Yönetim",
  icon: "baslikPerformans",
  pages: [
    p("/app/raporlar", "Genel"),
    p(RAPOR_MERKEZI_HREF, "Rapor merkezi"),
    p("/app/raporlar/huni", "Müşteriden satışa"),
    p("/app/raporlar/satis-hizi", "Satış hızı"),
    p("/app/bolge-analizi", "Bölge"),
    p("/app/raporlar/talep-arz", "Talep ve arz"),
    p("/app/anketler", "Anketler"),
    p("/app/raporlar/lead-hizi", "Yanıt hızı"),
    p("/app/franchise"),
  ],
};

/* ------------------------------- Alt sabit merkezler ------------------------------- */

const AYARLAR: HubDef = {
  id: "ayarlar",
  label: "Ayarlar",
  icon: "ayar",
  // İlk 5 şeritte görünür; seyrek kullanılanlar "Diğer" altındadır (şerit sırası = dizi sırası).
  pages: [
    p("/app/ayarlar", "Genel"),
    p("/app/ayarlar/yetkilendirme", "Yetkiler"),
    p("/app/ayarlar/guvenlik", "Güvenlik"),
    // KVKK / İYS uyumu ofis yükümlülüğüdür (ekip işi değil): Yetkiler ve Güvenlik'in yanında.
    p("/app/uyum", "Uyum"),
    p("/app/ayarlar/entegrasyonlar", "Entegrasyonlar"),
    p("/app/ayarlar/moduller", "Modüller"),
    p("/app/ayarlar/tanimlar", "Seçim listeleri"),
    p("/app/ayarlar/merkez", "Kurallar ve varsayılanlar"),
    p("/app/ayarlar/lead", "Aday yakalama"),
    p("/app/ayarlar/vitrin", "Vitrin"),
    p("/app/ayarlar/ozel-alanlar", "Özel alanlar"),
    p("/app/ayarlar/api-webhook", "API ve webhook"),
    p("/app/otomasyonlar", "Otomasyonlar"),
    p("/app/otomasyonlar/diziler", "Otomatik takip mesajları"),
    p("/app/ayarlar/is-akislari", "İş akışları"),
    p("/app/ayarlar/etiketler", "Etiketler"),
    p("/app/ayarlar/mesaj-sablonlari", "Mesaj şablonları"),
    p("/app/ayarlar/ai-kullanim", "AI kullanımı"),
    p("/app/ayarlar/cop-kutusu", "Çöp kutusu"),
    p("/app/ayarlar/cografya-bildir", "Bölge bildirimi"),
    p("/app/ayarlar/gercek-kullanim", "Gerçek kullanım"),
    // Ofis sahipliğini yalnız ofis sahibi devreder; genel müdüre sekme gösterilmez (B075).
    p("/app/ayarlar/sahiplik-devri", "Sahiplik devri", false, ["owner"]),
  ],
};
const ABONELIK: HubDef = { id: "abonelik", label: "Abonelik", icon: "abonelik", pages: [p("/app/abonelik")] };
const YARDIM: HubDef = { id: "yardim", label: "Yardım", icon: "destek", pages: [p("/app/yardim", "Yardım"), p("/app/destek", "Destek")] };

/* ------------------------------- Araçlar ------------------------------- */

const TOOLS_COMMON = [
  "/app/degerleme",
  "/app/hesaplayici",
  "/app/asistan",
  "/app/mahalle-notlari",
  "/app/yabanci-satis",
  "/app/ag",
  "/app/acik-ev",
  "/app/projeler",
] as const;

/* ------------------------------- Rol düzenleri (tek görünüm) ------------------------------- */

/**
 * Grup başlıkları (yan menüde satırların üstünde küçük büyük harfli başlık; `group` değişince çizilir). Ofis yönetimi:
 * Günlük iş · Müşteri & portföy · Satış · Para · Yönetim. Danışman: Günlük · İşlerim · Satış · Ben. Muhasebe: Para · Rapor.
 */
const G = { gunluk: "Günlük iş", musteri: "Müşteri & portföy", satis: "Satış", para: "Para", yonetim: "Yönetim" } as const;
const GD = { gunluk: "Günlük", islerim: "İşlerim", satis: "Satış", ben: "Ben" } as const;

/** Ana Sayfa: tek sayfa (şerit çizilmez); acil sayaç (gecikmiş işlerin toplamı) satırın sağında. Telefonda "Bugün". */
const ANA_SAYFA: HubDef = { id: "bugun", label: "Ana Sayfa", short: "Bugün", icon: "dashboard", pages: [c("/app", "Ana sayfa")] };

/** Ajanda: randevu ve görev aynı günün programıdır (tek satır, iki sekme); geciken görev kırmızı sayaç. */
const AJANDA: HubDef = {
  id: "ajanda",
  label: "Ajanda",
  group: G.gunluk,
  icon: "randevu",
  sub: true,
  pages: [c("/app/randevular", "Randevular"), c("/app/gorevler", "Görevler")],
};

/** Onaylar: komisyon/indirim kararları kendi satırında (turuncu sayaç yalnız bu satırda; Teklifler onay saymaz). */
const ONAYLAR: HubDef = { id: "onaylar", label: "Onaylar", group: G.gunluk, icon: "onay", pages: [c("/app/onaylar", "Onaylar")] };

const GELEN_KUTUSU: HubDef = { id: "gelen-kutusu", label: "Gelen kutusu", short: "Gelen", group: G.gunluk, icon: "gelenKutusu", pages: [c("/app/gelen-kutusu", "Gelen kutusu")] };

const MUSTERILER_YONETIM: HubDef = {
  id: "musteriler",
  label: "Müşteriler",
  group: G.musteri,
  icon: "baslikMusteri",
  sub: true,
  pages: [
    c("/app/musteriler", "Müşteriler"),
    c("/app/talepler", "Talepler"),
    c(ESLESME_HREF, "Eşleşme"),
    c("/app/arama-listesi", "Arama listesi"),
    p("/app/tavsiyeler", "Tavsiyeler"),
  ],
};

const PORTFOY_YONETIM: HubDef = {
  id: "ilanlar",
  label: "Portföyler",
  short: "Portföy",
  group: G.musteri,
  icon: "baslikPortfoy",
  sub: true,
  pages: [c("/app/portfoyler", "Portföyler"), c("/app/portfoyler/anahtarlar", "Anahtarlar"), c("/app/portfoyler/sunumlar", "Sunumlar"), p("/app/ayarlar/filigran", "Filigran")],
};

/** İlanlar & Portal: portal ilanlarının denetimi, atanmamış portföy dağıtımı ve sahibinden ilan takibi (eşitleme noktası). */
const ILAN_MERKEZI: HubDef = {
  id: "ilan-merkezi",
  label: "İlanlar",
  short: "İlanlar",
  group: G.musteri,
  icon: "ilanPortal",
  sub: true,
  pages: [c("/app/ilan-kontrol", "İlan kontrolü"), c("/app/ilan-havuzu", "Portföy dağıtımı"), c("/app/portfoy-avi", "Sahibinden takibi")],
};

/**
 * Anlaşmalar: anlaşma → teklif → sözleşme aynı satış işidir; tek satır, dört sekme (Tahta, Teklifler, Sözleşmeler,
 * Şablonlar). Onaylar kendi satırındadır.
 */
const ANLASMALAR: HubDef = {
  id: "anlasmalar",
  label: "Anlaşmalar",
  group: G.satis,
  icon: "baslikAnlasma",
  sub: true,
  pages: [c("/app/anlasmalar", "Tahta"), c("/app/teklifler", "Teklifler"), c("/app/sozlesmeler", "Sözleşmeler"), c("/app/ayarlar/sozlesme-sablonlari", "Şablonlar")],
};

/** Finans: ilk 5 sayfa temel sekme (Genel bakış, Hareketler, Kasa ve banka, Alacak ve borç, Komisyon). */
const GELIR_GIDER: HubDef = { ...FINANS, group: G.para, sub: true, pages: FINANS.pages.map((pg, i) => (i < 5 ? { ...pg, core: true } : pg)) };

const KIRALAMA_MENU: HubDef = { ...KIRALAMA_AIDAT, group: G.para, sub: true, pages: [c("/app/kiralama", "Kiralar"), c("/app/aidat", "Aidat"), c("/app/kira-artis", "Kira artışı")] };

/**
 * Ekibim: ekip, karne, hedefler, devir, ofis kontrolü ve duyurular temel sekme; Takımlar/Şubeler/Lig/TV yalnız büyük
 * ofiste (5 kişiden fazla ya da şubeli) temeldir. Uyum Ayarlar'dadır.
 */
const EKIBIM_YONETIM: HubDef = {
  id: "ekibim",
  label: "Ekibim",
  group: G.yonetim,
  icon: "ekip",
  sub: true,
  pages: [
    c("/app/ekip", "Ekip"),
    c("/app/danisman-kpi", "Karne"),
    c("/app/hedefler", "Hedefler"),
    c("/app/ekip/devir", "Devir"),
    c("/app/ofis-kontrol", "Ofis kontrolü"),
    p("/app/belgeler", "Ofis belgeleri"),
    c(DUYURU_YONETIM_HREF, "Duyurular"),
    c("/app/ekip/takimlar", "Takımlar", { needs: "bigOffice" }),
    c("/app/ekip/subeler", "Şubeler", { needs: "bigOffice" }),
    c("/app/lig", "Lig", { needs: "bigOffice" }),
    c("/app/pano-tv", "TV modu", { needs: "bigOffice" }),
  ],
};

const RAPORLAR_MENU: HubDef = { ...RAPORLAR, group: G.yonetim, sub: true };

/** Pazarlama: kampanya, otomasyon, vitrin ve aday yakalama (ofisin dışa dönük yüzü). */
const PAZARLAMA: HubDef = {
  id: "pazarlama",
  label: "Pazarlama",
  group: G.yonetim,
  icon: "duyuru",
  sub: true,
  pages: [
    c("/app/kampanyalar", "Kampanyalar"),
    c("/app/otomasyonlar", "Otomasyonlar"),
    c("/app/ayarlar/vitrin", "Vitrin"),
    c("/app/ayarlar/lead", "Aday yakalama"),
    p("/app/otomasyonlar/diziler", "Takip mesajları"),
  ],
};

/**
 * Ayarlar (alt sabit): Pazarlama'ya taşınan sayfalar çıkar; Entegrasyonlar, API ve Uyum buradadır. Sık kullanılanlar
 * temel sekmedir.
 */
const MOVED_FROM_SETTINGS = new Set(PAZARLAMA.pages.map((pg) => pg.href));
const AYARLAR_CORE = new Set(["/app/ayarlar", "/app/ayarlar/yetkilendirme", "/app/ayarlar/guvenlik", "/app/ayarlar/entegrasyonlar", "/app/ayarlar/moduller"]);
const AYARLAR_MENU: HubDef = {
  ...AYARLAR,
  pages: AYARLAR.pages.filter((pg) => !MOVED_FROM_SETTINGS.has(pg.href)).map((pg) => (AYARLAR_CORE.has(pg.href) ? { ...pg, core: true } : pg)),
};

/**
 * Ofis yönetimi (sahip, genel müdür, şube müdürü): 13 satır, beş grup başlığı. Satır yüksekliği masaüstünde 32 px;
 * 1366×768 ekranda menü kaydırmadan sığar (Ayarlar / Yardım / Paketim alt sabit bölümdedir). Şube müdürünün muhasebe
 * (expenses) yetkisi yoksa Finans yalnız Komisyon / Danışman ödemeleri / Kazancım'ı taşır (sayfa süzgeci).
 */
const MANAGER: RoleNav = {
  hubs: [ANA_SAYFA, AJANDA, ONAYLAR, GELEN_KUTUSU, MUSTERILER_YONETIM, PORTFOY_YONETIM, ILAN_MERKEZI, ANLASMALAR, GELIR_GIDER, KIRALAMA_MENU, EKIBIM_YONETIM, RAPORLAR_MENU, PAZARLAMA],
  dock: [AYARLAR_MENU, YARDIM, ABONELIK],
  tools: [...TOOLS_COMMON, "/app/buyume"],
  mobile: ["bugun", "musteriler", "new", "ilanlar", "menu"],
};

/* ------------------------------- Danışman / takım lideri ------------------------------- */

const AJANDAM: HubDef = { ...AJANDA, label: "Ajandam", group: GD.gunluk };
const GELEN_KUTUSU_DANISMAN: HubDef = { ...GELEN_KUTUSU, group: GD.gunluk };

/** Müşterilerim: yönetici sekmesi (Tavsiyeler) yok; Kampanyalar "Tümü" altında (kendi kampanyaları). */
const MUSTERILER_DANISMAN: HubDef = {
  id: "musteriler",
  label: "Müşterilerim",
  short: "Müşteriler",
  group: GD.islerim,
  icon: "baslikMusteri",
  sub: true,
  pages: [c("/app/musteriler", "Müşteriler"), c("/app/arama-listesi", "Arama listesi"), c("/app/talepler", "Talepler"), c(ESLESME_HREF, "Eşleşme"), p("/app/kampanyalar", "Kampanyalar")],
};

/** Portföylerim: yönetimin Portföy dağıtımı ve Filigran'ı yok; Sahibinden ve İlan kontrolü buradadır. */
const PORTFOY_DANISMAN: HubDef = {
  id: "ilanlar",
  label: "Portföylerim",
  short: "Portföy",
  group: GD.islerim,
  icon: "baslikPortfoy",
  sub: true,
  pages: [
    c("/app/portfoyler", "Portföyler"),
    c("/app/portfoyler/anahtarlar", "Anahtarlar"),
    c("/app/portfoyler/sunumlar", "Sunumlar"),
    c("/app/portfoy-avi", "Sahibinden"),
    p("/app/ilan-kontrol", "İlan kontrolü"),
  ],
};

/** Anlaşmalarım: varsayılan yetkide teklif modülü yok (izin verilirse sekmede); Onaylar "Tümü" altında, sayaç taşımaz. */
const ANLASMALAR_DANISMAN: HubDef = {
  id: "anlasmalar",
  label: "Anlaşmalarım",
  short: "Anlaşmalar",
  group: GD.satis,
  icon: "baslikAnlasma",
  sub: true,
  pages: [c("/app/anlasmalar", "Anlaşmalar"), c("/app/teklifler", "Teklifler"), c("/app/sozlesmeler", "Sözleşmeler"), c("/app/kiralama", "Kiralar"), p("/app/onaylar", "Onaylar")],
};

const KAZANCIM: HubDef = { id: "komisyon", label: "Kazancım", short: "Kazanç", group: GD.satis, icon: "baslikFinans", sub: true, pages: [c(earningsPath(), "Kazancım"), c(financePath("komisyon"), "Komisyon")] };

/** Performansım: karne, hedef (izin verilirse) ve lig; profil kullanıcı menüsünden de açılır. */
const BEN: HubDef = {
  id: "ben",
  label: "Performansım",
  short: "Ben",
  group: GD.ben,
  icon: "rozet",
  sub: true,
  pages: [c("/app/performansim", "Karne"), c("/app/hedefler", "Hedef", { ownModule: true }), c("/app/lig", "Lig", { ownModule: true }), p("/app/hesabim", "Profilim")],
};

/** Danışman / takım lideri: kendi işleri (yönetim satırları yok), 8 satır. Telefonda Bugün · Müşteriler · + Yeni · Portföy · Menü. */
const ADVISOR: RoleNav = {
  hubs: [ANA_SAYFA, AJANDAM, GELEN_KUTUSU_DANISMAN, MUSTERILER_DANISMAN, PORTFOY_DANISMAN, ANLASMALAR_DANISMAN, KAZANCIM, BEN],
  dock: [YARDIM, ABONELIK],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "musteriler", "new", "ilanlar", "menu"],
};

/* ------------------------------- Muhasebe ------------------------------- */

/**
 * Muhasebe: para işleri DÜZ satırlar (her satır bir iş); varsayılan yetkide kira modülü (rentals) yok → "Mülk yönetimi"
 * yok (SK10), Aidat (expenses) kendi satırı. Abonelik alt sabittir (Paketim kartı).
 */
const fin = (id: string, label: string, pages: readonly HubPageRef[], icon: HubIconKey = "baslikFinans", short?: string): HubDef => ({
  id,
  label,
  ...(short ? { short } : {}),
  group: G.para,
  icon,
  ...(pages.length > 1 ? { sub: true } : {}),
  pages,
});
const ACCOUNTING: RoleNav = {
  hubs: [
    ANA_SAYFA,
    fin("finans", "Hareketler", [c(financePath("hareketler"), "Hareketler"), c(financePath("genel"), "Genel bakış"), p(financePath("tekrarlayan"), "Tekrarlayanlar"), p(financePath("ayarlar"), "Finans ayarları")], "baslikFinans", "Hareket"),
    fin("kasa", "Kasa ve banka", [c(financePath("kasa-banka"), "Kasa ve banka")], "cuzdan", "Kasa"),
    fin("cari", "Alacaklar", [c(financePath("cari"), "Alacak ve borç"), c(financePath("tahsilat"), "Tahsilatlar")], "kazanc", "Alacak"),
    fin("komisyon", "Komisyon", [c(financePath("komisyon"), "Komisyon"), c(financePath("hakedis"), "Danışman ödemeleri"), p(earningsPath(), "Kazancım")], "komisyon"),
    fin("faturalar", "Faturalar", [c(financePath("faturalar"), "Faturalar"), c(financePath("belgeler"), "Belgeler"), p(financePath("vergi"), "Vergi")], "belge"),
    fin("aidat", "Aidat", [c("/app/aidat", "Aidat")], "aidat"),
    {
      id: "raporlar",
      label: "Raporlar",
      short: "Rapor",
      group: "Rapor",
      icon: "baslikPerformans",
      sub: true,
      pages: [c(financePath("raporlar"), "Finans raporları"), c(financePath("butce"), "Bütçe"), c("/app/raporlar", "Genel raporlar"), c(RAPOR_MERKEZI_HREF, "Rapor merkezi")],
    },
  ],
  dock: [YARDIM, ABONELIK],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "finans", "cari", "raporlar", "menu"],
};

/* ------------------------------- Çağrı merkezi / salt okunur ------------------------------- */

/** Çağrı merkezi: gelen kutusu, ajanda ve müşteri arama işleri (sahibinden ilan araması dahil). */
const CALL_CENTER: RoleNav = {
  hubs: [
    ANA_SAYFA,
    { ...GELEN_KUTUSU, group: G.gunluk },
    AJANDA,
    {
      id: "musteriler",
      label: "Müşteriler",
      group: "Müşteri",
      icon: "baslikMusteri",
      sub: true,
      pages: [c("/app/musteriler", "Müşteriler"), c("/app/arama-listesi", "Arama listesi"), c("/app/talepler", "Talepler"), p(ESLESME_HREF, "Eşleşme"), c("/app/portfoy-avi", "Sahibinden ilanlar")],
    },
  ],
  dock: [YARDIM, ABONELIK],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "gelen-kutusu", "new", "ajanda", "menu"],
};

const READONLY: RoleNav = {
  hubs: [
    ANA_SAYFA,
    { id: "musteriler", label: "Müşteriler", group: G.musteri, icon: "baslikMusteri", sub: true, pages: [p("/app/musteriler"), p("/app/talepler"), p(ESLESME_HREF, "Eşleşme")] },
    { id: "ilanlar", label: "Portföyler", short: "Portföy", group: G.musteri, icon: "baslikPortfoy", pages: [p("/app/portfoyler", "Portföyler")] },
    RAPORLAR_MENU,
  ],
  dock: [YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "musteriler", "ilanlar", "raporlar", "menu"],
};

export const NAV_BY_ROLE: Readonly<Record<AppRole, RoleNav>> = {
  owner: MANAGER,
  gm: MANAGER,
  branch_manager: MANAGER,
  team_lead: ADVISOR,
  advisor: ADVISOR,
  accounting: ACCOUNTING,
  call_center: CALL_CENTER,
  readonly: READONLY,
};

/** Yönetim rolleri. */
export { MANAGEMENT_ROLES };

function isAppRole(role: string | null | undefined): role is AppRole {
  return typeof role === "string" && Object.hasOwn(NAV_BY_ROLE, role);
}

/* ------------------------------- Menü yönetimi farkı (platform ayarı) ------------------------------- */

/**
 * MENÜ YÖNETİMİ (/admin/ayarlar/menu): süper admin ofis paneli menüsünü DÜZEN bazında ayarlar. Varsayılanlar (yukarıdaki
 * düzenler) TEK doğruluk kaynağıdır; ayar yalnız SEYREK FARKTIR (gizle / sırala / yeniden adlandır / grup gizle) ve
 * bilinmeyen anahtar yok sayılır. Fark yalnız GÖRÜNÜRLÜĞÜ daraltır: tanımlar yetki ve paket süzgecinden (`hubNav`)
 * ÖNCE uygulanır, bu yüzden hiçbir fark yetkisiz sayfayı menüye sokamaz; gizlenen sayfa da kapatılmaz (adres ve Ctrl+K
 * çalışır). Ana Sayfa ve Ayarlar gizlenemez (ilk sayfaları da).
 */
export type NavLayoutKey = "manager" | "advisor" | "accounting" | "call_center" | "readonly";

export const NAV_LAYOUT_KEYS: readonly NavLayoutKey[] = ["manager", "advisor", "accounting", "call_center", "readonly"];

export const NAV_LAYOUT_LABELS: Readonly<Record<NavLayoutKey, string>> = {
  manager: "Ofis sahibi / müdür",
  advisor: "Danışman / takım lideri",
  accounting: "Muhasebe",
  call_center: ROLE_LABELS.call_center ?? "call_center",
  readonly: ROLE_LABELS.readonly ?? "readonly",
};

const LAYOUT_KEY_OF_ROLE: Readonly<Record<AppRole, NavLayoutKey>> = {
  owner: "manager",
  gm: "manager",
  branch_manager: "manager",
  team_lead: "advisor",
  advisor: "advisor",
  accounting: "accounting",
  call_center: "call_center",
  readonly: "readonly",
};

/** Düzen anahtarının varsayılan düzeni (Menü yönetimi ekranı ve önizleme). */
export const NAV_LAYOUT_BY_KEY: Readonly<Record<NavLayoutKey, RoleNav>> = {
  manager: MANAGER,
  advisor: ADVISOR,
  accounting: ACCOUNTING,
  call_center: CALL_CENTER,
  readonly: READONLY,
};

export function navLayoutKeyOf(role: string | null | undefined): NavLayoutKey {
  return LAYOUT_KEY_OF_ROLE[isAppRole(role) ? role : "readonly"];
}

/** Gizlenemeyen merkezler (ilk sayfaları da gizlenemez): menüsüz ofis olmaz. */
export const REQUIRED_HUB_IDS: readonly string[] = ["bugun", "ayarlar"];

/** Merkez içi sayfa farkı anahtarı: "<merkez kimliği>><sayfa yolu>" (aynı yol iki merkezde ayrı ayarlanır). */
export const pageKey = (hubId: string, href: string) => `${hubId}>${href}`;

export type RoleNavOverride = {
  /** Gizli merkez kimlikleri ve `pageKey` sayfa anahtarları. */
  hidden?: readonly string[];
  /** Merkez kimlikleri istenen sırada; sıra yalnız AYNI grup içinde uygulanır (grup başlıkları dağılmaz). */
  order?: readonly string[];
  /** Merkez kimliği ya da `pageKey` → görünen ad. */
  labels?: Readonly<Record<string, string>>;
  /** Tümüyle gizlenen grup başlıkları ("Satış"); zorunlu merkezler etkilenmez. */
  hiddenGroups?: readonly string[];
};

export type NavOverrides = { roles?: Partial<Record<NavLayoutKey, RoleNavOverride>> };

const NAV_LABEL_MAX = 40;
const cleanLabel = (v: string | undefined) => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t && t.length <= NAV_LABEL_MAX ? t : null;
};

/**
 * Düzene farkı uygular (saf). Gizleme: merkez, sayfa, grup; sıra: grup içinde; ad: merkez ve sayfa. Zorunlu merkezler ve
 * ilk sayfaları korunur. Bilinmeyen kimlik ve fazla uzun ad yok sayılır. Fark yoksa AYNI nesne döner.
 */
export function applyNavOverride(layout: RoleNav, ov: RoleNavOverride | null | undefined): RoleNav {
  if (!ov) return layout;
  const hidden = new Set(ov.hidden ?? []);
  const hiddenGroups = new Set(ov.hiddenGroups ?? []);
  const labels = ov.labels ?? {};
  const order = ov.order ?? [];
  const required = (id: string) => REQUIRED_HUB_IDS.includes(id);
  const apply = (h: HubDef): HubDef | null => {
    if (!required(h.id) && (hidden.has(h.id) || (h.group && hiddenGroups.has(h.group)))) return null;
    const pages = h.pages
      .filter((pg, i) => (required(h.id) && i === 0) || !hidden.has(pageKey(h.id, pg.href)))
      .map((pg) => {
        const label = cleanLabel(labels[pageKey(h.id, pg.href)]);
        return label ? { ...pg, label } : pg;
      });
    if (pages.length === 0) return null;
    const label = cleanLabel(labels[h.id]);
    return { ...h, ...(label ? { label } : {}), pages };
  };
  const hubs = layout.hubs.flatMap((h) => apply(h) ?? []);
  // Grup içi sıra: ardışık aynı gruplu satır blokları kendi içinde verilen sıraya göre dizilir (bilinmeyen sonda, eski sırayla).
  const rank = (id: string, i: number) => {
    const at = order.indexOf(id);
    return at === -1 ? order.length + i : at;
  };
  const sorted: HubDef[] = [];
  for (let i = 0; i < hubs.length; ) {
    let j = i;
    while (j < hubs.length && hubs[j]!.group === hubs[i]!.group) j++;
    const block = hubs.slice(i, j).map((h, k) => ({ h, r: rank(h.id, i + k) }));
    block.sort((a, b) => a.r - b.r);
    sorted.push(...block.map((x) => x.h));
    i = j;
  }
  return { ...layout, hubs: sorted, dock: layout.dock.flatMap((h) => apply(h) ?? []) };
}

/** Bilinmeyen rolde en kısıtlı düzen (readonly) kullanılır; yetki zaten ayrıca süzer. Menü yönetimi farkı varsa uygulanır. */
export function navLayoutFor(role: string | null | undefined, overrides?: NavOverrides | null): RoleNav {
  const base = NAV_BY_ROLE[isAppRole(role) ? role : "readonly"];
  return applyNavOverride(base, overrides?.roles?.[navLayoutKeyOf(role)]);
}

export function isManagementRole(role: string | null | undefined): boolean {
  return typeof role === "string" && MANAGEMENT_ROLES.includes(role);
}

/** Her rolün düzeninde geçen yollar (test ve yetim denetimi için). */
export function layoutHrefs(layout: RoleNav): string[] {
  return [...layout.hubs, ...layout.dock].flatMap((h) => h.pages.map((pg) => pg.href)).concat(layout.tools);
}

/**
 * İş alanları (ofis yönetimi düzeni, menü sırasıyla): tanıtım sayfasındaki "iş başlığı" sayısı buradan türetilir
 * (sabit sayı yazılmaz).
 */
export const NAV_GROUPS: readonly string[] = [...new Set(MANAGER.hubs.flatMap((h) => (h.group ? [h.group] : [])))];
