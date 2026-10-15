/**
 * Zaman kaydırmalı koşu (SK1/B177): `TEST_TIME_SHIFT_DAYS=<n>` verilirse her test dosyası saati n gün İLERİDE görür.
 * Yalnız `Date` kaydırılır ve GERÇEK saatle akmaya devam eder (`Date.now()` = gerçek an + n gün; argümansız
 * `new Date()` aynı). Sahte zamanlayıcı (vi.useFakeTimers) KULLANILMAZ: onun "shouldAdvanceTime" saati bir gerçek
 * setInterval ile ilerletir, eşzamanlı bekleme döngüsü olan kod sonsuza kilitlenirdi. Testin kendi
 * vi.useFakeTimers/useRealTimers çağrıları bu sınıfın üstüne kurulur ve ona döner.
 * pglite'ın `now()` / `current_date`'i JS `Date.now()`'dan okuduğu için SQL tarafı aynı kaydırmayı görür: tarihe bağlı
 * testlerin (sabit tarih yazılmış veri + `now()`'a göre iş kuralı) belirli bir günde kendiliğinden kırılması gece
 * yakalanır. Gece işi: .github/workflows/nightly.yml (+30, +60, +365). Değişken yoksa hiçbir şey yapmaz.
 */
const days = Number(process.env.TEST_TIME_SHIFT_DAYS ?? "0");
if (Number.isFinite(days) && days !== 0) {
  const offset = days * 86_400_000;
  const RealDate = globalThis.Date;
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...(args as [string | number | Date]));
    }
    static override now(): number {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor;
}
