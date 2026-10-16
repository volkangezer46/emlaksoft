import type { ICONS } from "@/lib/icons";
import type { AppModule, AppRole } from "@/lib/permissions";
import { MANAGEMENT_ROLES } from "@/lib/ui/scope";
import { earningsPath, financePath } from "@/lib/finance/routes";

/**
 * Yan menünün rol -> ÇEKİRDEK yapısı (TEK yer). Yalnız GÖRÜNÜRLÜK ve GRUPLAMADIR: yetki matrisi
 * (`permissions.ts`) değişmez, hiçbir sayfa silinmez, sayfa yolları sabittir; doğrudan adresler ve
 * Ctrl+K araması tüm yetkili sayfalara ulaşmaya devam eder.
 *
 * Menü ANA İLKESİ (2026-10, "Google sadeliği"): yan menüde SAYI az, ad anlaşılır olmalıdır. Her satır bir
 * "merkez"dir (hub): satırın altındaki sayfalar o sayfaların üstündeki TEK sekme şeridinde durur. Rol başına:
 * ofis yönetimi 6, danışman 5, muhasebe 4, çağrı merkezi 4 satır. Alt sabit satırlar (Ayarlar, Abonelik, Yardım,
 * Menüyü düzenle) ve "Araçlar" satır bütçesine sayılmaz. Yeni özellik = yeni satır DEĞİL: mevcut merkeze sekme.
 * Bütçeyi `nav-budget-contract.test.ts` korur (gevşetme değil, öğeyi bir merkeze taşı).
 */

export const NAV_BUDGET = { advisor: 6, office: 11, officeSimple: 6, admin: 6 } as const;

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
   * Temel sekme (sadeleştirme planı C04): sade modda şeritte yalnız `core` sekmeler görünür (mobilde en çok 3, masaüstünde 4),
   * kalanı "Tümü" menüsündedir. Sayfa silinmez, yalnız katlanır.
   */
  core?: boolean;
  /** "bigOffice": sekme yalnız büyük ofiste (5 kişiden fazla ya da şubeli) temeldir; küçük ofiste "Tümü" altındadır. */
  needs?: "bigOffice";
};

export type HubDef = {
  id: string;
  label: string;
  icon: HubIconKey;
  /** Yan menüde üstte görünen küçük grup başlığı (ardışık aynı gruptakiler tek başlık altında). */
  group?: string;
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
  /**
   * Sade düzende "Daha fazla" altına katlanan merkezler (satır bütçesine sayılmaz; masaüstü menüde ve çekmecede kapalı
   * gelen tek açılır bölüm, Araçlar da oradadır). Tam düzende yoktur.
   */
  more?: readonly HubDef[];
};

const p = (href: string, label?: string, ownModule?: boolean, roles?: readonly AppRole[]): HubPageRef => ({
  href,
  ...(label ? { label } : {}),
  ...(ownModule ? { ownModule } : {}),
  ...(roles ? { roles } : {}),
});
/** Temel (core) sekme kısayolu: sade modda şeritte görünür. */
const c = (href: string, label?: string, extra: Omit<HubPageRef, "href" | "label" | "core"> = {}): HubPageRef => ({ ...p(href, label), ...extra, core: true });

/* ------------------------------- Ortak merkezler ------------------------------- */

const BUGUN: HubDef = {
  id: "bugun",
  label: "Bugün",
  group: "Günlük işler",
  icon: "baslikBugun",
  pages: [p("/app", "Bugün"), p("/app/randevular", "Randevular"), p("/app/gorevler", "Görevler")],
};

const MUSTERILER: HubDef = {
  id: "musteriler",
  label: "Müşteriler",
  group: "Günlük işler",
  icon: "baslikMusteri",
  pages: [
    p("/app/musteriler", "Müşteriler"),
    p("/app/arama-listesi", "Arama listesi"),
    p("/app/talepler", "Talepler"),
    p("/app/gelen-kutusu", "Gelen kutusu"),
    p("/app/tavsiyeler", "Tavsiyeler"),
    p("/app/kampanyalar", "Kampanyalar"),
  ],
};

