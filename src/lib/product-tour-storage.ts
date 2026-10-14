/**
 * Ürün turu durumu: "gösterildi" işaretleri ve yeniden başlatma bağlantıları.
 * KALICI kaynak profildir (`profiles.ui_state`, `tour:<id>`; YD5, cihazlar arası): tur açılınca `markUiState` ile yazılır,
 * yeni cihazda otomatik başlatmadan önce `loadUiState` ile sorulur. Buradaki localStorage YALNIZ önbellektir.
 * Tüm localStorage erişimleri try/catch içindedir; depolama kapalıysa sessizce geçilir.
 */

/** ESKİ tek-tur işareti ("1"). Geriye uyumluluk: varsa kullanıcı turları görmüş sayılır (rahatsız edilmez). */
export const TOUR_STORAGE_KEY = "emlaksoft:tour-done";
/** Rol bazlı turlar: `{ [turId]: "ISO tarih" }` JSON. */
export const TOURS_DONE_KEY = "emlaksoft:tours-done";
/** Ana ekrana bu parametreyle gelinirse tur başlar: `1` = rolün turu, aksi halde tur kimliği. */
export const TOUR_PARAM = "tur";
export const TOUR_RESTART_HREF = `/app?${TOUR_PARAM}=1`;

/** Belirli bir turu (veya rol turunu) başlatan adres. */
export function tourHref(id: string): string {
  return `/app?${TOUR_PARAM}=${encodeURIComponent(id)}`;
}

function readMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(TOURS_DONE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Depolama okunamıyorsa `null` (bir kez garantisi verilemez → otomatik başlatma yapılmaz). */
export function isTourDone(id: string): boolean | null {
  try {
    if (window.localStorage.getItem(TOUR_STORAGE_KEY)) return true;
    return id in readMap();
  } catch {
    return null;
  }
}

export function markTourDone(id: string, at: string): void {
  try {
    const map = readMap();
    map[id] = at;
    window.localStorage.setItem(TOURS_DONE_KEY, JSON.stringify(map));
  } catch {
    /* yazılamazsa tur yine bu oturumda çalışır */
  }
}

/** Profile aktarılmış tur işaretleri (`[turId]`): eski cihazlarda yerelde "görüldü" olan tur bir kez sunucuya yazılır. */
export const TOURS_SYNCED_KEY = "emlaksoft:tours-synced";

/** Yerelde görülmüş ama profile henüz aktarılmamış mı? Depolama yoksa false (aktarılacak bir şey yok). */
export function needsServerSync(id: string): boolean {
  try {
    if (isTourDone(id) !== true) return false;
    const raw = window.localStorage.getItem(TOURS_SYNCED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return !(Array.isArray(list) && list.includes(id));
  } catch {
    return false;
  }
}

export function markServerSynced(id: string): void {
  try {
    const raw = window.localStorage.getItem(TOURS_SYNCED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    if (!list.includes(id)) window.localStorage.setItem(TOURS_SYNCED_KEY, JSON.stringify([...list, id].slice(-8)));
  } catch {
    /* yazılamazsa bir sonraki açılışta yeniden denenir */
  }
}

/** Tüm "görüldü" işaretlerini siler; localStorage kapalıysa sessizce geçer (tur yine parametreyle başlar). */
export function clearTourDone(): void {
  try {
    window.localStorage.removeItem(TOUR_STORAGE_KEY);
    window.localStorage.removeItem(TOURS_DONE_KEY);
  } catch {
    /* localStorage yoksa yapılacak bir şey yok */
  }
}
