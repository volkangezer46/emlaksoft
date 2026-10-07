/**
 * İçe aktarma sihirbazının paylaşılan sabitleri + bağımlılıksız CSV parser.
 *
 * NEDEN EL YAZIMI PARSER: papaparse/xlsx gibi bağımlılık eklememek için.
 * Türk ihracat dosyalarının iki gerçeğini kapsar:
 *  - Excel TR yerelinde CSV'yi NOKTALI VİRGÜLLE yazar → ayraç otomatik algılanır.
 *  - Eski Excel'ler Windows-1254 (Türkçe ANSI) kodlar → UTF-8 denenip
 *    bozuk çıkarsa 1254'e düşülür (bkz. decodeCsvBuffer).
 */

export const IMPORT_ROW_LIMIT = 5000;
/** İstemci tarafı dosya boyutu sınırı (bellekte ArrayBuffer olarak okunur). */
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Sunucuya tek istekte gönderilen satır sayısı (parçalı işleme; server action body limiti 4 MB). */
export const IMPORT_CHUNK_SIZE = 250;
export const MAX_ERRORS_SHOWN = 50;
export const PREVIEW_ROWS = 20;

import type { ImportTarget } from "@/lib/import-rows";
export type { ImportTarget };

export type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
  /**
   * Başlık otomatik tahmini için eşanlamlılar (aksan/büyük-küçük harf önemsiz).
   * Tam eşleşme > bütün kelime olarak geçme > (uzun ipuçları için) içerme.
   * Sıra önceliktir: önce gelen ipucu eşitlikte kazanır.
   */
  hints: string[];
  /** Şablon CSV'deki örnek değer. */
  sample: string;
};

export const CUSTOMER_FIELDS: FieldDef[] = [
  { key: "full_name", label: "Ad Soyad", required: true, hints: ["ad soyad", "adi soyadi", "ad soyadi", "isim soyisim", "musteri adi", "musteri", "isim", "adi", "ad", "kisi", "name", "full name"], sample: "Ayşe Yılmaz" },
  { key: "phone", label: "Telefon", hints: ["telefon", "cep telefonu", "cep tel", "cep", "gsm", "mobil", "tel no", "tel", "iletisim", "phone"], sample: "0532 123 45 67" },
  { key: "email", label: "E-posta", hints: ["e posta", "eposta", "e mail", "email", "mail adresi", "mail", "posta"], sample: "ayse@example.com" },
  { key: "customer_type", label: "Müşteri tipi", hints: ["musteri tipi", "musteri turu", "kisi tipi", "tip", "tur", "type"], sample: "Alıcı" },
  { key: "source", label: "Kaynak", hints: ["kaynak", "nereden", "referans", "source"], sample: "Referans" },
  { key: "notes", label: "Notlar", hints: ["notlar", "not", "aciklama", "yorum", "detay", "notes"], sample: "3+1 arıyor" },
];

export const PROPERTY_FIELDS: FieldDef[] = [
  { key: "title", label: "Başlık", required: true, hints: ["ilan basligi", "baslik", "ilan adi", "ilan", "title"], sample: "Kadıköy'de deniz manzaralı 3+1" },
  { key: "transaction_type", label: "İşlem türü", hints: ["islem turu", "islem", "satilik kiralik", "satilik", "kategori"], sample: "Satılık" },
  { key: "property_type", label: "Portföy türü", hints: ["emlak tipi", "emlak turu", "portfoy turu", "portfoy tipi", "konut tipi", "emlak", "cins", "tip", "tur"], sample: "Daire" },
  { key: "list_price", label: "Liste fiyatı", hints: ["liste fiyati", "ilan fiyati", "satis fiyati", "fiyat", "tutar", "bedel", "price"], sample: "4.500.000" },
  { key: "rooms", label: "Oda sayısı", hints: ["oda sayisi", "oda"], sample: "3+1" },
  { key: "sqm", label: "Metrekare", hints: ["brut m2", "net m2", "m2", "metrekare", "alan", "brut", "net"], sample: "125" },
  { key: "address_line", label: "Adres", hints: ["acik adres", "adres", "address", "mahalle"], sample: "Caferağa Mah. Moda Cad. No:12" },
];

