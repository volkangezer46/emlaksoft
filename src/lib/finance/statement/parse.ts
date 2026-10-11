/**
 * Banka ekstresi ayrıştırıcısı (SAF; ağ/DB/saat yok). Türk bankalarının CSV/Excel dışa aktarımlarında yaygın düzenler:
 *  - başlık öncesi hesap bilgisi satırları ("Hesap No: ...", "Dönem: ..."),
 *  - tarih GG.AA.YYYY (bazen saatli), tutar "1.234,56" (TR) veya "1234.56",
 *  - tek imzalı tutar sütunu (eksi = çıkış) YA DA ayrı Borç / Alacak sütunları,
 *  - isteğe bağlı bakiye sütunu.
 * Çıktı `StatementLine` listesidir; DB'ye gitmeden önce sunucuda karma (satır anahtarı) eklenir (bkz. server dosyası).
 */
import { parseCsv } from "@/app/app/ice-aktarma/import-config";

export type StatementLine = {
  /** YYYY-MM-DD */
  date: string;
  dir: "in" | "out";
  /** Pozitif, kuruş hassasiyetinde. */
  amount: number;
  description: string;
  balance: number | null;
  /** Bankanın kendi işlem numarası (OFX FITID); varsa karmaya girer. */
  ref?: string;
};

/** Sütun indeksleri (0 tabanlı). `amount` YA DA `debit`/`credit` verilir. */
export type ColumnMapping = {
  date: number;
  description: number;
  amount?: number;
  debit?: number;
  credit?: number;
  balance?: number;
};

export const MAX_STATEMENT_ROWS = 1000;

/** Başlık/ipucu karşılaştırması için aksan ve noktalama katlama (tr-TR). */
export function foldHeader(input: string): string {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Sayı ve tarih
// ---------------------------------------------------------------------------

/**
 * Banka tutarı -> sayı (kuruşa yuvarlı) ya da null. Desteklenen: "1.234,56", "-1.234,56", "+500,00", "(250,00)" (eksi),
 * "1234.56", "1,234.56", "1.234,56 TL", "500 ₺". Tek virgül her zaman ondalıktır; tek nokta üç haneli gruplarsa binliktir.
 */
export function parseStatementNumber(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/\s+/g, "").replace(/(?:TRY|TL|₺|USD|EUR|\$|€)/gi, "");
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = s.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    normalized = s.replace(",", ".");
  } else if (lastDot >= 0) {
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1) {
      if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return null;
      normalized = s.split(".").join("");
    } else {
      normalized = /^\d{1,3}\.\d{3}$/.test(s) && !/^0\./.test(s) ? s.replace(".", "") : s;
    }
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100) / 100;
  return negative ? -cents : cents;
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1]!;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** GG.AA.YYYY, GG/AA/YYYY, GG-AA-YYYY, YYYY-AA-GG, YYYYAAGG[SSDDss] (saat atılır) -> "YYYY-MM-DD" ya da null. */
export function parseStatementDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:\D.*)?$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isRealDate(y, Number(m[2]), Number(m[1])) ? `${y}-${p2(Number(m[2]))}-${p2(Number(m[1]))}` : null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\D.*)?$/.exec(s);
  if (m) return isRealDate(Number(m[1]), Number(m[2]), Number(m[3])) ? `${m[1]}-${p2(Number(m[2]))}-${p2(Number(m[3]))}` : null;
  m = /^(\d{4})(\d{2})(\d{2})(?:\d{0,6})(?:\[.*\])?$/.exec(s);
  if (m) return isRealDate(Number(m[1]), Number(m[2]), Number(m[3])) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  return null;
}

