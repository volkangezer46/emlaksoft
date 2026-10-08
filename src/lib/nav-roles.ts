import type { AppRole } from "@/lib/permissions";

/**
 * Sade görünümün rol -> ÇEKİRDEK menü eşlemesi (TEK yer). Yalnız GÖRÜNÜRLÜKTÜR:
 * yetki matrisi (`permissions.ts`) değişmez, hiçbir sayfa silinmez; doğrudan adresler
 * ve ⌘K araması tüm yetkili sayfalara ulaşmaya devam eder. Anahtarlar menü öğesinin
 * TANIMLI yoludur (`nav-config.ts` öğe `href`'i; sekmeli öğelerde öğenin kendi yolu).
 * Rolün erişemediği modülün öğesi zaten `visibleSections` içinde elenir.
 */

const HOME = "/app";

/**
 * ANA İLKE (menü bütçesi, 2026-10): yan menüde görünür satır sayısı SINIRLIDIR; kullanım zorluğu yaşatmamak ana ilkedir.
 * Yeni özellik = yeni menü öğesi DEĞİL: önce mevcut sayfaya sekme/kart. Bütçe: danışman <= 8, ofis yönetimi <= 10, admin <= 8
 * (`nav-budget-contract.test.ts`). Çekirdek olmayan öğeler menünün en altındaki kapalı "Diğer" grubundadır.
 */
export const NAV_BUDGET = { advisor: 8, office: 10, admin: 8 } as const;

/** Ofis sahibi / genel müdür / şube müdürü: 10 çekirdek sayfa. Ekip Merkezi, Gelen Kutusu, Ekip karnesi, Ayarlar, Abonelik "Diğer"de / kullanıcı menüsünde / ⌘K'dadır. */
const MANAGER_CORE = [
  HOME,
  "/app/randevular",
  "/app/gorevler",
  "/app/musteriler",
  "/app/talepler",
  "/app/portfoyler",
  "/app/ilan-kontrol",
  "/app/anlasmalar",
  "/app/komisyon",
  "/app/raporlar",
] as const;

/**
 * Danışman (ve takım lideri) konsolu: 8 satır. Günlük döngü = Bugün (Ana ekran, Randevular, Görevler) -> Müşteriler
 * (Müşteriler, Talepler) -> Portföyler -> Anlaşmalar -> Performansım. Gelen Kutusu, Komisyon/Kazanç, İlan Kontrol, Değerleme
 * ve Yardım "Diğer" altında; sık kullanılıyorsa otomatik "Hızlı erişim"e çıkar, ⌘K ve g-kısayolları çalışır.
 * Yalnız görünürlük: yetki matrisi ve sayfa yolları değişmez.
 */
const ADVISOR_CORE = [
  HOME,
  "/app/randevular",
  "/app/gorevler",
  "/app/musteriler",
  "/app/talepler",
  "/app/portfoyler",
  "/app/anlasmalar",
  "/app/performansim",
] as const;

export const NAV_CORE_BY_ROLE: Readonly<Record<AppRole, readonly string[]>> = {
  owner: MANAGER_CORE,
  gm: MANAGER_CORE,
  branch_manager: MANAGER_CORE,
  team_lead: ADVISOR_CORE,
  advisor: ADVISOR_CORE,
  accounting: [HOME, "/app/giderler", "/app/aidat", "/app/komisyon", "/app/abonelik", "/app/raporlar"],
  call_center: [HOME, "/app/gelen-kutusu", "/app/musteriler", "/app/randevular", "/app/gorevler"],
  readonly: [HOME, "/app/musteriler", "/app/talepler", "/app/portfoyler", "/app/randevular", "/app/raporlar"],
};

/** Yönetim rolleri: yönetim sayfaları (Ayarlar, Otomasyon…) yalnız bunlara "Daha fazla"da görünür. */
export const MANAGEMENT_ROLES: readonly string[] = ["owner", "gm", "branch_manager"];

/**
 * `settings` GÖRÜNTÜLEME izni "yönetir" demek değildir (ör. `advisor.settings = VIEW`).
 * Bu sayfalar yönetici olmayan rollerin SADE menüsünden tamamen çıkar (çekirdekte olanlar
 * hariç); tam görünümde ve doğrudan adreste durur.
 */
export const MANAGEMENT_ONLY_HREFS: readonly string[] = [
  "/app/otomasyonlar",
  "/app/uyum",
  "/app/belgeler",
  "/app/denetim",
  "/app/buyume",
  "/app/ayarlar",
  "/app/ekip",
];

function isAppRole(role: string | null | undefined): role is AppRole {
  return typeof role === "string" && Object.hasOwn(NAV_CORE_BY_ROLE, role);
}

/** Bilinmeyen rolde en kısıtlı çekirdek (readonly) kullanılır; yetki zaten ayrıca süzer. */
export function coreHrefsFor(role: string | null | undefined): ReadonlySet<string> {
  return new Set(NAV_CORE_BY_ROLE[isAppRole(role) ? role : "readonly"]);
}

export function isManagementRole(role: string | null | undefined): boolean {
  return typeof role === "string" && MANAGEMENT_ROLES.includes(role);
}

/** Sade görünümde bu rol için hiç gösterilmeyen (ne çekirdek ne "Daha fazla") öğe mi? */
export function isHiddenInSimple(role: string | null | undefined, href: string): boolean {
  if (isManagementRole(role)) return false;
  if (coreHrefsFor(role).has(href)) return false;
  return MANAGEMENT_ONLY_HREFS.includes(href);
}
