/**
 * FormActionBar ile useCreateForm arasındaki tek yönlü "kayıttan sonra ne olsun" niyeti.
 * Sunucu action'ı ve doğrulama değişmez: niyet yalnız başarı SONRASI yönlendirmeyi etkiler.
 *  - "new": kayıttan sonra aynı "yeni kayıt" sayfası temiz açılır ("Kaydet ve yenisini ekle").
 *  - null: formun kendi yönlendirmesi (detay/liste).
 */
export type SubmitIntent = "new" | null;

let current: SubmitIntent = null;

export function setSubmitIntent(intent: SubmitIntent): void {
  current = intent;
}

/** Niyeti okur ve sıfırlar (gönderim başına bir kez). */
export function takeSubmitIntent(): SubmitIntent {
  const v = current;
  current = null;
  return v;
}
