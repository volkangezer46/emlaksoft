import type { ICONS } from "@/lib/icons";
import type { AppModule, AppRole } from "@/lib/permissions";
import { MANAGEMENT_ROLES } from "@/lib/ui/scope";
import { earningsPath, financePath } from "@/lib/finance/routes";

/**
 * Yan menünün rol -> yapısı (TEK yer, TEK görünüm). Yalnız GÖRÜNÜRLÜK ve GRUPLAMADIR: yetki matrisi (`permissions.ts`)
 * değişmez, hiçbir sayfa silinmez, sayfa yolları sabittir; doğrudan adresler ve Ctrl+K araması tüm yetkili sayfalara
 * ulaşır.
 *
 * Menü (sahip kararı 2026-10-16, "tek görünüm", kurumsal referans): DÜZ satırlar, iş adıyla — Ana Sayfa, İlanlar ›,
 * Müşteriler ›, Portföy Yönetimi, Sahibinden Takibi, Randevular, Görevler, Teklifler, Sözleşmeler, Finans ›, Raporlar ›;
 * "Yönetim" başlığı altında Ekibim, Şubeler (şubeli ofiste), Pazarlama ›, Entegrasyonlar, Ayarlar. Her satır bir
 * "merkez"dir (hub): kardeş sayfalar sayfanın üstündeki TEK sekme şeridindedir; `sub` işaretli merkezler yan menüde
 * satır içinde açılan alt listeyle de gelir. Alt sabit satır (Yardım) ve "Paketim" kartı (Abonelik) bütçeye sayılmaz. Bütçeyi `nav-budget-contract.test.ts` korur.
 */

export const NAV_BUDGET = { advisor: 10, office: 18, admin: 6 } as const;

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
   * Temel sekme (C04): şeritte önce `core` sekmeler görünür (mobilde en çok 3, masaüstünde 4), kalanı "Tümü"
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
  /** İş alanı (tanıtım sayfasındaki "iş başlığı" sayısı ve komut paleti); yan menü düzdür, başlık çizmez. */
  group?: string;
  /** true: yan menüde satırın sağında ok; tıklayınca alt sayfalar satır içinde açılır (İlanlar, Raporlar, Pazarlama). */
  sub?: boolean;
  /** Yan menüde satırın ÜSTÜNDE küçük bölüm başlığı (ör. "Yönetim"); yalnız ilk satırda verilir. */
  heading?: string;
  /** "branches": satır yalnız şubeli ofiste görünür (Şubeler). */
  needs?: "branches";
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

/* ------------------------------- Danışman merkezleri ------------------------------- */

const BEN: HubDef = {
  id: "ben",
  label: "Performansım",
  short: "Ben",
  group: "Kişisel",
  icon: "rozet",
  // Hedef: danışmanın varsayılan yetkisinde `targets` modülü yok (hedefi yönetim belirler); izin verilen danışman hedefine
  // Performansım'daki "Hedefler" bağlantısından ve 360 "Hedef" sekmesinden ulaşır. Ölü menü satırı tutulmaz.
  pages: [p("/app/performansim", "Performansım"), p("/app/hesabim", "Profilim")],
};

/* ------------------------------- Muhasebe / çağrı / salt okunur ------------------------------- */

const ABONELIK_SATIRI: HubDef = { id: "abonelik", label: "Abonelik", icon: "abonelik", pages: [p("/app/abonelik")] };
const GELEN_KUTUSU: HubDef = { id: "gelen-kutusu", label: "Gelen kutusu", icon: "gelenKutusu", pages: [p("/app/gelen-kutusu", "Gelen kutusu")] };

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

/** Ana Sayfa: tek sayfa (randevu, görev ve onaylar kendi satırında; şerit çizilmez). */
const ANA_SAYFA: HubDef = { id: "bugun", label: "Ana Sayfa", short: "Ana Sayfa", group: "Günlük işler", icon: "dashboard", pages: [c("/app", "Ana sayfa")] };

