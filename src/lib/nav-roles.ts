import type { ICONS } from "@/lib/icons";
import type { AppModule, AppRole } from "@/lib/permissions";
import { MANAGEMENT_ROLES } from "@/lib/ui/scope";

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

export const NAV_BUDGET = { advisor: 6, office: 11, admin: 6 } as const;

export type HubIconKey = keyof typeof ICONS;

/** Merkez içi sayfa: yol (nav-config kataloğundaki öğe/sekme yolu) + merkez içinde gösterilecek ad (verilmezse katalog adı). */
export type HubPageRef = {
  href: string;
  label?: string;
  /** true: yalnız sayfanın KENDİ modül izni aranır (sahibi öğenin ek koşulu `needsItemModule` yok sayılır; ör. danışmanın Hedefim sayfası). */
  ownModule?: boolean;
  /** Yalnız bu rollerde görünür (ör. Sahiplik devri yalnız ofis sahibine; sayfa başkasına yalnız bilgi gösterir). */
  roles?: readonly AppRole[];
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
};

const p = (href: string, label?: string, ownModule?: boolean, roles?: readonly AppRole[]): HubPageRef => ({
  href,
  ...(label ? { label } : {}),
  ...(ownModule ? { ownModule } : {}),
  ...(roles ? { roles } : {}),
});

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

const KOMISYON: HubDef = {
  id: "komisyon",
  label: "Komisyon",
  group: "Satış",
  icon: "baslikFinans",
  pages: [p("/app/komisyon", "Komisyon"), p("/app/cuzdan", "Kazanç")],
};

/** Muhasebe: gelir-gider, kasa/banka, düzenli ödemeler, faturalar (sayfa içi sekmeler). Kullanıcı: "muhasebe nerede?" (2026-10-12). */
const MUHASEBE: HubDef = {
  id: "muhasebe",
  label: "Muhasebe",
  group: "Finans",
  icon: "gider",
  pages: [p("/app/giderler", "Gelir ve gider")],
};

const KIRALAMA_AIDAT: HubDef = {
  id: "kiralama",
  label: "Mülk yönetimi",
  group: "Finans",
  icon: "anahtar",
  gate: "rentals",
  pages: [p("/app/kiralama", "Kiralar"), p("/app/aidat", "Aidatlar"), p("/app/kira-artis", "Kira artışı")],
};

/** Muhasebe rolü: kira modülü (rentals) yok; aidat tahsilatı (expenses) Muhasebe merkezinin sekmesidir. */
const MUHASEBE_MUHASEBECI: HubDef = { ...MUHASEBE, pages: [...MUHASEBE.pages, p("/app/aidat", "Aidatlar")] };

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
  label: "Komisyonum",
  group: "Satış",
  icon: "baslikFinans",
  pages: [p("/app/komisyon", "Komisyonum"), p("/app/cuzdan", "Kazanç")],
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
  hubs: [BUGUN, MUSTERILER, ILANLAR_YONETIM, HAVUZ_ATAMA, SAHIBINDEN, SATIS, KOMISYON, MUHASEBE, KIRALAMA_AIDAT, EKIBIM, RAPORLAR],
  dock: [AYARLAR, ABONELIK, YARDIM],
  tools: [...TOOLS_COMMON, "/app/buyume"],
  mobile: ["bugun", "musteriler", "new", "ilanlar", "menu"],
};

/** Şube müdürü: yönetim düzeni, muhasebe (expenses) yetkisi olmadığından Muhasebe satırı yok (ölü satır yasak). */
const BRANCH_MANAGER: RoleNav = { ...MANAGER, hubs: MANAGER.hubs.filter((h) => h.id !== "muhasebe") };

const ADVISOR: RoleNav = {
  hubs: [BUGUN, MUSTERILER, ILANLAR, SATIS_DANISMAN, KOMISYONUM, BEN],
  dock: [ABONELIK, YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "musteriler", "new", "ilanlar", "ben"],
};

/**
 * Muhasebe: varsayılan yetkide kira modülü (rentals) yok → "Mülk yönetimi" satırı YOK (erişilemeyen merkez 0, SK10);
 * aidat tahsilatı (expenses) Muhasebe merkezinin sekmesidir.
 */
const ACCOUNTING: RoleNav = {
  hubs: [BUGUN, KOMISYON, MUHASEBE_MUHASEBECI, RAPORLAR, ABONELIK_SATIRI],
  dock: [YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "muhasebe", "raporlar", "menu"],
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
 * Yan menü grup başlıkları (ofis yönetimi düzeni, menü sırasıyla): tanıtım sayfasındaki "iş başlığı" sayısı ve menü
 * anlatımları buradan türetilir (sabit sayı yazılmaz).
 */
export const NAV_GROUPS: readonly string[] = [...new Set(MANAGER.hubs.flatMap((h) => (h.group ? [h.group] : [])))];
