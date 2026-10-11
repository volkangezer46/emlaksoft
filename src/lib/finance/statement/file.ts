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