/** İlanlar (yönetim): portal ilanlarının denetimi ve atanmamış portföy dağıtımı. */
const ILAN_MERKEZI: HubDef = {
  id: "ilan-merkezi",
  label: "İlanlar",
  group: "Portföy",
  icon: "ilanPortal",
  sub: true,
  pages: [c("/app/ilan-kontrol", "İlan kontrolü"), c("/app/ilan-havuzu", "Portföy dağıtımı")],
};

/** Sahibinden takibi: sahibinden ilan avı (FSBO) günlük iş; yan menüde eşitleme sağlığı noktasıyla. */
const SAHIBINDEN: HubDef = {
  id: "sahibinden",
  label: "Sahibinden Takibi",
  short: "Sahibinden",
  group: "Portföy",
  icon: "telefon",
  pages: [c("/app/portfoy-avi", "Sahibinden ilanlar")],
};

const MUSTERILER_YONETIM: HubDef = {
  id: "musteriler",
  label: "Müşteriler",
  group: "Günlük işler",
  icon: "baslikMusteri",
  sub: true,
  pages: [
    c("/app/musteriler", "Müşteriler"),
    c("/app/arama-listesi", "Arama listesi"),
    c("/app/talepler", "Talepler"),
    c("/app/gelen-kutusu", "Gelen kutusu"),
    p(ESLESME_HREF, "Eşleşme"),
    p("/app/tavsiyeler", "Tavsiyeler"),
  ],
};

/** Danışman müşteri şeridi: yönetici sekmeleri (Tavsiyeler) yok. */
const MUSTERILER_DANISMAN: HubDef = {
  id: "musteriler",
  label: "Müşteriler",
  group: "Günlük işler",
  icon: "baslikMusteri",
  pages: [c("/app/musteriler", "Müşteriler"), c("/app/arama-listesi", "Arama listesi"), c("/app/gelen-kutusu", "Gelen kutusu"), p("/app/talepler", "Talepler"), p(ESLESME_HREF, "Eşleşme")],
};

const PORTFOY_YONETIM: HubDef = {
  id: "ilanlar",
  label: "Portföy Yönetimi",
  short: "Portföy",
  group: "Portföy",
  icon: "baslikPortfoy",
  pages: [c("/app/portfoyler", "Portföyler"), c("/app/portfoyler/anahtarlar", "Anahtarlar"), c("/app/portfoyler/sunumlar", "Sunumlar"), p("/app/ayarlar/filigran", "Filigran")],
};

/** Danışman portföy şeridi (yönetimin İlanlar merkezi ve Filigran yok). */
const PORTFOY_DANISMAN: HubDef = {
  id: "ilanlar",
  label: "Portföy",
  short: "Portföy",
  group: "Portföy",
  icon: "baslikPortfoy",
  pages: [c("/app/portfoyler", "Portföyler"), c("/app/portfoyler/anahtarlar", "Anahtarlar"), c("/app/portfoyler/sunumlar", "Sunumlar")],
};

const RANDEVULAR: HubDef = { id: "randevular", label: "Randevular", group: "Günlük işler", icon: "randevu", pages: [c("/app/randevular", "Randevular")] };
const GOREVLER: HubDef = { id: "gorevler", label: "Görevler", group: "Günlük işler", icon: "gorev", pages: [c("/app/gorevler", "Görevler")] };

/** Teklifler: teklif, anlaşma ve onay kararları aynı satış akışının adımlarıdır. */
const TEKLIFLER: HubDef = {
  id: "teklifler",
  label: "Teklifler",
  group: "Satış",
  icon: "teklif",
  pages: [c("/app/teklifler", "Teklifler"), c("/app/anlasmalar", "Anlaşmalar"), c("/app/onaylar", "Onaylar")],
};

/** Danışman: varsayılan yetkide teklif modülü yok; satır anlaşmalarla açılır (teklif izni verilirse sekmede). */
const ANLASMALAR_DANISMAN: HubDef = {
  id: "teklifler",
  label: "Anlaşmalar",
  group: "Satış",
  icon: "baslikAnlasma",
  pages: [c("/app/anlasmalar", "Anlaşmalar"), c("/app/teklifler", "Teklifler"), c("/app/onaylar", "Onaylar")],
};

