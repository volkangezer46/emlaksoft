/**
 * Form/menü eylemlerinin ortak dönüşü (SK10 / B166): yetki reddi ve hata istemciye ULAŞIR (yetki reddini sessizce yutan boş `return`
 * kalıbı yasak). `ok: true` başarı; `error` kullanıcıya gösterilecek Türkçe neden. Eski `Promise<void>` eylemlerle
 * geriye uyumludur: sonucu kullanmayan form çağıranı değişmeden çalışır.
 * Kural `scripts/action-gate-audit.ts` (yetki kapısı çağıran dışa açık eylem `Promise<void>` döndüremez) ile kilitli.
 */
export type ActionOutcome = { ok?: boolean; error?: string };