const ILANLAR: HubDef = {
  id: "ilanlar",
  label: "Portföyler",
  short: "Portföy",
  group: "Portföy",
  icon: "baslikPortfoy",
  pages: [
    p("/app/portfoyler", "Portföyler"),
    p("/app/portfoy-avi", "Sahibinden ilanlar"),
    p("/app/ilan-havuzu", "Havuz ve atama"),
    p("/app/ilan-kontrol", "İlan kontrolü"),
    p("/app/portfoyler/anahtarlar", "Anahtarlar"),
    p("/app/portfoyler/sunumlar", "Sunumlar"),
    p("/app/ayarlar/filigran", "Filigran"),
  ],
};

const SATIS: HubDef = {
  id: "satis-para",
  label: "Anlaşmalar",
  group: "Satış",
  icon: "baslikAnlasma",
  pages: [p("/app/anlasmalar", "Anlaşmalar"), p("/app/teklifler", "Teklifler"), p("/app/sozlesmeler", "Sözleşmeler"), p("/app/onaylar", "Onaylar"), p("/app/ayarlar/sozlesme-sablonlari", "Sözleşme şablonu")],
};

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
    p(financePath("cari"), "Cari"),
    p(financePath("komisyon"), "Komisyon"),
    p(financePath("hakedis"), "Hakediş"),
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

/** Muhasebe rolü: kira modülü (rentals) yok; aidat tahsilatı (expenses) Finans merkezinin sekmesidir. */
const FINANS_MUHASEBECI: HubDef = { ...FINANS, pages: [...FINANS.pages, p("/app/aidat", "Aidatlar")] };

/** Ofis içi duyuru yönetimi (Bildirimler sayfasının yönetim sekmesi; `settings` izniyle görünür). */
export const DUYURU_YONETIM_HREF = "/app/bildirimler?sekme=yonetim";

const EKIBIM: HubDef = {
  id: "ekibim",
  label: "Ekibim",
  group: "Yönetim",
  icon: "ekip",
  pages: [
    p("/app/ekip", "Ekip"),
    p("/app/hedefler", "Hedefler"),
    p("/app/danisman-kpi", "Karne"),
    p("/app/ofis-kontrol", "Ofis kontrolü"),
    p("/app/belgeler", "Belgeler"),
    p("/app/uyum", "Uyum"),
    p(DUYURU_YONETIM_HREF, "Duyurular"),
    p("/app/pano-tv", "TV ekranı"),
    p("/app/ekip/takimlar", "Takımlar"),
    p("/app/ekip/subeler", "Şubeler"),
    p("/app/ekip/devir", "Danışman devri"),
    p("/app/lig", "Lig"),
  ],
};

const RAPORLAR: HubDef = {
  id: "raporlar",
  label: "Raporlar",
  group: "Yönetim",
  icon: "baslikPerformans",
  pages: [
    p("/app/raporlar", "Genel"),
    p("/app/raporlar/huni", "Satış hunisi"),
    p("/app/raporlar/satis-hizi", "Satış hızı"),
    p("/app/bolge-analizi", "Bölge"),
    p("/app/raporlar/talep-arz", "Talep ve arz"),
    p("/app/anketler", "Anketler"),
    p("/app/raporlar/lead-hizi", "Yanıt hızı"),
    p("/app/franchise"),
  ],
};

/* ------------------------------- Danışman merkezleri ------------------------------- */

const SATIS_DANISMAN: HubDef = {
  id: "satis",
  label: "Anlaşmalar",
  group: "Satış",
  icon: "baslikAnlasma",
  pages: [p("/app/anlasmalar", "Anlaşmalar"), p("/app/teklifler", "Teklifler"), p("/app/onaylar", "Onaylar"), p("/app/sozlesmeler", "Sözleşmeler"), p("/app/kiralama", "Kiralar")],
};