export const DEMAND_FIELDS: FieldDef[] = [
  { key: "customer_phone", label: "Müşteri telefonu", hints: ["musteri telefonu", "telefon", "cep telefonu", "cep", "gsm", "tel"], sample: "0532 123 45 67" },
  { key: "customer_email", label: "Müşteri e-postası", hints: ["musteri e postasi", "e posta", "eposta", "email", "mail"], sample: "ayse@example.com" },
  { key: "transaction_type", label: "İşlem türü", hints: ["islem turu", "talep turu", "islem", "satilik kiralik", "satilik"], sample: "Satılık" },
  { key: "property_type", label: "Portföy türü", hints: ["emlak tipi", "emlak turu", "portfoy turu", "aranan tip", "tip", "tur"], sample: "Daire" },
  { key: "budget_min", label: "Min. bütçe", hints: ["min butce", "butce min", "alt butce", "en az butce", "en az"], sample: "3.000.000" },
  { key: "budget_max", label: "Maks. bütçe", hints: ["max butce", "maks butce", "butce max", "ust butce", "en fazla butce", "en fazla", "butce"], sample: "4.500.000" },
  { key: "rooms", label: "Oda sayısı", hints: ["oda sayisi", "oda"], sample: "3+1" },
  { key: "min_sqm", label: "Min. m²", hints: ["min m2", "en az m2", "m2", "metrekare"], sample: "100" },
  { key: "urgency", label: "Aciliyet", hints: ["aciliyet", "oncelik"], sample: "Yüksek" },
];

const CONTACT_FIELDS: FieldDef[] = [
  { key: "customer_phone", label: "Müşteri telefonu", hints: ["musteri telefonu", "telefon", "cep telefonu", "cep", "gsm", "tel"], sample: "0532 123 45 67" },
  { key: "customer_email", label: "Müşteri e-postası", hints: ["musteri e postasi", "e posta", "eposta", "email", "mail"], sample: "ayse@example.com" },
];

export const TASK_FIELDS: FieldDef[] = [
  { key: "title", label: "Görev", required: true, hints: ["gorev", "baslik", "is", "yapilacak", "konu", "title", "task"], sample: "Ayşe Hanım'ı geri ara" },
  { key: "due_at", label: "Son tarih", hints: ["son tarih", "vade", "tarih", "termin", "due"], sample: "15.11.2026 10:00" },
  { key: "kind", label: "Tür", hints: ["gorev turu", "tur", "tip", "kind"], sample: "Arama" },
  { key: "priority", label: "Öncelik", hints: ["oncelik", "aciliyet", "priority"], sample: "Yüksek" },
  { key: "notes", label: "Not", hints: ["notlar", "not", "aciklama", "detay", "notes"], sample: "Teklif sonrası dönüş" },
  ...CONTACT_FIELDS,
];

export const APPOINTMENT_FIELDS: FieldDef[] = [
  { key: "scheduled_at", label: "Tarih ve saat", required: true, hints: ["randevu tarihi", "tarih saat", "tarih", "zaman", "saat", "date"], sample: "15.11.2026 14:30" },
  { key: "appointment_type", label: "Randevu türü", hints: ["randevu turu", "tur", "tip", "type"], sample: "Yer gösterme" },
  { key: "duration_min", label: "Süre (dk)", hints: ["sure", "dakika", "duration"], sample: "45" },
  { key: "location", label: "Konum", hints: ["konum", "adres", "yer", "location"], sample: "Moda Cad. No:12" },
  { key: "notes", label: "Not", hints: ["notlar", "not", "aciklama", "detay", "notes"], sample: "Anahtar kapıcıda" },
  ...CONTACT_FIELDS,
];

export const EXPENSE_FIELDS: FieldDef[] = [
  { key: "title", label: "Gider", required: true, hints: ["gider", "baslik", "aciklama", "kalem", "title"], sample: "Portal ilan paketi" },
  { key: "amount", label: "Tutar", required: true, hints: ["tutar", "bedel", "miktar", "fiyat", "amount"], sample: "2.450" },
  { key: "category", label: "Kategori", hints: ["kategori", "gider turu", "tur", "category"], sample: "Reklam & Pazarlama" },
  { key: "expense_date", label: "Tarih", hints: ["tarih", "gider tarihi", "fatura tarihi", "date"], sample: "01.11.2026" },
  { key: "notes", label: "Not", hints: ["notlar", "not", "detay", "notes"], sample: "Kasım dönemi" },
];

