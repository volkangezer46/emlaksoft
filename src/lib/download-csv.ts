/**
 * Tarayıcıda CSV indirme (UTF-8 BOM: Excel Türkçe karakterleri doğru açar).
 * Yalnız istemci bileşenlerinden çağrılır; CSV içeriği sunucu action'ında ya da
 * `export-entities.csvLine` ile kaçışlı üretilmiş olmalıdır.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
