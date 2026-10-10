import type { ICONS } from "@/lib/icons";
import type { AppRole } from "@/lib/permissions";

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

export const NAV_BUDGET = { advisor: 5, office: 7, admin: 6 } as const;

export type HubIconKey = keyof typeof ICONS;

/** Merkez içi sayfa: yol (nav-config kataloğundaki öğe/sekme yolu) + merkez içinde gösterilecek ad (verilmezse katalog adı). */
export type HubPageRef = {
  href: string;
  label?: string;
  /** true: yalnız sayfanın KENDİ modül izni aranır (sahibi öğenin ek koşulu `needsItemModule` yok sayılır; ör. danışmanın Hedefim sayfası). */
  ownModule?: boolean;
};

export type HubDef = {
  id: string;
  label: string;
  icon: HubIconKey;
  /** Şeritteki sıra = dizi sırası. İlk 5 sayfa görünür, kalanı "Diğer" menüsündedir. */
  pages: readonly HubPageRef[];
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

const p = (href: string, label?: string, ownModule?: boolean): HubPageRef => ({ href, ...(label ? { label } : {}), ...(ownModule ? { ownModule } : {}) });

/* ------------------------------- Ortak merkezler ------------------------------- */

const BUGUN: HubDef = {
  id: "bugun",
  label: "Bugün",
  icon: "baslikBugun",
  pages: [p("/app", "Ana ekran"), p("/app/randevular"), p("/app/gorevler")],
};

const MUSTERILER: HubDef = {
  id: "musteriler",
  label: "Müşteriler",
  icon: "baslikMusteri",
  pages: [
    p("/app/musteriler"),
    p("/app/talepler"),
    p("/app/gelen-kutusu", "Gelen kutusu"),
    p("/app/akilli-listeler"),
    p("/app/kayip-satis"),
    p("/app/tavsiyeler"),
    p("/app/kampanyalar"),
    p("/app/ayarlar/etiketler"),
    p("/app/ayarlar/mesaj-sablonlari"),
  ],
};

const ILANLAR: HubDef = {
  id: "ilanlar",
  label: "İlanlar",
  icon: "baslikPortfoy",
  pages: [
    p("/app/portfoyler"),
    p("/app/ilan-havuzu", "Havuz ve Atama"),
    p("/app/ilan-kontrol"),
    p("/app/portallar"),
    p("/app/portfoyler/anahtarlar", "Anahtar"),
    p("/app/portfoyler/sunumlar"),
    p("/app/ayarlar/filigran"),
  ],
};

const SATIS_PARA: HubDef = {
  id: "satis-para",
  label: "Satış ve Para",
  icon: "baslikAnlasma",
  pages: [
    p("/app/anlasmalar"),
    p("/app/teklifler"),
    p("/app/komisyon"),
    p("/app/giderler", "Finans"),
    p("/app/kiralama"),
    p("/app/sozlesmeler"),
    p("/app/cuzdan", "Kazanç"),
    p("/app/onaylar"),
    p("/app/kira-artis"),
    p("/app/aidat"),
    p("/app/ayarlar/sozlesme-sablonlari"),
  ],
};

const EKIBIM: HubDef = {
  id: "ekibim",
  label: "Ekibim",
  icon: "ekip",
  pages: [
    p("/app/ekip", "Danışmanlar"),
    p("/app/hedefler"),
    p("/app/danisman-kpi", "Ekip karnesi"),
    p("/app/pano-tv", "TV modu"),
    p("/app/ofis-kontrol"),
    p("/app/ekip/takimlar"),
    p("/app/ekip/subeler"),
    p("/app/ekip/devir"),
    p("/app/lig"),
    p("/app/ekip/kiyas", "Karşılaştır"),
    p("/app/denetim"),
    p("/app/ofis-merkezi"),
  ],
};

const RAPORLAR: HubDef = {
  id: "raporlar",
  label: "Raporlar",
  icon: "baslikPerformans",
  pages: [
    p("/app/raporlar", "Ofis"),
    p("/app/bolge-analizi"),
    p("/app/raporlar/talep-arz"),
    p("/app/raporlar/memnuniyet"),
    p("/app/raporlar/kar-zarar"),
    p("/app/anketler"),
    p("/app/raporlar/lead-hizi"),
    p("/app/franchise"),
  ],
};

/* ------------------------------- Danışman merkezleri ------------------------------- */

const SATIS_DANISMAN: HubDef = {
  id: "satis",
  label: "Satış",
  icon: "baslikAnlasma",
  pages: [
    p("/app/anlasmalar"),
    p("/app/teklifler"),
    p("/app/komisyon", "Komisyonum"),
    p("/app/cuzdan", "Kazanç"),
    p("/app/onaylar"),
    p("/app/sozlesmeler"),
    p("/app/kiralama"),
  ],
};

const BEN: HubDef = {
  id: "ben",
  label: "Ben",
  icon: "rozet",
  pages: [p("/app/performansim"), p("/app/hedefler", "Hedefim", true), p("/app/hesabim", "Profilim")],
};

/* ------------------------------- Muhasebe / çağrı / salt okunur ------------------------------- */

const PARA: HubDef = {
  id: "para",
  label: "Para",
  icon: "baslikFinans",
  pages: [
    p("/app/giderler", "Finans"),
    p("/app/komisyon"),
    p("/app/cuzdan", "Kazanç"),
    p("/app/onaylar"),
    p("/app/kiralama"),
    p("/app/kira-artis"),
    p("/app/aidat"),
  ],
};

const ABONELIK_SATIRI: HubDef = { id: "abonelik", label: "Abonelik", icon: "abonelik", pages: [p("/app/abonelik")] };
const GELEN_KUTUSU: HubDef = { id: "gelen-kutusu", label: "Gelen kutusu", icon: "gelenKutusu", pages: [p("/app/gelen-kutusu", "Gelen kutusu")] };
const RANDEVU_GOREV: HubDef = {
  id: "randevu-gorev",
  label: "Randevu ve Görev",
  icon: "randevu",
  pages: [p("/app/randevular"), p("/app/gorevler")],
};

/* ------------------------------- Alt sabit merkezler ------------------------------- */

const AYARLAR: HubDef = {
  id: "ayarlar",
  label: "Ayarlar",
  icon: "ayar",
  pages: [
    p("/app/ayarlar", "Genel"),
    p("/app/ayarlar/roller"),
    p("/app/ayarlar/yetkilendirme"),
    p("/app/ayarlar/moduller"),
    p("/app/ayarlar/ozel-alanlar"),
    p("/app/ayarlar/api-webhook"),
    p("/app/otomasyonlar"),
    p("/app/ayarlar/is-akislari"),
    p("/app/uyum"),
    p("/app/belgeler"),
    p("/app/ayarlar/ai-kullanim"),
    p("/app/ayarlar/sahiplik-devri"),
  ],
};
const ABONELIK: HubDef = { id: "abonelik", label: "Abonelik", icon: "abonelik", pages: [p("/app/abonelik")] };
const YARDIM: HubDef = { id: "yardim", label: "Yardım", icon: "destek", pages: [p("/app/yardim"), p("/app/destek")] };

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
  label: "Havuz ve Atama",
  icon: "ilanHavuzu",
  pages: [p("/app/ilan-havuzu", "Bekleyen ilanlar")],
};
const ILANLAR_YONETIM: HubDef = { ...ILANLAR, pages: ILANLAR.pages.filter((pg) => pg.href !== "/app/ilan-havuzu") };

