import { financePath } from "@/lib/finance/routes";

/**
 * İçe aktarma GİRİŞİ (SAF; istemci ve sunucu import eder). Sadeleştirme planı C28:
 *  - Ekranın üstünde "Ne taşıyorsunuz?" diye üç büyük hedef kartı (Müşteriler, Portföyler, Talepler); diğer türler
 *    (görev, randevu, gider, kira) "Diğer türler" altında katlıdır.
 *  - Hedef adresle seçilebilir (`?hedef=`): Kurulum sihirbazı ve listeler doğrudan doğru karta açar.
 *  - "Geri" kullanıcının GELDİĞİ yere döner: önce `?geri=` (yalnız uygulama içi yol), yoksa aynı sitedeki önceki sayfa
 *    (Referer), o da yoksa seçili hedefin listesi.
 */

export const IMPORT_PATH = "/app/ice-aktarma";

/** Üstte büyük kart olarak gösterilen hedefler (sıra = ekrandaki sıra). */
export const PRIMARY_IMPORT_TARGETS = ["customers", "properties", "demands"] as const;
export type ImportStartTarget = (typeof PRIMARY_IMPORT_TARGETS)[number];

/** Adresteki hedef anahtarı: Türkçe (kullanıcıya görünen) ve iç ad ikisi de kabul edilir. */
const TARGET_ALIASES: Readonly<Record<string, string>> = {
  musteri: "customers",
  musteriler: "customers",
  portfoy: "properties",
  portfoyler: "properties",
  talep: "demands",
  talepler: "demands",
  gorevler: "tasks",
  randevular: "appointments",
  giderler: "expenses",
  kira: "rentals",
};

/** `?hedef=` değerini bilinen hedef anahtarına çevirir; bilinmeyen değer null (varsayılan hedef kalır). */
export function parseImportTarget<T extends string>(raw: string | null | undefined, known: readonly T[]): T | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return null;
  const key = TARGET_ALIASES[v] ?? v;
  return (known as readonly string[]).includes(key) ? (key as T) : null;
}

/** Hedefin liste sayfası ("Geri"nin son yedeği). */
export const IMPORT_TARGET_LIST: Readonly<Record<string, string>> = {
  customers: "/app/musteriler",
  properties: "/app/portfoyler",
  demands: "/app/talepler",
  tasks: "/app/gorevler",
  appointments: "/app/randevular",
  expenses: financePath(),
  rentals: "/app/kiralama",
};

/**
 * Güvenli uygulama içi dönüş yolu: yalnız `/app` altı, şemasız, `//` ile başlamayan, ters bölü ve kontrol karakteri
 * içermeyen yol. İçe aktarmanın kendisine dönmez (döngü). Uygun değilse null.
 */
export function safeAppReturnPath(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!v || v.length > 300) return null;
  if (!(v === "/app" || v.startsWith("/app/") || v.startsWith("/app?"))) return null;
  if (v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f\u007f]/.test(v)) return null;
  if (v === IMPORT_PATH || v.startsWith(`${IMPORT_PATH}?`) || v.startsWith(`${IMPORT_PATH}/`)) return null;
  return v;
}

/** Referer başlığından aynı sitedeki uygulama yolu (başka alan adı ya da çözülemeyen değer null). */
export function returnPathFromReferer(referer: string | null | undefined, host: string | null | undefined): string | null {
  if (!referer || !host) return null;
  try {
    const u = new URL(referer);
    if (u.host !== host) return null;
    return safeAppReturnPath(`${u.pathname}${u.search}`);
  } catch {
    return null;
  }
}

/** "Geri" bağlantısının hedefi: `?geri=` > Referer > seçili hedefin listesi > Müşteriler. */
export function resolveImportBack(input: { geri?: string | null; referer?: string | null; host?: string | null; target?: string | null }): string {
  return (
    safeAppReturnPath(input.geri) ??
    returnPathFromReferer(input.referer, input.host) ??
    (input.target ? IMPORT_TARGET_LIST[input.target] : undefined) ??
    IMPORT_TARGET_LIST.customers
  );
}

/** "Geri" bağlantısının etiketi: dönülen yerin adı (bilinmiyorsa yalnız "Geri"). */
export function importBackLabel(path: string): string {
  const p = path.split("?")[0];
  if (p === "/app/baslangic") return "Kuruluma dön";
  const entry = Object.entries(IMPORT_TARGET_LIST).find(([, href]) => href === p);
  const names: Record<string, string> = {
    customers: "Müşterilere dön",
    properties: "Portföylere dön",
    demands: "Taleplere dön",
    tasks: "Görevlere dön",
    appointments: "Randevulara dön",
    expenses: "Finansa dön",
    rentals: "Kiralamaya dön",
  };
  return entry ? names[entry[0]] : "Geri";
}

/** İçe aktarmayı belli bir hedefle (ve isteğe bağlı dönüş yoluyla) açan adres. */
export function importHref(target: string, back?: string): string {
  const q = new URLSearchParams({ hedef: target });
  const safe = safeAppReturnPath(back);
  if (safe) q.set("geri", safe);
  return `${IMPORT_PATH}?${q.toString()}`;
}
