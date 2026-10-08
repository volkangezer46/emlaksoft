/**
 * Müşteri durumu eşikleri — TEK YER. Sıcaklık/risk/aday/satıcı/anlaşma sınıflandırmasının
 * tüm kesim noktaları burada; ekranlar ve içgörü kuralları sayı kopyalamaz.
 * (Ofis tanımı olan eşikler — uykuda, sessiz değerli, hareketsiz anlaşma — burada VARSAYILAN taşır;
 * ofis değeri çağıran tarafından `opts` ile geçirilir.)
 */

/** Isı skoru (0..100) → segment kesimleri. */
export const HEAT_CUTS = { sicak: 70, ilgili: 40, soguk: 15 } as const;

/** Uykuda: ısı skoru `soguk` kesiminin altında VE en az bu kadar gündür temassız (ofis tanımı: office.insight.dormant_days). */
export const DORMANT_DAYS = 90;

/** Aday (lead) skoru → kademe. Müşteri sıcaklığını BELİRLEMEZ; yalnız değer/öncelik ağırlığıdır (churn girdisi). */
export const LEAD_CUTS = { hot: 65, warm: 35 } as const;

/** Churn riski (0..100) → kademe. */
export const CHURN_CUTS = { high: 60, medium: 32 } as const;

/** Satıcı-tahmini (0..100) → kademe. */
export const SELLER_CUTS = { high: 62, medium: 34 } as const;

/** Anlaşma puanı (0..100) → kademe. */
export const DEAL_CUTS = { high: 65, medium: 35 } as const;

/** "Bugün ara": bu kadar gündür sessiz + en az 1 açık talep (ofis tanımı: office.insight.customer_quiet_days). */
export const CALL_MIN_QUIET_DAYS = 14;
/** Sessizlik bu günü aşarsa (veya 2+ açık talep varsa) arama önceliği "orta". */
export const CALL_ELEVATED_QUIET_DAYS = 30;

/** Hareketsiz anlaşma içgörüsü: bu kadar gündür dokunulmamış (ofis tanımı: office.alert.deal_stale_days). */
export const DEAL_MIN_IDLE_DAYS = 14;
export const DEAL_HIGH_IDLE_DAYS = 45;
