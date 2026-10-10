/**
 * Rapor indirme denetim eylem adları — HAFİF modül (içe aktarma yok).
 *
 * `history.ts` (rapor merkezi SAYFASI) yalnız bu adlara ihtiyaç duyar; eskiden bunları `download.ts`'ten alıyordu ve
 * zincir `render.ts → pdf-lib/fontkit (1,1 MB)` ile her rapor sayfasının soğuk paketine giriyordu. Tek doğru kaynak
 * `download.ts`'tir (sözleşme testleri orayı okur); burası aynı değerlerin kopyasıdır ve eşitlik
 * `cold-start-contract.test.ts` ile kilitlidir.
 */
export const REPORT_EXPORT_ACTION_NAME = "export.report";
export const PLATFORM_REPORT_EXPORT_ACTION_NAME = "report.export";
