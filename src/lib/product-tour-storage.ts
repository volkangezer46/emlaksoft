/** Ürün turu: "gösterildi" işareti ve yeniden başlatma bağlantısı (tek kaynak). */
export const TOUR_STORAGE_KEY = "emlaksoft:tour-done";
/** Ana ekrana bu parametreyle gelinirse tur, daha önce görülmüş olsa bile yeniden başlar. */
export const TOUR_PARAM = "tur";
export const TOUR_RESTART_HREF = `/app?${TOUR_PARAM}=1`;

/** "Görüldü" işaretini siler; localStorage kapalıysa sessizce geçer (tur yine parametreyle başlar). */
export function clearTourDone(): void {
  try {
    window.localStorage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    /* localStorage yoksa yapılacak bir şey yok */
  }
}
