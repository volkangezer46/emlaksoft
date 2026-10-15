/**
 * Form/menü eylemlerinin ortak dönüşü (SK10 / B166): yetki reddi ve hata istemciye ULAŞIR (yetki reddini sessizce yutan boş `return`
 * kalıbı yasak). `ok: true` başarı; `error` kullanıcıya gösterilecek Türkçe neden. Eski `Promise<void>` eylemlerle
 * geriye uyumludur: sonucu kullanmayan form çağıranı değişmeden çalışır.
 * Kural `scripts/action-gate-audit.ts` (yetki kapısı çağıran dışa açık eylem `Promise<void>` döndüremez) ile kilitli.
 */
export type ActionOutcome = { ok?: boolean; error?: string };

/**
 * Sonuç döndüren eylemi `<form action>` (void bekler) olarak vermek için TİP dönüşümü: aynı fonksiyon referansı döner
 * (sunucu eylemi referansı korunur; sunucu bileşeninde de kullanılabilir). "use server" dosyasında overload bildirimi
 * YASAK (Turbopack: "Server Actions must be async functions") — bu yüzden form kullanımı burada tiplenir.
 */
export function asFormAction<T>(fn: (formData: FormData) => Promise<T>): (formData: FormData) => Promise<void> {
  return fn as unknown as (formData: FormData) => Promise<void>;
}