const SOZLESMELER: HubDef = {
  id: "sozlesmeler",
  label: "Sözleşmeler",
  group: "Satış",
  icon: "sozlesme",
  pages: [c("/app/sozlesmeler", "Sözleşmeler"), c("/app/ayarlar/sozlesme-sablonlari", "Şablonlar")],
};

const SOZLESMELER_DANISMAN: HubDef = { ...SOZLESMELER, pages: [c("/app/sozlesmeler", "Sözleşmeler"), c("/app/kiralama", "Kiralar")] };

/** Finans (gelir & gider): ilk 4 sayfa temel sekme; yan menüde satır içi alt liste. */
const GELIR_GIDER: HubDef = { ...FINANS, sub: true, pages: FINANS.pages.map((pg, i) => (i < 4 ? { ...pg, core: true } : pg)) };
const GELIR_GIDER_MUHASEBE: HubDef = { ...GELIR_GIDER, pages: [...GELIR_GIDER.pages, p("/app/aidat", "Aidatlar")] };

const RAPORLAR_MENU: HubDef = { ...RAPORLAR, sub: true };

/** Ekibim: hedef, karne, ofis kontrolü ve duyurular (Uyum Ayarlar'dadır); Takımlar/Şubeler/Lig/TV yalnız büyük ofiste temel sekmedir. */
const EKIBIM_YONETIM: HubDef = {
  id: "ekibim",
  label: "Ekibim",
  group: "Yönetim",
  heading: "Yönetim",
  icon: "ekip",
  pages: [
    c("/app/ekip", "Ekip"),
    c("/app/danisman-kpi", "Karne"),
    c("/app/hedefler", "Hedefler"),
    c("/app/ekip/devir", "Danışman devri"),
    c("/app/ekip/takimlar", "Takımlar", { needs: "bigOffice" }),
    c("/app/lig", "Lig", { needs: "bigOffice" }),
    c("/app/pano-tv", "TV ekranı", { needs: "bigOffice" }),
    p("/app/ofis-kontrol", "Ofis kontrolü"),
    p("/app/belgeler", "Ofis belgeleri"),
    p(DUYURU_YONETIM_HREF, "Duyurular"),
  ],
};

/** Şubeler: yalnız şubeli ofiste kendi satırı (şubesiz ofiste sayfa Ctrl+K ve Ekibim > Tümü yerine buradan açılmaz). */
const SUBELER: HubDef = { id: "subeler", label: "Şubeler", group: "Yönetim", icon: "sube", needs: "branches", pages: [c("/app/ekip/subeler", "Şubeler")] };

/** Pazarlama: kampanya, otomatik takip, vitrin ve aday yakalama (ofisin dışa dönük yüzü). */
const PAZARLAMA: HubDef = {
  id: "pazarlama",
  label: "Pazarlama",
  group: "Yönetim",
  icon: "duyuru",
  sub: true,
  pages: [
    c("/app/kampanyalar", "Kampanyalar"),
    c("/app/otomasyonlar", "Otomasyonlar"),
    c("/app/otomasyonlar/diziler", "Takip mesajları"),
    c("/app/ayarlar/vitrin", "Vitrin"),
    p("/app/ayarlar/lead", "Aday yakalama"),
  ],
};

const ENTEGRASYONLAR: HubDef = {
  id: "entegrasyonlar",
  label: "Entegrasyonlar",
  group: "Yönetim",
  icon: "entegrasyon",
  pages: [c("/app/ayarlar/entegrasyonlar", "Entegrasyonlar"), c("/app/ayarlar/api-webhook", "API ve webhook")],
};

/** Ayarlar: Pazarlama ve Entegrasyonlar satırlarına taşınan sayfalar çıkar; sık kullanılanlar temel sekmedir. */
const MOVED_FROM_SETTINGS = new Set([...PAZARLAMA.pages, ...ENTEGRASYONLAR.pages].map((pg) => pg.href));
const AYARLAR_MENU: HubDef = {
  ...AYARLAR,
  group: "Yönetim",
  pages: AYARLAR.pages
    .filter((pg) => !MOVED_FROM_SETTINGS.has(pg.href))
    .map((pg) => (["/app/ayarlar", "/app/ayarlar/yetkilendirme", "/app/ayarlar/guvenlik", "/app/ayarlar/moduller"].includes(pg.href) ? { ...pg, core: true } : pg)),
};