/** Aktif kira: kiralama anlaşması (kazanıldı) + komisyon + kira tek transaction'da kurulur (20261007000710). */
export const RENTAL_FIELDS: FieldDef[] = [
  { key: "property_code", label: "Portföy kodu", required: true, hints: ["portfoy kodu", "ilan kodu", "ilan no", "portfoy no", "kod", "code"], sample: "ES-2611-AB12CD" },
  { key: "renter_name", label: "Kiracı adı", hints: ["kiraci adi", "kiraci ad soyad", "kiraci", "tenant"], sample: "Mehmet Kaya" },
  { key: "renter_phone", label: "Kiracı telefonu", required: true, hints: ["kiraci telefonu", "kiraci tel", "kiraci cep", "kiraci gsm"], sample: "0533 222 33 44" },
  { key: "renter_email", label: "Kiracı e-postası", hints: ["kiraci e posta", "kiraci eposta", "kiraci mail"], sample: "mehmet@example.com" },
  { key: "owner_name", label: "Malik adı", hints: ["malik adi", "ev sahibi adi", "mal sahibi", "malik", "ev sahibi"], sample: "Ayşe Yılmaz" },
  { key: "owner_phone", label: "Malik telefonu", hints: ["malik telefonu", "ev sahibi telefonu", "malik tel", "ev sahibi tel"], sample: "0532 123 45 67" },
  { key: "monthly_rent", label: "Aylık kira", required: true, hints: ["aylik kira", "kira bedeli", "kira tutari", "kira", "rent"], sample: "25.000" },
  { key: "due_day", label: "Vade günü", hints: ["vade gunu", "odeme gunu", "vade", "gun"], sample: "5" },
  { key: "start_date", label: "Başlangıç tarihi", required: true, hints: ["baslangic tarihi", "sozlesme baslangic", "baslangic", "giris tarihi"], sample: "01.09.2026" },
  { key: "end_date", label: "Bitiş tarihi", hints: ["bitis tarihi", "sozlesme bitis", "bitis", "cikis tarihi"], sample: "31.08.2027" },
  { key: "deposit", label: "Depozito", hints: ["depozito", "teminat", "deposit"], sample: "50.000" },
  { key: "commission", label: "Komisyon tutarı", hints: ["komisyon tutari", "komisyon", "hizmet bedeli"], sample: "25.000" },
  { key: "notes", label: "Not", hints: ["notlar", "not", "aciklama", "notes"], sample: "Aidat kiracıda" },
];

export function fieldsFor(target: ImportTarget): FieldDef[] {
  if (target === "rentals") return RENTAL_FIELDS;
  if (target === "customers") return CUSTOMER_FIELDS;
  if (target === "properties") return PROPERTY_FIELDS;
  if (target === "tasks") return TASK_FIELDS;
  if (target === "appointments") return APPOINTMENT_FIELDS;
  if (target === "expenses") return EXPENSE_FIELDS;
  return DEMAND_FIELDS;
}

export const TARGET_LABEL: Record<ImportTarget, string> = {
  customers: "Müşteriler",
  properties: "Portföyler",
  demands: "Talepler",
  tasks: "Görevler",
  appointments: "Randevular",
  expenses: "Giderler",
  rentals: "Kiralama",
};

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
  const text = input.replace(/^﻿/, ""); // BOM temizle
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

/** Başlık/ipucu karşılaştırması için aksan ve noktalama katlama (tr-TR). */
function fold(input: string): string {
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

/** 3 = tam eşleşme, 2 = ipucu başlıkta bütün kelime(ler) olarak geçiyor, 1 = uzun ipucu içeriliyor, 0 = yok. */
function hintScore(header: string, hint: string): number {
  if (!header || !hint) return 0;
  if (header === hint) return 3;
  if (` ${header} `.includes(` ${hint} `)) return 2;
  // "ad" gibi kısa ipuçları "adres"in içinde sayılmasın.
  if (hint.length >= 5 && header.includes(hint)) return 1;
  return 0;
}

/**
 * Başlıklardan hedef alanlara otomatik eşleme tahmini. Tüm (alan, başlık) çiftleri puanlanır;
 * en yüksek puan önce atanır (aynı başlık iki alana, aynı alan iki başlığa gitmez). Eşitlikte
 * ipucu sırası ve alan sırası belirler.
 */
export function guessMapping(headers: string[], fields: FieldDef[]): Record<string, number> {
  const folded = headers.map(fold);
  const candidates: { field: string; col: number; score: number; rank: number; order: number }[] = [];
  fields.forEach((f, order) => {
    folded.forEach((h, col) => {
      let best = 0;
      let rank = 0;
      f.hints.forEach((hint, idx) => {
        const sc = hintScore(h, fold(hint));
        if (sc > best) {
          best = sc;
          rank = idx;
        }
      });
      if (best > 0) candidates.push({ field: f.key, col, score: best, rank, order });
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.rank - b.rank || a.order - b.order || a.col - b.col);
  const mapping: Record<string, number> = {};
  const usedCols = new Set<number>();
  for (const c of candidates) {
    if (c.field in mapping || usedCols.has(c.col)) continue;
    mapping[c.field] = c.col;
    usedCols.add(c.col);
  }
  return mapping;
}

/** Şablon CSV içeriği (UTF-8 BOM'lu, TR başlıklar + 1 örnek satır). */
export function buildTemplateCsv(target: ImportTarget): string {
  const fields = fieldsFor(target);
  const esc = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = fields.map((f) => esc(f.label)).join(";");
  const sample = fields.map((f) => esc(f.sample)).join(";");
  return `﻿${header}\n${sample}\n`;
}
