/**
 * `.xlsx` okuyucu (istemci). Kütüphane (`read-excel-file`, MIT, saf JS) YALNIZ çağrıldığında DİNAMİK yüklenir:
 * içe aktarma sihirbazı ve İlan Kontrol envanter ekranı dışında hiçbir paket onu indirmez (sözleşme:
 * `client-bundle-contract.test.ts`). Çıktı CSV ayrıştırıcısıyla AYNI biçimdir: başlık + metin hücreler, böylece
 * kolon eşleme / doğrulama / önizleme hattı değişmez. Eski `.xls` (BIFF) desteklenmez.
 */
export type SheetTable = { headers: string[]; rows: string[][]; delimiter: "," };

export function isXlsxFile(file: { name: string; type?: string }): boolean {
  return /\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

export function isLegacyXls(file: { name: string }): boolean {
  return /\.xls$/i.test(file.name);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Hücre → metin: tarih GG.AA.YYYY[ SS:DD] (sihirbazın TR tarih ayrıştırıcısı), ondalık virgülle, mantıksal Evet/Hayır. */
export function cellToText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    // Excel tarihleri saat dilimsizdir; kütüphane UTC olarak verir → UTC alanlarıyla okunur.
    const day = `${pad(v.getUTCDate())}.${pad(v.getUTCMonth() + 1)}.${v.getUTCFullYear()}`;
    const hasTime = v.getUTCHours() !== 0 || v.getUTCMinutes() !== 0;
    return hasTime ? `${day} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}` : day;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
  }
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  return String(v);
}

/** Saf dönüştürücü (birim testli): satır dizisi → başlık + boş olmayan veri satırları. */
export function sheetToTable(data: readonly (readonly unknown[])[]): SheetTable {
  const rows = data.map((r) => r.map(cellToText)).filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows, delimiter: "," };
}

/** Tablo → RFC-4180 CSV metni (CSV metni bekleyen uçlar için; ör. İlan Kontrol envanteri). */
export function tableToCsvText(t: Pick<SheetTable, "headers" | "rows">): string {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [t.headers, ...t.rows].map((r) => r.map(esc).join(",")).join("\n");
}

/** İlk sayfayı okur (dinamik içe aktarma). Bozuk dosyada fırlatır; çağıran Türkçe hata gösterir. */
export async function readXlsxTable(buffer: ArrayBuffer): Promise<SheetTable> {
  const { readSheet } = await import("read-excel-file/browser");
  const data = await readSheet(buffer);
  return sheetToTable(data as unknown as unknown[][]);
}