const MANAGER: RoleNav = {
  hubs: [BUGUN, MUSTERILER, ILANLAR_YONETIM, HAVUZ_ATAMA, SATIS_PARA, EKIBIM, RAPORLAR],
  dock: [AYARLAR, ABONELIK, YARDIM],
  tools: [...TOOLS_COMMON, "/app/buyume"],
  mobile: ["bugun", "musteriler", "new", "ilanlar", "menu"],
};

const ADVISOR: RoleNav = {
  hubs: [BUGUN, MUSTERILER, ILANLAR, SATIS_DANISMAN, BEN],
  dock: [ABONELIK, YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "musteriler", "new", "ilanlar", "ben"],
};

const ACCOUNTING: RoleNav = {
  hubs: [BUGUN, PARA, RAPORLAR, ABONELIK_SATIRI],
  dock: [YARDIM],
  tools: TOOLS_COMMON,
  mobile: ["bugun", "para", "raporlar", "menu"],
};

const CALL_CENTER: RoleNav = {
  hubs: [
    { id: "bugun", label: "Bugün", icon: "baslikBugun", pages: [p("/app", "Ana ekran")] },
    GELEN_KUTUSU,
    { id: "musteriler", label: "Müşteriler", icon: "baslikMusteri", pages: [p("/app/musteriler"), p("/app/talepler")] },
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
    { id: "ilanlar", label: "İlanlar", icon: "baslikPortfoy", pages: [p("/app/portfoyler")] },
    RAPORLAR,
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
export const MANAGEMENT_ROLES: readonly string[] = ["owner", "gm", "branch_manager"];

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