const KOMISYONUM: HubDef = {
  id: "komisyon",
  label: "Kazancım",
  short: "Kazanç",
  group: "Satış",
  icon: "baslikFinans",
  pages: [p(financePath("komisyon"), "Komisyon"), p(earningsPath(), "Kazancım")],
};

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
const RANDEVU_GOREV: HubDef = {
  id: "randevu-gorev",
  label: "Randevular",
  icon: "randevu",
  pages: [p("/app/randevular", "Randevular"), p("/app/gorevler", "Görevler")],
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
    p("/app/ayarlar/entegrasyonlar", "Entegrasyonlar"),
    p("/app/ayarlar/moduller", "Modüller"),
    p("/app/ayarlar/tanimlar", "Seçim listeleri"),
    p("/app/ayarlar/merkez", "Kurallar ve varsayılanlar"),
    p("/app/ayarlar/lead", "Aday yakalama"),
    p("/app/ayarlar/vitrin", "Vitrin"),
    p("/app/ayarlar/ozel-alanlar", "Özel alanlar"),
    p("/app/ayarlar/api-webhook", "API ve webhook"),
    p("/app/otomasyonlar", "Otomasyonlar"),
    p("/app/otomasyonlar/diziler", "Takip dizileri"),
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

/* ------------------------------- Rol düzenleri ------------------------------- */

/** Yönetim: havuz ve atama ofisin günlük iş akışının merkezi — kendi menü satırı (kullanıcı kararı 2026-10-11). */
const HAVUZ_ATAMA: HubDef = {
  id: "havuz",
  label: "Havuz ve atama",
  group: "Portföy",
  icon: "ilanHavuzu",
  pages: [p("/app/ilan-havuzu", "Bekleyen ilanlar")],
};
/** Yönetim: sahibinden ilan avı günlük iş — kendi menü satırı (kullanıcı: "fsbo menüde görünmüyor", 2026-10-12). Danışmanda Portföyler sekmesi. */
const SAHIBINDEN: HubDef = {
  id: "sahibinden",
  label: "Sahibinden ilanlar",
  short: "Sahibinden",
  group: "Portföy",
  icon: "telefon",
  pages: [p("/app/portfoy-avi", "Sahibinden ilanlar")],
};
const ILANLAR_YONETIM: HubDef = { ...ILANLAR, pages: ILANLAR.pages.filter((pg) => pg.href !== "/app/ilan-havuzu" && pg.href !== "/app/portfoy-avi") };

const MANAGER: RoleNav = {
  hubs: [BUGUN, MUSTERILER, ILANLAR_YONETIM, HAVUZ_ATAMA, SAHIBINDEN, SATIS, FINANS, KIRALAMA_AIDAT, EKIBIM, RAPORLAR],
  dock: [AYARLAR, ABONELIK, YARDIM],
  tools: [...TOOLS_COMMON, "/app/buyume"],
  mobile: ["bugun", "musteriler", "new", "ilanlar", "menu"],
};

/** Şube müdürü: yönetim düzeni; muhasebe (expenses) yetkisi olmadığından Finans satırı yalnız Komisyon / Hakediş / Kazancım'ı taşır. */
const BRANCH_MANAGER: RoleNav = MANAGER;

const ADVISOR: RoleNav = {
  hubs: [BUGUN, MUSTERILER, ILANLAR, SATIS_DANISMAN, KOMISYONUM, BEN],
  dock: [ABONELIK, YARDIM],
  tools: TOOLS_COMMON,
  // Üst çubukta hamburger yok (plan 2.3): her rolün alt çubuğunda "Menü" yuvası olmalı (Performansım çekmecede).
  mobile: ["bugun", "musteriler", "new", "ilanlar", "menu"],
};

/**
 * Muhasebe: varsayılan yetkide kira modülü (rentals) yok → "Mülk yönetimi" satırı YOK (erişilemeyen merkez 0, SK10);
 * aidat tahsilatı (expenses) Muhasebe merkezinin sekmesidir.
 */
const ACCOUNTING: RoleNav = {
  hubs: [BUGUN, FINANS_MUHASEBECI, RAPORLAR, ABONELIK_SATIRI],
  dock: [YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "finans", "raporlar", "menu"],
};

const CALL_CENTER: RoleNav = {
  hubs: [
    { id: "bugun", label: "Bugün", icon: "baslikBugun", pages: [p("/app", "Ana ekran")] },
    GELEN_KUTUSU,
    { id: "musteriler", label: "Müşteriler", icon: "baslikMusteri", pages: [p("/app/musteriler"), p("/app/arama-listesi", "Arama listesi"), p("/app/talepler"), p("/app/portfoy-avi", "Sahibinden ilanlar")] },
    RANDEVU_GOREV,
  ],
  dock: [ABONELIK, YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "gelen-kutusu", "musteriler", "new", "menu"],
};

const READONLY: RoleNav = {
  hubs: [
    BUGUN,
    { id: "musteriler", label: "Müşteriler", icon: "baslikMusteri", pages: [p("/app/musteriler"), p("/app/talepler")] },
    { id: "ilanlar", label: "Portföyler", icon: "baslikPortfoy", pages: [p("/app/portfoyler", "Portföyler")] },
    RAPORLAR,
  ],
  dock: [YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "musteriler", "ilanlar", "raporlar", "menu"],
};

/* ------------------------------- Sade düzenler (plan 2.2, C03) ------------------------------- */
/*
 * Sade görünümde (varsayılan) rol menüsü azalır; HİÇBİR sayfa düşmez: tam düzenin her yolu sade düzende de bir
 * merkezin sekmesi, "Daha fazla" ya da Araçlar altındadır (nav-roles.test: kapsama sözleşmesi). Ctrl+K hep tüm sayfalar.
 */

/** Danışman "Bugün": tek sayfa (randevu ve görevler kendi merkezinde). */
const BUGUN_DANISMAN: HubDef = { id: "bugun", label: "Bugün", icon: "baslikBugun", pages: [c("/app", "Bugün")] };

/** Danışman müşteri şeridi: yönetici sekmeleri (Tavsiyeler, Kampanyalar) yok; Talepler "Tümü" altında. */
const MUSTERILER_DANISMAN: HubDef = {
  id: "musteriler",
  label: "Müşteriler",
  icon: "baslikMusteri",
  pages: [c("/app/musteriler", "Müşteriler"), c("/app/arama-listesi", "Arama listesi"), c("/app/gelen-kutusu", "Gelen kutusu"), p("/app/talepler", "Talepler")],
};

/** Danışman portföy şeridi: Havuz ve atama, İlan kontrolü, Filigran (yönetim işleri) yok. */
const ILANLAR_DANISMAN: HubDef = {
  id: "ilanlar",
  label: "Portföyler",
  short: "Portföy",
  icon: "baslikPortfoy",
  pages: [c("/app/portfoyler", "Portföyler"), c("/app/portfoy-avi", "Sahibinden ilanlar"), p("/app/portfoyler/anahtarlar", "Anahtarlar"), p("/app/portfoyler/sunumlar", "Sunumlar")],
};

const RANDEVULAR_DANISMAN: HubDef = { ...RANDEVU_GOREV, pages: [c("/app/randevular", "Randevular"), c("/app/gorevler", "Görevler")] };

const KAZANCIM: HubDef = { id: "komisyon", label: "Kazancım", short: "Kazanç", icon: "baslikFinans", pages: [c(earningsPath(), "Kazancım"), c(financePath("komisyon"), "Komisyon")] };

const ANLASMALARIM: HubDef = { ...SATIS_DANISMAN, label: "Anlaşmalarım", group: undefined };
const PERFORMANSIM: HubDef = { ...BEN, group: undefined };

/** Danışman sade: Bugün · Müşteriler · Portföyler · Randevular · Kazancım · Daha fazla (Anlaşmalarım, Performansım, Profilim, Araçlar). */
const ADVISOR_SIMPLE: RoleNav = {
  hubs: [BUGUN_DANISMAN, MUSTERILER_DANISMAN, ILANLAR_DANISMAN, RANDEVULAR_DANISMAN, KAZANCIM],
  more: [ANLASMALARIM, PERFORMANSIM],
  dock: [ABONELIK, YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "musteriler", "new", "randevu-gorev", "menu"],
};

/** Sahip "Bugün": Onaylar buraya taşınır (bekleyen onay Bugün yuvasında rozet). */
const BUGUN_SAHIP: HubDef = {
  id: "bugun",
  label: "Bugün",
  icon: "baslikBugun",
  pages: [c("/app", "Bugün"), c("/app/onaylar", "Onaylar"), c("/app/randevular", "Randevular"), c("/app/gorevler", "Görevler")],
};

const MUSTERILER_SAHIP: HubDef = {
  ...MUSTERILER,
  group: undefined,
  pages: [
    c("/app/musteriler", "Müşteriler"),
    c("/app/arama-listesi", "Arama listesi"),
    c("/app/talepler", "Talepler"),
    c("/app/gelen-kutusu", "Gelen kutusu"),
    p("/app/tavsiyeler", "Tavsiyeler"),
    p("/app/kampanyalar", "Kampanyalar"),
  ],
};

/** Sahip portföy: Havuz ve Sahibinden ayrı satır değil, sekme. Filigran Ayarlar'a taşınır. */
const PORTFOY_SAHIP: HubDef = {
  id: "ilanlar",
  label: "Portföyler",
  short: "Portföy",
  icon: "baslikPortfoy",
  pages: [
    c("/app/portfoyler", "Portföyler"),
    c("/app/ilan-havuzu", "Havuz"),
    c("/app/portfoy-avi", "Sahibinden"),
    p("/app/ilan-kontrol", "İlan kontrolü"),
    p("/app/portfoyler/anahtarlar", "Anahtarlar"),
    p("/app/portfoyler/sunumlar", "Sunumlar"),
  ],
};

/** Sahip anlaşmalar: Onaylar Bugün'de. */
const SATIS_SAHIP: HubDef = {
  ...SATIS,
  group: undefined,
  pages: [c("/app/anlasmalar", "Anlaşmalar"), c("/app/teklifler", "Teklifler"), c("/app/sozlesmeler", "Sözleşmeler"), p("/app/ayarlar/sozlesme-sablonlari", "Sözleşme şablonu")],
};

/** "Para": Finans + Mülk yönetimi tek merkezde. Kira sayfaları kendi modülüyle (rentals) süzülür. */
const PARA: HubDef = {
  id: "finans",
  label: "Para",
  icon: "baslikFinans",
  pages: [
    c(financePath("genel"), "Özet"),
    c(financePath("hareketler"), "Gelir-Gider"),
    c(financePath("cari"), "Alacak ve borç"),
    c(financePath("komisyon"), "Komisyon"),
    p(financePath("hakedis"), "Danışman ödemeleri"),
    p(financePath("kasa-banka"), "Kasa ve banka"),
    p(financePath("tahsilat"), "Tahsilatlar"),
    p(financePath("faturalar"), "Faturalar"),
    p(financePath("belgeler"), "Fiş ve faturalar"),
    p(financePath("tekrarlayan"), "Tekrarlayanlar"),
    p(financePath("butce"), "Bütçe"),
    p(financePath("vergi"), "Vergi"),
    p(financePath("raporlar"), "Finans raporları"),
    p(financePath("ayarlar"), "Finans ayarları"),
    p(earningsPath(), "Kazancım"),
    p("/app/kiralama", "Kiralar"),
    p("/app/aidat", "Aidatlar"),
    p("/app/kira-artis", "Kira artışı"),
  ],
};

/** Sahip "Ekibim": Raporlar buraya sekme olarak taşınır. Takımlar/Şubeler/Lig/TV yalnız büyük ofiste temeldir. */
const EKIBIM_SAHIP: HubDef = {
  id: "ekibim",
  label: "Ekibim",
  icon: "ekip",
  pages: [
    c("/app/ekip", "Ekip"),
    c("/app/danisman-kpi", "Karne"),
    c("/app/ekip/devir", "Danışman devri"),
    c("/app/raporlar", "Raporlar"),
    c("/app/ekip/takimlar", "Takımlar", { needs: "bigOffice" }),
    c("/app/ekip/subeler", "Şubeler", { needs: "bigOffice" }),
    c("/app/lig", "Lig", { needs: "bigOffice" }),
    c("/app/pano-tv", "TV ekranı", { needs: "bigOffice" }),
    p("/app/hedefler", "Hedefler"),
    p("/app/ofis-kontrol", "Ofis kontrolü"),
    p("/app/belgeler", "Ofis belgeleri"),
    p("/app/uyum", "Uyum"),
    p(DUYURU_YONETIM_HREF, "Duyurular"),
    p("/app/raporlar/huni", "Müşteriden satışa"),
    p("/app/raporlar/satis-hizi", "Satış hızı"),
    p("/app/bolge-analizi", "Bölge"),
    p("/app/raporlar/talep-arz", "Talep ve arz"),
    p("/app/anketler", "Anketler"),
    p("/app/raporlar/lead-hizi", "Yanıt hızı"),
    p("/app/franchise"),
  ],
};

/** Sade Ayarlar: Filigran (portföyden taşındı) burada; temel sekmeler yalnız sık kullanılanlar. */
const AYARLAR_SADE: HubDef = {
  ...AYARLAR,
  pages: [
    ...AYARLAR.pages.map((pg) =>
      ["/app/ayarlar", "/app/ayarlar/yetkilendirme", "/app/ayarlar/vitrin", "/app/ayarlar/tanimlar"].includes(pg.href) ? { ...pg, core: true } : pg,
    ),
    p("/app/ayarlar/filigran", "Filigran"),
  ],
};

/** Sahip sade / küçük ofis: Bugün · Müşteriler · Portföyler · Anlaşmalar · Para · Ekibim · Daha fazla (Araçlar). */
const OWNER_SIMPLE: RoleNav = {
  hubs: [BUGUN_SAHIP, MUSTERILER_SAHIP, PORTFOY_SAHIP, SATIS_SAHIP, PARA, EKIBIM_SAHIP],
  more: [],
  dock: [AYARLAR_SADE, ABONELIK, YARDIM],
  tools: [...TOOLS_COMMON, "/app/buyume"],
  mobile: ["bugun", "musteriler", "new", "ilanlar", "menu"],
};

/** Sade düzenler (rol → düzen). Listede olmayan rol (muhasebe, çağrı, salt okunur) zaten kısadır: tam düzeni kullanır. */
export const SIMPLE_NAV_BY_ROLE: Readonly<Partial<Record<AppRole, RoleNav>>> = {
  owner: OWNER_SIMPLE,
  gm: OWNER_SIMPLE,
  branch_manager: OWNER_SIMPLE,
  team_lead: ADVISOR_SIMPLE,
  advisor: ADVISOR_SIMPLE,
};

export const NAV_BY_ROLE: Readonly<Record<AppRole, RoleNav>> = {
  owner: MANAGER,
  gm: MANAGER,
  branch_manager: BRANCH_MANAGER,
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

/**
 * Bilinmeyen rolde en kısıtlı düzen (readonly) kullanılır; yetki zaten ayrıca süzer. `simple`: sade görünüm açıksa rolün
 * sade düzeni (yoksa tam düzen).
 */
export function navLayoutFor(role: string | null | undefined, opts: { simple?: boolean } = {}): RoleNav {
  const key: AppRole = isAppRole(role) ? role : "readonly";
  return (opts.simple ? SIMPLE_NAV_BY_ROLE[key] : undefined) ?? NAV_BY_ROLE[key];
}

export function isManagementRole(role: string | null | undefined): boolean {
  return typeof role === "string" && MANAGEMENT_ROLES.includes(role);
}

/** Her rolün düzeninde geçen yollar (test ve yetim denetimi için). */
export function layoutHrefs(layout: RoleNav): string[] {
  return [...layout.hubs, ...(layout.more ?? []), ...layout.dock].flatMap((h) => h.pages.map((pg) => pg.href)).concat(layout.tools);
}

/**
 * Yan menü grup başlıkları (ofis yönetimi düzeni, menü sırasıyla): tanıtım sayfasındaki "iş başlığı" sayısı ve menü
 * anlatımları buradan türetilir (sabit sayı yazılmaz).
 */
export const NAV_GROUPS: readonly string[] = [...new Set(MANAGER.hubs.flatMap((h) => (h.group ? [h.group] : [])))];