/** Açıklama: kontrol karakterleri atılır, boşluklar sadeleşir, en çok 300 karakter. */
export function cleanDescription(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

// ---------------------------------------------------------------------------
// Tablo: başlık satırını bul + sütun eşleme tahmini
// ---------------------------------------------------------------------------

export type StatementTable = { headers: string[]; rows: string[][] };

const HEADER_HINTS = {
  date: ["islem tarihi", "tarih", "hareket tarihi", "islem tarih", "muhasebe tarihi", "date", "valor", "valor tarihi"],
  amount: ["islem tutari", "tutar", "tutar tl", "islem tutari tl", "miktar", "amount"],
  debit: ["borc", "borc tutari", "cikis", "gider", "debit"],
  credit: ["alacak", "alacak tutari", "giris", "gelir", "credit"],
  balance: ["bakiye", "son bakiye", "kalan bakiye", "bakiye tl", "balance"],
  description: ["aciklama", "islem aciklamasi", "hareket aciklamasi", "aciklama bilgisi", "aciklama 1", "description", "detay", "islem adi", "islem"],
} as const;

function hintScore(header: string, hint: string): number {
  if (!header) return 0;
  if (header === hint) return 4;
  if (` ${header} `.includes(` ${hint} `)) return 2;
  return 0;
}

function columnFor(headers: readonly string[], hints: readonly string[], used: Set<number>): number | undefined {
  let best: { col: number; score: number; rank: number } | null = null;
  headers.forEach((h, col) => {
    if (used.has(col)) return;
    hints.forEach((hint, rank) => {
      const score = hintScore(h, hint);
      if (score === 0) return;
      if (!best || score > best.score || (score === best.score && rank < best.rank)) best = { col, score, rank };
    });
  });
  return best ? (best as { col: number }).col : undefined;
}

/** Başlıklardan sütun eşleme tahmini. Tarih + (tutar | borç/alacak) bulunamazsa null (kullanıcı elle seçer). */
export function guessColumnMapping(headers: readonly string[]): Partial<ColumnMapping> {
  const folded = headers.map(foldHeader);
  const used = new Set<number>();
  const take = (hints: readonly string[]) => {
    const col = columnFor(folded, hints, used);
    if (col !== undefined) used.add(col);
    return col;
  };
  const out: Partial<ColumnMapping> = {};
  const date = take(HEADER_HINTS.date);
  if (date !== undefined) out.date = date;
  const debit = take(HEADER_HINTS.debit);
  const credit = take(HEADER_HINTS.credit);
  if (debit !== undefined && credit !== undefined) {
    out.debit = debit;
    out.credit = credit;
  } else {
    // Tek tarafı bulunan borç/alacak sütunu tutar sayılmaz; serbest bırak.
    if (debit !== undefined) used.delete(debit);
    if (credit !== undefined) used.delete(credit);
    const amount = take(HEADER_HINTS.amount);
    if (amount !== undefined) out.amount = amount;
  }
  const balance = take(HEADER_HINTS.balance);
  if (balance !== undefined) out.balance = balance;
  const description = take(HEADER_HINTS.description);
  if (description !== undefined) out.description = description;
  return out;
}

/** Eşleme geçerli ve eksiksiz mi (tarih + açıklama + tutar ya da borç+alacak)? */
export function isCompleteMapping(m: Partial<ColumnMapping> | null | undefined): m is ColumnMapping {
  if (!m) return false;
  return m.date !== undefined && m.description !== undefined && (m.amount !== undefined || (m.debit !== undefined && m.credit !== undefined));
}

/** Eşleme sütun indeksleri tablo genişliğine sığıyor mu (başka bankadan hatırlanan eşleme için güvenlik)? */
export function mappingFits(m: ColumnMapping, width: number): boolean {
  return [m.date, m.description, m.amount, m.debit, m.credit, m.balance].every((c) => c === undefined || (Number.isInteger(c) && c >= 0 && c < width));
}

/**
 * Ham satırlar (ilk satır dahil) içinde başlık satırını bulur: ilk 40 satırda "tarih" benzeri bir başlık +
 * tutar/borç/alacak/açıklama başlıklarından en az biri olan ilk satır. Bulunamazsa 0.
 */
export function findHeaderRow(rows: readonly (readonly string[])[]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    if (isHeaderish(rows[i]!) && rows[i]!.filter((c) => c.trim() !== "").length >= 3) return i;
  }
  return 0;
}

