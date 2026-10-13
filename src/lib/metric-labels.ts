/**
 * Metrik KAPSAM etiketleri — tek kaynak (SAF). Aynı kelime ("aktif portföy") farklı ekranlarda farklı kümeyi sayınca
 * kullanıcı rakamlara güvenmez; bu yüzden her kapsamın tek bir adı vardır ve kartlar bu adları buradan okur.
 * Yalnız ETİKET tanımıdır: hesaplama tanımları kendi modüllerinde kalır, burası onları DEĞİŞTİRMEZ.
 *
 * Kural: "Aktif" kelimesi yalnız `status = live` için kullanılır; o da kullanıcıya "Yayında" diye gösterilir.
 */

export const METRIC_SCOPE = {
  /** `status = live`: vitrinde/portallarda yayında olan portföy. */
  live: { label: "Yayında", detail: "Yayında" },
  /**
   * İlan Kontrol yaşam döngüsünde izlenen portföy (`k_active`, listing-control/lifecycle): hazırlıktaki, havuzdaki,
   * yayındaki ve pazarlıktaki portföyler; satılan, kiralanan ve çıkan (iptal/mükerrer/silinen) SAYILMAZ.
   */
  tracked: { label: "Takipteki", detail: "Takipteki (satılan, kiralanan ve çıkan hariç)" },
  /** Eşleştirme motorunun aday kümesi (yayında, taslak ve opsiyonlu portföyler). */
  matchable: { label: "Eşleştirmeye açık", detail: "Eşleştirmeye açık" },
} as const;

export type MetricScope = keyof typeof METRIC_SCOPE;

export const METRIC_PERIOD = {
  allTime: "tüm zamanlar",
  last12m: "son 12 ay",
} as const;

export type MetricPeriod = keyof typeof METRIC_PERIOD;

/** Kapsam etiketi; `detail` true ise parantezli tanımla ("Takipteki (satılan, kiralanan ve çıkan hariç)"). */
export function scopeLabel(scope: MetricScope, opts: { detail?: boolean; lower?: boolean } = {}): string {
  const s = opts.detail ? METRIC_SCOPE[scope].detail : METRIC_SCOPE[scope].label;
  return opts.lower ? s.toLocaleLowerCase("tr-TR") : s;
}

/** Dönem etiketi ("tüm zamanlar", "son 12 ay"). */
export function periodLabel(period: MetricPeriod): string {
  return METRIC_PERIOD[period];
}
