/**
 * PF-05 — Müteahhit fiyat listesi (CSV / Excel'den yapıştırma) ayrıştırıcısı. SAF, bağımlılıksız (istemci önizleme ve
 * sunucu doğrulaması aynı kural). CSV ayrıştırma içe aktarma sihirbazının parser'ıyla AYNI (ayraç otomatik: , ; sekme).
 *
 * Kolonlar başlıktan tanınır (Türkçe/İngilizce, aksansız): Blok · Kat · Daire no · Oda · Brüt m² · Fiyat.
 * Sayılar Türkçe biçimde okunur ("4.250.000", "4.250.000,00 TL", "95,5 m²"); bozuk değer satır hatası olur.
 */
import { parseCsv } from "@/app/app/ice-aktarma/import-config";
import { parseMoneyInput, parseTrDecimal } from "@/lib/money-input";

export const UNIT_IMPORT_LIMIT = 1000;

export type UnitImportRow = {
  line: number;
  block: string | null;
  floor: number | null;
  unit_no: string;
  rooms: string | null;
  gross_m2: number | null;
  list_price: number | null;
};

export type UnitImportField = "block" | "floor" | "unit_no" | "rooms" | "gross_m2" | "list_price";

export type UnitImportParse = {
  rows: UnitImportRow[];
  errors: Array<{ line: number; message: string }>;
  /** Tanınan kolonlar (önizleme başlığı). */
  columns: UnitImportField[];
  /** Zorunlu kolon (daire no) bulunamadı. */
  missingUnitNo: boolean;
  truncated: boolean;
};

const fold = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/²/g, "2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const HEADER_HINTS: Record<UnitImportField, string[]> = {
  block: ["blok", "block", "bina"],
  floor: ["kat", "floor"],
  unit_no: ["daire no", "daire", "no", "kapi no", "bagimsiz bolum", "bb no", "unit", "unit no"],
  rooms: ["oda", "oda sayisi", "tip", "rooms", "plan"],
  gross_m2: ["brut m2", "brut", "m2", "metrekare", "alan", "brut alan", "gross", "sqm"],
  list_price: ["fiyat", "liste fiyati", "satis fiyati", "price", "tutar", "bedel"],
};

/** Başlık satırından kolon eşlemesi; ilk eşleşen kazanır (daha özgül ipucu önce). */
export function mapUnitImportHeaders(headers: readonly string[]): Partial<Record<UnitImportField, number>> {
  const map: Partial<Record<UnitImportField, number>> = {};
  const folded = headers.map(fold);
  const order: UnitImportField[] = ["unit_no", "list_price", "gross_m2", "rooms", "block", "floor"];
  const taken = new Set<number>();
  for (const field of order) {
    const hints = HEADER_HINTS[field];
    // Önce tam eşleşme, sonra "içerir".
    let idx = folded.findIndex((h, i) => !taken.has(i) && hints.includes(h));
    if (idx < 0) idx = folded.findIndex((h, i) => !taken.has(i) && hints.some((x) => x.length > 2 && h.includes(x)));
    if (idx >= 0) {
      map[field] = idx;
      taken.add(idx);
    }
  }
  return map;
}

export function parseUnitPriceList(text: string): UnitImportParse {
  const input = (text ?? "").replace(/\t/g, ";");
  const { headers, rows } = parseCsv(input);
  const map = mapUnitImportHeaders(headers);
  const columns = (Object.keys(map) as UnitImportField[]).sort();
  if (map.unit_no == null) return { rows: [], errors: [], columns, missingUnitNo: true, truncated: false };

  const out: UnitImportRow[] = [];
  const errors: UnitImportParse["errors"] = [];
  const seen = new Set<string>();
  const cell = (r: string[], f: UnitImportField) => (map[f] != null ? (r[map[f]!] ?? "").trim() : "");

  rows.slice(0, UNIT_IMPORT_LIMIT).forEach((r, i) => {
    const line = i + 2;
    const unitNo = cell(r, "unit_no").slice(0, 20);
    if (!unitNo) {
      errors.push({ line, message: "Daire no boş" });
      return;
    }
    const block = cell(r, "block").replace(/\s*blok$/i, "").slice(0, 40) || null;
    const floorRaw = cell(r, "floor");
    const floorNorm = fold(floorRaw);
    const floor = floorRaw === "" ? null : floorNorm === "zemin" || floorNorm === "giris" ? 0 : Number.parseInt(floorRaw, 10);
    if (floor != null && (!Number.isFinite(floor) || floor < -20 || floor > 300)) {
      errors.push({ line, message: `Kat okunamadı: "${floorRaw.slice(0, 20)}"` });
      return;
    }
    const sqm = parseTrDecimal(cell(r, "gross_m2"), { max: 9_999_999 });
    if (!sqm.ok) {
      errors.push({ line, message: `m² okunamadı: "${cell(r, "gross_m2").slice(0, 20)}"` });
      return;
    }
    const price = parseMoneyInput(cell(r, "list_price"), { max: 999_999_999_999 });
    if (!price.ok) {
      errors.push({ line, message: `Fiyat okunamadı: "${cell(r, "list_price").slice(0, 24)}"` });
      return;
    }
    const key = `${block ?? ""}|${unitNo}`;
    if (seen.has(key)) {
      errors.push({ line, message: `Aynı daire iki kez: ${block ? `${block} Blok ` : ""}${unitNo}` });
      return;
    }
    seen.add(key);
    out.push({
      line,
      block,
      floor,
      unit_no: unitNo,
      rooms: cell(r, "rooms").slice(0, 20) || null,
      gross_m2: sqm.value != null && sqm.value > 0 ? sqm.value : null,
      list_price: price.value,
    });
  });
  return { rows: out, errors, columns, missingUnitNo: false, truncated: rows.length > UNIT_IMPORT_LIMIT };
}

/** Sunucu tarafı ikinci kapı: istemciden gelen satırları tip/uzunluk/aralık bakımından süzer. */
export function sanitizeImportRows(input: unknown): Omit<UnitImportRow, "line">[] {
  if (!Array.isArray(input)) return [];
  const out: Omit<UnitImportRow, "line">[] = [];
  for (const raw of input.slice(0, UNIT_IMPORT_LIMIT)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const unitNo = typeof r.unit_no === "string" ? r.unit_no.trim().slice(0, 20) : "";
    if (!unitNo) continue;
    const n = (v: unknown, min: number, max: number) =>
      typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
    const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const floor = n(r.floor, -20, 300);
    out.push({
      block: s(r.block, 40),
      floor: floor != null ? Math.trunc(floor) : null,
      unit_no: unitNo,
      rooms: s(r.rooms, 20),
      gross_m2: n(r.gross_m2, 0.1, 9_999_999),
      list_price: n(r.list_price, 0, 999_999_999_999),
    });
  }
  return out;
}
