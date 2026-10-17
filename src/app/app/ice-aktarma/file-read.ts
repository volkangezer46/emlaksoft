import { decodeCsvBuffer, parseCsv, type ParsedCsv } from "./import-config";
import { readXlsxTable } from "@/lib/xlsx-import";
import { isVCardFile, looksLikeVCard, pickedContactsToTable, vcardToTable, type PickedContact } from "@/lib/vcard-import";

/**
 * İçe aktarma dosya okuyucusu — sihirbaz bunu YALNIZ dosya seçilince dinamik yükler (`import("./file-read")`): CSV / rehber
 * (vCard) ayrıştırıcıları ve `.xlsx` okuyucusu sayfanın ilk yük paketine girmez. Davranış eski satır içi akışla aynıdır:
 * Excel → tablo; metin rehber kartıysa vCard tablosu; değilse CSV.
 */
export type FileReadResult =
  | { kind: "table"; table: ParsedCsv }
  | { kind: "vcard"; table: ParsedCsv }
  | { kind: "error"; message: string };

export async function readImportBuffer(buffer: ArrayBuffer, file: { name: string; type?: string; excel: boolean }): Promise<FileReadResult> {
  if (file.excel) return { kind: "table", table: await readXlsxTable(buffer) };
  const text = decodeCsvBuffer(buffer);
  if (isVCardFile(file) || looksLikeVCard(text)) {
    const t = vcardToTable(text);
    if (!t.rows.length) {
      return { kind: "error", message: t.contacts ? "Rehber dosyasındaki kişilerde ad ya da telefon/e-posta bulunamadı." : "Dosyada kişi kartı (BEGIN:VCARD) bulunamadı." };
    }
    return { kind: "vcard", table: { headers: t.headers, rows: t.rows, delimiter: "," } };
  }
  return { kind: "table", table: parseCsv(text) };
}

/** Rehberden seçilen kişiler → tablo (Contact Picker). */
export function pickedToTable(contacts: PickedContact[]): ParsedCsv {
  const table = pickedContactsToTable(contacts);
  return { headers: table.headers, rows: table.rows, delimiter: "," };
}
