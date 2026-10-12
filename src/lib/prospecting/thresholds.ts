/** Sahibinden ilanlar: tüm eşikler tek yerde (SAF). Değiştirmek için yalnız burası. */

/** Takip ritmi: ilk görülmeden itibaren gün ofsetleri (0. gün = kayıt günü). Sonra ayda bir. */
export const CADENCE_DAYS = [0, 3, 7, 14, 21, 30] as const;
export const CADENCE_REPEAT_DAYS = 30;
/** Bu kadar ulaşılamadı denemesinden sonra "Kayıp: ulaşılamadı" önerilir. */
export const MAX_FAILED_ATTEMPTS = 6;
/** Fiyat düşüşü sayılması için asgari yüzde. */
export const PRICE_DROP_MIN_PCT = 1;
/** Kayıttan beri aranmadı kartı için asgari gün; yüksek önem eşiği. */
export const UNCALLED_MIN_DAYS = 1;
export const UNCALLED_HIGH_DAYS = 3;
/** Yaşlanan ilan: gün eşiği ve son temastan beri asgari gün. */
export const AGING_DAYS = 45;
export const AGING_NO_CONTACT_DAYS = 14;
/** Fiyat düşüşü içgörüsünün bakış penceresi (gün). */
export const PRICE_DROP_WINDOW_DAYS = 7;
/** Sahiplik: hareketsizlikte düşme süresi ve yönetici uyarısı penceresi. */
export const CLAIM_IDLE_DAYS = 14;
export const CLAIM_WARN_DAYS = 2;
/** Kişisel veri saklama: varsayılan ve ofis ayarı sınırları (gün). */
export const RETENTION_DEFAULT_DAYS = 90;
export const RETENTION_MIN_DAYS = 30;
export const RETENTION_MAX_DAYS = 180;
/** Tekrar ilan (benzerlik) önerisi için asgari skor. */
export const RELIST_MIN_SCORE = 75;
