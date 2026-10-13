/**
 * Ölçüm kapsamı (SAF): hangi yol sayılabilir, sayılan yol hangi şablona indirgenir.
 *
 * S0 dikişi tamam: TEK kaynak `src/lib/seo/scope.ts` (ölçüm bölümü). Bu modül yalnız onu yeniden dışa verir; imzalar
 * aynıdır, çağıranlar (beacon, atıf, PublicMeasure) değişmez. Kural ve test: seo/scope.ts + measure-contract.test.ts.
 */
export { NEVER_MEASURED_PREFIXES, canMeasure, normalizeMeasurePath, pathTemplate } from "@/lib/seo/scope";
