/**
 * Ürün turu durumu (tek kaynak): "gösterildi" işaretleri ve yeniden başlatma bağlantıları.
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

/** Tüm "görüldü" işaretlerini siler; localStorage kapalıysa sessizce geçer (tur yine parametreyle başlar). */
export function clearTourDone(): void {
  try {
    window.localStorage.removeItem(TOUR_STORAGE_KEY);
    window.localStorage.removeItem(TOURS_DONE_KEY);
  } catch {
    /* localStorage yoksa yapılacak bir şey yok */
  }
}