const KAZANCIM: HubDef = { id: "komisyon", label: "Kazancım", short: "Kazanç", group: "Satış", icon: "baslikFinans", pages: [c(earningsPath(), "Kazancım"), c(financePath("komisyon"), "Komisyon")] };

/**
 * Ofis yönetimi (sahip, genel müdür, şube müdürü): kurumsal referans menüsü. Şube müdürünün muhasebe (expenses) yetkisi
 * yoksa "Gelir & Gider" yalnız Komisyon / Hakediş / Kazancım'ı taşır (sayfa süzgeci).
 */
const MANAGER: RoleNav = {
  hubs: [
    ANA_SAYFA,
    ILAN_MERKEZI,
    MUSTERILER_YONETIM,
    PORTFOY_YONETIM,
    SAHIBINDEN,
    RANDEVULAR,
    GOREVLER,
    TEKLIFLER,
    SOZLESMELER,
    GELIR_GIDER,
    KIRALAMA_AIDAT,
    RAPORLAR_MENU,
    EKIBIM_YONETIM,
    SUBELER,
    PAZARLAMA,
    ENTEGRASYONLAR,
    AYARLAR_MENU,
  ],
  dock: [ABONELIK, YARDIM],
  tools: [...TOOLS_COMMON, "/app/buyume"],
  mobile: ["bugun", "musteriler", "new", "ilanlar", "menu"],
};

/** Danışman / takım lideri: kendi işleri (yönetim satırları yok). */
const ADVISOR: RoleNav = {
  hubs: [ANA_SAYFA, MUSTERILER_DANISMAN, PORTFOY_DANISMAN, SAHIBINDEN, RANDEVULAR, GOREVLER, ANLASMALAR_DANISMAN, SOZLESMELER_DANISMAN, KAZANCIM, BEN],
  dock: [ABONELIK, YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "musteriler", "new", "randevular", "menu"],
};

/**
 * Muhasebe: varsayılan yetkide kira modülü (rentals) yok → "Mülk yönetimi" satırı YOK (SK10); aidat tahsilatı
 * (expenses) Gelir & Gider merkezinin sekmesidir.
 */
const ACCOUNTING: RoleNav = {
  hubs: [ANA_SAYFA, GELIR_GIDER_MUHASEBE, RAPORLAR_MENU, ABONELIK_SATIRI],
  dock: [YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "finans", "raporlar", "menu"],
};

const CALL_CENTER: RoleNav = {
  hubs: [
    ANA_SAYFA,
    GELEN_KUTUSU,
    { id: "musteriler", label: "Müşteriler", icon: "baslikMusteri", pages: [p("/app/musteriler"), p("/app/arama-listesi", "Arama listesi"), p("/app/talepler"), p(ESLESME_HREF, "Eşleşme"), p("/app/portfoy-avi", "Sahibinden ilanlar")] },
    RANDEVULAR,
    GOREVLER,
  ],
  dock: [ABONELIK, YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "gelen-kutusu", "musteriler", "new", "menu"],
};

const READONLY: RoleNav = {
  hubs: [
    ANA_SAYFA,
    { id: "musteriler", label: "Müşteriler", icon: "baslikMusteri", pages: [p("/app/musteriler"), p("/app/talepler"), p(ESLESME_HREF, "Eşleşme")] },
    { id: "ilanlar", label: "Portföy", icon: "baslikPortfoy", pages: [p("/app/portfoyler", "Portföyler")] },
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

/** Bilinmeyen rolde en kısıtlı düzen (readonly) kullanılır; yetki zaten ayrıca süzer. */
export function navLayoutFor(role: string | null | undefined): RoleNav {
  return NAV_BY_ROLE[isAppRole(role) ? role : "readonly"];
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
