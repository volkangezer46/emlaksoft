import { vi } from "vitest";

/**
 * Zaman kaydırmalı koşu (SK1/B177): `TEST_TIME_SHIFT_DAYS=<n>` verilirse her test dosyası saati n gün İLERİDE görür.
 * Yalnız `Date` sahtelenir (setTimeout/setInterval gerçek kalır, saat gerçek zamanla ilerler). pglite'ın `now()` /
 * `current_date`'i de JS `Date.now()`'dan okuduğu için SQL tarafı aynı kaydırmayı görür: tarihe bağlı testlerin
 * (sabit tarih yazılmış veri + `now()`'a göre iş kuralı) belirli bir günde kendiliğinden kırılması gece yakalanır.
 * Gece işi: .github/workflows/nightly.yml (+30, +60, +365). Değişken yoksa hiçbir şey yapmaz.
 */
const days = Number(process.env.TEST_TIME_SHIFT_DAYS ?? "0");
if (Number.isFinite(days) && days !== 0) {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + days * 86_400_000, shouldAdvanceTime: true });
}
