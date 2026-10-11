/**
 * Ekstre dosyasını SUNUCUDA ayrıştırır (CSV / Excel .xlsx / OFX) ve karmalar üretir. Ham dosya ve içeriği loglanmaz/saklanmaz;
 * yalnız dosya SHA-256'sı (mükerrer dosya engeli) ve satır karmaları (mükerrer satır engeli) DB'ye gider.
 * İstemci paketine GİRMEZ (xlsx kütüphanesi yalnız burada dinamik yüklenir).
 */
import { createHash } from "node:crypto";
import { decodeCsvBuffer } from "@/app/app/ice-aktarma/import-config";
import { cellToText } from "@/lib/xlsx-import";
import { looksLikeOfx, parseOfx } from "./ofx";
import { csvTextToTable, lineKeys, tableFromRawRows, type MappedStatement, type StatementLine, type StatementTable } from "./parse";

export const MAX_STATEMENT_BYTES = 2 * 1024 * 1024;

/** .xlsx = ZIP: açılmış boyut / girdi sayısı / sıkıştırma oranı sınırları (zip bombası); kütüphane açmadan ÖNCE merkezi dizinden denetlenir. */
export const MAX_XLSX_UNPACKED_BYTES = 20 * 1024 * 1024;
export const MAX_XLSX_ENTRIES = 50;
export const MAX_XLSX_RATIO = 100;

/**
 * ZIP merkezi dizinini (EOCD + merkezi girdiler) okur, hiçbir şeyi AÇMADAN sınırları denetler. Yeni bağımlılık yok.
 * Dönüş: null = güvenli; metin = reddetme nedeni (kullanıcıya gösterilir). ZIP64 / bozuk dizin reddedilir (2 MB'lık ekstre ZIP64 gerektirmez).
 */
export function inspectXlsxZip(bytes: Uint8Array): string | null {
  const bad = "Dosya geçerli bir .xlsx gibi görünmüyor. Bankanızın indirdiği ekstreyi değiştirmeden yükleyin.";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  if (len < 22) return bad;
  // EOCD: sondan geriye (en çok 22 + 65535 yorum baytı).
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return bad;
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return bad; // ZIP64
  if (total > MAX_XLSX_ENTRIES) return "Excel dosyası beklenenden çok iç dosya içeriyor; güvenlik nedeniyle okunmadı.";
  if (total === 0 || cdOffset + cdSize > eocd) return bad;
  let pos = cdOffset;
  let unpacked = 0;
  for (let n = 0; n < total; n += 1) {
    if (pos + 46 > eocd || view.getUint32(pos, true) !== 0x02014b50) return bad;
    const comp = view.getUint32(pos + 20, true);
    const raw = view.getUint32(pos + 24, true);
    const entryLen = 46 + view.getUint16(pos + 28, true) + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
    if (comp === 0xffffffff || raw === 0xffffffff) return bad;
    unpacked += raw;
    if (unpacked > MAX_XLSX_UNPACKED_BYTES) return "Excel dosyası açıldığında çok büyük (en çok 20 MB); güvenlik nedeniyle okunmadı.";
    if (raw > 0 && (comp === 0 || raw / comp > MAX_XLSX_RATIO)) return "Excel dosyasının sıkıştırma oranı olağandışı; güvenlik nedeniyle okunmadı.";
    pos += entryLen;
  }
  return null;
}

export type ParsedStatementFile =
  | { ok: true; format: "ofx"; fileHash: string; statement: MappedStatement }
  | { ok: true; format: "csv" | "xlsx"; fileHash: string; table: StatementTable }
  | { ok: false; error: string };

export const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

function kindOf(name: string): "csv" | "xlsx" | "ofx" | "xls" | null {
  const n = name.toLowerCase();
  if (/\.(csv|txt)$/.test(n)) return "csv";
  if (/\.xlsx$/.test(n)) return "xlsx";
  if (/\.(ofx|qfx)$/.test(n)) return "ofx";
  if (/\.xls$/.test(n)) return "xls";
  return null;
}

export async function parseStatementFile(name: string, bytes: Uint8Array): Promise<ParsedStatementFile> {
  if (bytes.byteLength === 0) return { ok: false, error: "Dosya boş görünüyor." };
  if (bytes.byteLength > MAX_STATEMENT_BYTES) return { ok: false, error: "Dosya en çok 2 MB olabilir. Ekstreyi daha kısa bir tarih aralığıyla indirip tekrar deneyin." };
  const kind = kindOf(name);
  if (kind === "xls") return { ok: false, error: "Eski .xls biçimi desteklenmiyor. Dosyayı Excel'de .xlsx veya .csv olarak kaydedip yükleyin." };
  if (!kind) return { ok: false, error: "Yalnız .csv, .xlsx veya .ofx ekstre dosyası yüklenebilir." };
  const fileHash = sha256Hex(bytes);
  try {
    if (kind === "xlsx") {
      const zipError = inspectXlsxZip(bytes);
      if (zipError) return { ok: false, error: zipError };
      const { readSheet } = await import("read-excel-file/node");
      const data = (await readSheet(Buffer.from(bytes))) as unknown as unknown[][];
      const raw = data.slice(0, 5000).map((r) => r.map(cellToText));
      return { ok: true, format: "xlsx", fileHash, table: tableFromRawRows(raw) };
    }
    const text = decodeCsvBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    if (kind === "ofx" || looksLikeOfx(text)) return { ok: true, format: "ofx", fileHash, statement: parseOfx(text) };
    return { ok: true, format: "csv", fileHash, table: csvTextToTable(text) };
  } catch {
    return { ok: false, error: "Dosya okunamadı. Bankanızın indirdiği ekstre dosyasını değiştirmeden yükleyin." };
  }
}

/** RPC yükü: satır anahtarından SHA-256 karması (aynı içerik + dosyadaki sırası) eklenir. */
export function toStagePayload(lines: readonly StatementLine[]): { d: string; dir: string; amt: number; desc: string; h: string; bal: number | null }[] {
  const keys = lineKeys(lines);
  return lines.map((l, i) => ({ d: l.date, dir: l.dir, amt: l.amount, desc: l.description, h: sha256Hex(keys[i]!), bal: l.balance }));
}