/** Başlık öncesi hesap bilgisi satırlarını metinden atar (parseCsv ayracı ilk satırdan sezdiği için). */
export function stripCsvPreamble(text: string): string {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const cells = lines[i]!.split(/[;,\t]/);
    if (cells.length >= 3 && isHeaderish(cells)) return lines.slice(i).join("\n");
  }
  return text;
}

function isHeaderish(cells: readonly string[]): boolean {
  const folded = cells.map((c) => foldHeader(c.replace(/^"|"$/g, "")));
  const hasDate = folded.some((h) => HEADER_HINTS.date.some((hint) => hintScore(h, hint) > 0));
  const others = [...HEADER_HINTS.amount, ...HEADER_HINTS.debit, ...HEADER_HINTS.credit, ...HEADER_HINTS.description];
  return hasDate && folded.some((h) => others.some((hint) => hintScore(h, hint) > 0));
}

/** CSV metni -> tablo (başlık öncesi satırlar atılır). */
export function csvTextToTable(text: string): StatementTable {
  const parsed = parseCsv(stripCsvPreamble(text));
  return { headers: parsed.headers, rows: parsed.rows };
}

/** Başlığı ve verisi ayrı gelen ham tabloda (Excel) başlık öncesi satırları atar. */
export function tableFromRawRows(raw: readonly (readonly string[])[]): StatementTable {
  const rows = raw.filter((r) => r.some((c) => c.trim() !== ""));
  const at = findHeaderRow(rows);
  const headers = (rows[at] ?? []).map((h) => h.trim());
  return { headers, rows: rows.slice(at + 1).map((r) => [...r]) };
}

// ---------------------------------------------------------------------------
// Eşlemeyi uygula
// ---------------------------------------------------------------------------

export type MappedStatement = {
  lines: StatementLine[];
  /** Satır sayıları: toplam okunan, geçersiz (tarih/tutar okunamadı) ve boş tutarlı atlananlar. */
  invalid: number;
  truncated: boolean;
};

export function applyColumnMapping(table: StatementTable, mapping: ColumnMapping): MappedStatement {
  const lines: StatementLine[] = [];
  let invalid = 0;
  let truncated = false;
  for (const row of table.rows) {
    if (row.every((c) => c.trim() === "")) continue;
    const date = parseStatementDate(row[mapping.date] ?? "");
    let signed: number | null = null;
    if (mapping.amount !== undefined) {
      signed = parseStatementNumber(row[mapping.amount] ?? "");
    } else {
      const debit = parseStatementNumber(row[mapping.debit!] ?? "");
      const credit = parseStatementNumber(row[mapping.credit!] ?? "");
      if (credit !== null && credit !== 0) signed = Math.abs(credit);
      else if (debit !== null && debit !== 0) signed = -Math.abs(debit);
      else if (debit === 0 || credit === 0) signed = 0;
    }
    if (!date || signed === null) {
      // Toplam/özet satırları ("Toplam", tarihsiz) sessizce sayılır; yine de geçersiz say.
      invalid += 1;
      continue;
    }
    if (signed === 0) continue;
    if (lines.length >= MAX_STATEMENT_ROWS) {
      truncated = true;
      break;
    }
    const balance = mapping.balance !== undefined ? parseStatementNumber(row[mapping.balance] ?? "") : null;
    lines.push({
      date,
      dir: signed > 0 ? "in" : "out",
      amount: Math.abs(signed),
      description: cleanDescription(row[mapping.description] ?? ""),
      balance,
    });
  }
  return { lines, invalid, truncated };
}

// ---------------------------------------------------------------------------
// Satır anahtarı (idempotans): aynı içerikli satırlar dosya içinde sırayla numaralanır
// ---------------------------------------------------------------------------

export function lineContentKey(l: StatementLine): string {
  const desc = foldHeader(l.description);
  return [l.date, l.dir, Math.round(l.amount * 100), desc, l.balance === null ? "" : Math.round(l.balance * 100), l.ref ?? ""].join("|");
}

/** Her satır için `anahtar#n` (n = aynı anahtarın dosyadaki sırası). Karma bu dizgeden sunucuda üretilir. */
export function lineKeys(lines: readonly StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const k = lineContentKey(l);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return `${k}#${n}`;
  });
}
