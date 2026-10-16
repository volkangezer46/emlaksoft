// Kullanıcı arayüz tercihi: "Sade görünüm". ÇEREZ tabanlıdır çünkü /app layout'u sunucu bileşenidir:
// menü ilk HTML'de doğru gelir (hidrasyon uyumlu, yanıp sönme yok). Çerez adı ofis+kullanıcı kapsamlıdır;
// aynı tarayıcıda başka kullanıcı/ofis etkilenmez. Çerez yoksa (yeni kullanıcı): sade görünüm AÇIK.
// Yazı boyutu BURADA DEĞİL: bkz. lib/font-scale.ts (Küçük/Normal/Büyük, kullanıcı metadata'sında).

export type UiPrefs = { simple: boolean };

/** Sahip kararı (2026-10-16, üçüncü): varsayılan DENGELİ görünüm (sade bayrağı açık; önemli bilgi görünür, ikincil ayrıntı katlı).
 * "Tüm özellikleri göster" tam görünümü açar. */
export const DEFAULT_UI_PREFS: UiPrefs = { simple: true };

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Çerez adı: yalnız güvenli karakterler (kimlikler uuid); geçersiz kimlikte null (tercih saklanmaz). */
export function uiPrefCookieName(tenantId: string | null | undefined, userId: string | null | undefined): string | null {
  const safe = (x: string | null | undefined) => (x && /^[A-Za-z0-9-]{8,64}$/.test(x) ? x : null);
  const t = safe(tenantId);
  const u = safe(userId);
  return t && u ? `es_ui_${t}_${u}` : null;
}

export function serializeUiPrefs(p: UiPrefs): string {
  return p.simple ? "1" : "0";
}

/** Bozuk/eksik değerde varsayılan. Eski biçim ("1.large") da okunur: yalnız ilk bölüm anlamlıdır. */
export function parseUiPrefs(raw: string | null | undefined): UiPrefs {
  if (!raw) return DEFAULT_UI_PREFS;
  const s = raw.split(".")[0];
  return { simple: s === "0" ? false : s === "1" ? true : DEFAULT_UI_PREFS.simple };
}

/**
 * Küçük ofis kuralı (sadeleştirme planı 2.1): ekibi en çok 5 kişi olan ve şubesi olmayan ofis "küçük ofis"tir.
 * Ofis büyüklüğü bilinmiyorsa (sorgu düştü, kiracı yok) küçük sayılır: sade taraf güvenli varsayılandır.
 */
export const SMALL_OFFICE_MAX_SEATS = 5;
export type OfficeSize = { seats: number; branches: number };
export function isSmallOffice(size: OfficeSize | null | undefined): boolean {
  return !size || (size.seats <= SMALL_OFFICE_MAX_SEATS && size.branches === 0);
}

/**
 * Etkin tercih (TEK tanım; layout ve `getUiPrefs()` aynısını kullanır). Çerez açıkça yazılmışsa ("1"/"0") o geçer:
 * "Tüm özellikleri göster" anahtarı her zaman tek dokunuşla tam görünümü açar. Çerez yoksa herkes (büyük ofisin
 * yönetimi dahil) SADE başlar; takım/şube sayfaları sade menüde "Daha fazla" altında ve büyük ofiste temel sekmededir.
 */
export function resolveUiPrefs(
  raw: string | null | undefined,
  ctx: { management: boolean; smallOffice: boolean },
): UiPrefs {
  const s = raw ? raw.split(".")[0] : "";
  if (s === "1" || s === "0") return { simple: s === "1" };
  // Sahip kararı (2026-10-16, üçüncü): herkes DENGELİ görünümle başlar (tam görünüm çok kalabalık, ilk sade sürüm çok
  // boş bulundu). ctx yalnız geriye uyumluluk ve ileride rol/ofis bazlı ayar için tutulur.
  void ctx;
  return { simple: DEFAULT_UI_PREFS.simple };
}

/** İstemci: çerezdeki güncel tercihi okur (çerez yoksa varsayılan). */
export function readUiPrefsCookie(name: string): UiPrefs {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return parseUiPrefs(match ? match.slice(name.length + 1) : undefined);
}

/** İstemci: çerezi yazar (çağıran ardından router.refresh() ile sunucu çıktısını yeniler). */
export function writeUiPrefsCookie(name: string, p: UiPrefs): void {
  document.cookie = `${name}=${serializeUiPrefs(p)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}
