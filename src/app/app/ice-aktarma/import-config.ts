/**
 * İçe aktarma sihirbazının paylaşılan sabitleri + bağımlılıksız CSV parser.
 *
 * NEDEN EL YAZIMI PARSER: papaparse/xlsx gibi bağımlılık eklememek için.
 * Türk ihracat dosyalarının iki gerçeğini kapsar:
 *  - Excel TR yerelinde CSV'yi NOKTALI VİRGÜLLE yazar → ayraç otomatik algılanır.
 *  - Eski Excel'ler Windows-1254 (Türkçe ANSI) kodlar → UTF-8 denenip
 *    bozuk çıkarsa 1254'e düşülür (bkz. decodeCsvBuffer).
 */

export const IMPORT_ROW_LIMIT = 1000;
export const MAX_ERRORS_SHOWN = 50;

export type ImportTarget = "customers" | "properties";

export type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
  /** Başlık otomatik tahmini: header (tr-küçük) bu parçalardan birini içeriyorsa eşle. */
  hints: string[];
  /** Şablon CSV'deki örnek değer. */
  sample: string;
};

export const CUSTOMER_FIELDS: FieldDef[] = [
  { key: "full_name", label: "Ad Soyad", required: true, hints: ["ad soyad", "adı", "isim", "ad", "müşteri", "musteri", "name"], sample: "Ayşe Yılmaz" },
  { key: "phone", label: "Telefon", hints: ["telefon", "tel", "gsm", "cep", "phone"], sample: "0532 123 45 67" },
  { key: "email", label: "E-posta", hints: ["e-posta", "eposta", "e-mail", "email", "mail", "posta"], sample: "ayse@example.com" },
  { key: "customer_type", label: "Müşteri tipi", hints: ["tip", "tür", "tur", "type"], sample: "Alıcı" },
  { key: "source", label: "Kaynak", hints: ["kaynak", "source"], sample: "Referans" },
  { key: "notes", label: "Notlar", hints: ["not", "açıklama", "aciklama"], sample: "3+1 arıyor" },
];

export const PROPERTY_FIELDS: FieldDef[] = [
  { key: "title", label: "Başlık", required: true, hints: ["başlık", "baslik", "ilan", "title"], sample: "Kadıköy'de deniz manzaralı 3+1" },
  { key: "transaction_type", label: "İşlem türü", hints: ["işlem", "islem", "satılık/kiralık", "satilik", "kategori"], sample: "Satılık" },
  { key: "property_type", label: "Portföy türü", hints: ["portföy", "portfoy", "emlak", "cins", "tip", "tür", "tur"], sample: "Daire" },
  { key: "list_price", label: "Liste fiyatı", hints: ["fiyat", "price", "tutar", "bedel"], sample: "4.500.000" },
  { key: "rooms", label: "Oda sayısı", hints: ["oda"], sample: "3+1" },
  { key: "sqm", label: "Metrekare", hints: ["m2", "m²", "metrekare", "alan", "brüt", "brut"], sample: "125" },
  { key: "address_line", label: "Adres", hints: ["adres", "address", "mahalle"], sample: "Caferağa Mah. Moda Cad. No:12" },
];

export function fieldsFor(target: ImportTarget): FieldDef[] {
  return target === "customers" ? CUSTOMER_FIELDS : PROPERTY_FIELDS;
}

// ---------------------------------------------------------------------------
// CSV çözümleme
// ---------------------------------------------------------------------------

/**
 * Baytları metne çevirir. Önce katı UTF-8 denenir; geçersiz dizilim varsa
 * (eski Excel Türkçe ANSI çıktısı) Windows-1254 ile yeniden çözülür.
 */
export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder("windows-1254").decode(buffer);
    } catch {
      // Tarayıcı 1254 desteklemiyorsa son çare: toleranslı UTF-8
      return new TextDecoder("utf-8").decode(buffer);
    }
  }
}

/** İlk satırda tırnak DIŞINDA kalan ';' ve ',' sayılarına göre ayraç seçer. */
export function detectDelimiter(text: string): "," | ";" {
  let comma = 0;
  let semi = 0;
  let inQuotes = false;
  for (const ch of text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"))) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ",") comma += 1;
    else if (!inQuotes && ch === ";") semi += 1;
  }
  return semi > comma ? ";" : ",";
}

export type ParsedCsv = { headers: string[]; rows: string[][]; delimiter: "," | ";" };

/**
 * RFC-4180 uyumlu küçük parser: tırnaklı alanlar, tırnak içinde ayraç ve
 * satır sonu, "" kaçışı, CRLF/LF karışımı. İlk satır başlık kabul edilir.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, ""); // BOM temizle
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Tamamen boş satırları atla
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1; // "" kaçışı
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      // CRLF — \n dalında işlenecek; yalnız CR ise satır sonu say
      if (text[i + 1] !== "\n") pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows, delimiter };
}

/** Başlıklardan hedef alanlara otomatik eşleme tahmini (tr-TR küçük harf, ilk isabet kazanır). */
export function guessMapping(headers: string[], fields: FieldDef[]): Record<string, number> {
  const lowered = headers.map((h) => h.toLocaleLowerCase("tr-TR"));
  const mapping: Record<string, number> = {};
  const used = new Set<number>();
  for (const f of fields) {
    for (const hint of f.hints) {
      const idx = lowered.findIndex((h, i) => !used.has(i) && h.includes(hint));
      if (idx !== -1) {
        mapping[f.key] = idx;
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

/** Şablon CSV içeriği (UTF-8 BOM'lu, TR başlıklar + 1 örnek satır). */
export function buildTemplateCsv(target: ImportTarget): string {
  const fields = fieldsFor(target);
  const esc = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = fields.map((f) => esc(f.label)).join(";");
  const sample = fields.map((f) => esc(f.sample)).join(";");
  return `\uFEFF${header}\n${sample}\n`;
}
