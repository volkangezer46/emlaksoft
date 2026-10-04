import { foldTr } from "@/lib/tr-text";

/**
 * Doğal dilli arama ayrıştırıcısı (F2) — KURAL TABANLI, saf fonksiyon.
 *
 * "Onikişubat 3+1 satılık 2 milyon altı" gibi bir cümleyi yapılandırılmış filtreye çevirir.
 * Yapay zekâ / OpenAI KULLANILMAZ (kişisel veri riski, maliyet); her çıkarım bir kurala dayanır ve
 * kullanıcıya çıplak olarak gösterilir. Anlaşılmayan sözcük uydurulmaz, "anlaşılamayan" listesine düşer.
 *
 * Konum eşleme için il/ilçe/mahalle listeleri DIŞARIDAN verilir (geo_* tabloları); bu dosya veritabanına
 * dokunmaz, bu yüzden birim testle doğrulanabilir.
 */

export type NlTarget = "portfoy" | "talep" | "musteri";

/** Kullanıcının kaldırabildiği filtre grupları (chip başına bir grup). */
export type NlGroup = "islem" | "kategori" | "oda" | "fiyat" | "m2" | "kat" | "il" | "ilce" | "mahalle";

/** Filtre kontratı parametre adları (portföy listesi ?islem= ?oda= ... ile aynı). */
export type NlParam =
  | "islem"
  | "kategori"
  | "oda"
  | "fiyat_min"
  | "fiyat_max"
  | "m2_min"
  | "m2_max"
  | "kat_min"
  | "kat_max"
  | "il"
  | "ilce"
  | "mahalle";

export type GeoItem = { id: string; name: string; parentId?: string | null };

export type NlGeo = {
  provinces: GeoItem[];
  districts: GeoItem[];
  /** Yalnız bulunan ilçenin mahalleleri (ikinci geçiş). */
  neighborhoods?: GeoItem[];
};

export type NlChip = {
  group: NlGroup;
  label: string;
  /** Bu chip'in URL'e yazdığı parametreler. */
  params: Partial<Record<NlParam, string>>;
  /** Kural kesin değil, makul varsayım (kullanıcıya "varsayım" diye gösterilir). */
  assumed?: boolean;
};

export type NlParseResult = {
  target: NlTarget;
  filters: Partial<Record<NlParam, string>>;
  chips: NlChip[];
  /** Kullanıcının kaldırdığı (haric) gruplar — geri alınabilsin diye ayrıca döner. */
  excluded: NlChip[];
  /** Hiçbir kurala uymayan sözcükler (uydurma yok). */
  unknown: string[];
  /** Çelişki / belirsizlik uyarıları. */
  notes: string[];
  /** Çözümlenen il (doğrudan veya ilçeden türetilmiş); talep listesi gibi yalnız il bilen hedefler için. */
  provinceId: string | null;
};

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const MARK = "\u0001";

function blank(s: string, start: number, end: number): string {
  return s.slice(0, start) + MARK.repeat(end - start) + s.slice(end);
}

/** Levenshtein uzaklığı (küçük dizgeler için). */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Yazım toleransı: kısa sözcükte tolerans yok (yanlış eşleşme riski). */
function tolerance(len: number): number {
  if (len >= 9) return 2;
  if (len >= 5) return 1;
  return 0;
}

const NUMBER = String.raw`(?:\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)`;

function toNumber(raw: string): number {
  // "1.500.000" -> binlik noktalı; "2,5" / "2.5" -> ondalık.
  if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ""));
  return Number(raw.replace(",", "."));
}

const MONEY_UNIT = String.raw`(?:milyar|milyon|mio|mn)(?:a|u|un|luk|dan|da|e)?|bin(?:e|i|lik|den|de)?|k`;
const MONEY_MULT: Record<string, number> = { milyar: 1e9, milyon: 1e6, mio: 1e6, mn: 1e6, bin: 1e3, k: 1e3 };

function unitMultiplier(unit: string | undefined): number {
  if (!unit) return 1;
  for (const key of ["milyar", "milyon", "mio", "mn", "bin", "k"]) {
    if (unit.startsWith(key)) return MONEY_MULT[key];
  }
  return 1;
}

type Direction = "min" | "max" | "about" | "between" | null;

const AFTER_DIR =
  /^\s*(?:ve\s+)?(alti|altinda|altina|asagisi|kadar|az|ustu|ustunde|ustune|uzeri|uzerinde|yukarisi|fazla|arasi|arasinda|civari|civarinda|yaklasik)\b/;
const BEFORE_DIR = /(?<![a-z])(en\s+az|en\s+fazla|en\s+cok|minimum|maksimum|asgari|azami|min|max|yaklasik|civari)\s*$/;

/** Bulunan sayının önündeki/ardındaki yön sözcüğünü bulur ve ilgili aralığı siler. */
function readDirection(t: string, start: number, end: number): { dir: Direction; text: string } {
  let text = t;
  const before = BEFORE_DIR.exec(t.slice(0, start));
  if (before) {
    const word = before[1].replace(/\s+/g, " ");
    const bStart = start - before[0].length;
    const pre = t.slice(bStart, start).replace(/\s+$/, "");
    text = blank(text, bStart, bStart + pre.length);
    let dir: Direction = null;
    if (word === "en az" || word === "minimum" || word === "asgari" || word === "min") dir = "min";
    else if (word === "yaklasik" || word === "civari") dir = "about";
    else dir = "max";
    // "en az 3 milyon altı" gibi çelişkide ardıl sözcük de silinsin ama yön "önceki" kalır.
    const afterToo = AFTER_DIR.exec(t.slice(end));
    if (afterToo && /^(arasi|arasinda)$/.test(afterToo[1])) {
      text = blank(text, end, end + afterToo[0].length);
    }
    return { dir, text };
  }
  const after = AFTER_DIR.exec(t.slice(end));
  if (after) {
    const w = after[1];
    text = blank(text, end, end + after[0].length);
    if (/^(alti|altinda|altina|asagisi|kadar|az)$/.test(w)) return { dir: "max", text };
    if (/^(ustu|ustunde|ustune|uzeri|uzerinde|yukarisi|fazla)$/.test(w)) return { dir: "min", text };
    if (/^(civari|civarinda|yaklasik)$/.test(w)) return { dir: "about", text };
    return { dir: "between", text };
  }
  return { dir: null, text };
}

// ---------------------------------------------------------------------------
// Sözlükler
// ---------------------------------------------------------------------------

const TRANSACTION_WORDS: Record<string, "Satılık" | "Kiralık"> = {
  satilik: "Satılık",
  satis: "Satılık",
  kiralik: "Kiralık",
  kira: "Kiralık",
  kirada: "Kiralık",
};

/** (kök, değer) — kök yazım toleransıyla ve çoğul/iyelik ekiyle eşlenir. */
const TYPE_STEMS: Array<[string, string]> = [
  ["daire", "Daire"],
  ["villa", "Villa"],
  ["arsa", "Arsa"],
  ["arazi", "Arsa"],
  ["isyeri", "İşyeri"],
  ["dukkan", "Dükkan"],
  ["ofis", "Ofis"],
  ["buro", "Ofis"],
  ["depo", "Depo"],
  ["bina", "Bina"],
];

const TYPE_SUFFIXES = new Set(["ler", "lar", "si", "i", "e", "a", "de", "da", "lik", "leri", "lari", "ye", "ya", "yi"]);

const TARGET_TALEP = new Set(["talep", "talepler", "talepleri", "arayan", "arayanlar", "alici", "alicilar"]);
const TARGET_MUSTERI = new Set(["musteri", "musteriler", "musterileri", "kisi", "kisiler"]);

/** Anlam taşımayan ama "anlaşılamadı" sayılmaması gereken sözcükler. */
const NOISE = new Set([
  "ilan", "ilanlar", "ilanlari", "portfoy", "portfoyler", "emlak", "bul", "goster", "getir", "ara", "listele",
  "olan", "olsun", "icin", "bir", "ve", "ile", "de", "da", "mah", "mh", "mahalle", "mahallesi", "ilce", "ilcesi",
  "il", "sehir", "sehri", "fiyat", "fiyati", "fiyatli", "butce", "butcesi", "butceli", "tl", "lira", "try", "yakin",
  "bolge", "bolgesi", "bolgesinde", "civarinda", "civari", "icinde", "evler", "ev", "lik", "luk", "ya", "veya",
  "bana", "ben", "istiyorum", "lazim", "var", "mi", "mu", "ne", "kadar", "olarak", "ucuz", "uygun", "alti", "ustu",
  "arasi", "arasinda", "yaklasik", "en", "az", "fazla", "cok", "min", "max", "ustunde", "altinda", "uzeri",
]);

/** Konum eşlemesinde yanlış eşleşmeyi önlemek için atlanan sözcükler. */
const GEO_SKIP = new Set([
  ...NOISE,
  "merkezi", "genis", "luks", "temiz", "yeni", "eski", "buyuk", "kucuk", "firsat", "sahibinden", "esyali",
  "asansorlu", "balkonlu", "otoparkli", "bahceli", "denize", "sifir", "site", "sitesi", "icinde",
]);

const SUFFIXES = ["deki", "daki", "teki", "taki", "den", "dan", "ten", "tan", "nin", "nun", "de", "da", "te", "ta", "ye", "ya", "li", "lu", "lik", "luk", "in", "un", "e", "a"];

function stemCandidates(word: string): string[] {
  const out = [word];
  for (const suf of SUFFIXES) {
    if (word.length - suf.length >= 4 && word.endsWith(suf)) out.push(word.slice(0, word.length - suf.length));
  }
  return out;
}

function typeOf(word: string): string | null {
  for (const [stem, value] of TYPE_STEMS) {
    if (word === stem) return value;
    if (word.startsWith(stem) && TYPE_SUFFIXES.has(word.slice(stem.length))) return value;
    if (stem.length >= 5 && editDistance(word, stem, 1) <= 1) return value;
  }
  return null;
}

function transactionOf(word: string): "Satılık" | "Kiralık" | null {
  if (TRANSACTION_WORDS[word]) return TRANSACTION_WORDS[word];
  if (word.length >= 6) {
    for (const [stem, value] of Object.entries(TRANSACTION_WORDS)) {
      if (stem.length >= 6 && editDistance(word, stem, 1) <= 1) return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sayısal çıkarım
// ---------------------------------------------------------------------------

type Range = { min?: number; max?: number; assumed?: boolean };

function applyDirection(value: number, dir: Direction, bareDefault: "max" | "about" | "exact"): Range {
  if (dir === "min") return { min: value };
  if (dir === "max") return { max: value };
  if (dir === "about") return { min: Math.round(value * 0.9), max: Math.round(value * 1.1) };
  if (bareDefault === "max") return { max: value, assumed: true };
  if (bareDefault === "about") return { min: Math.round(value * 0.9), max: Math.round(value * 1.1), assumed: true };
  return { min: value, max: value };
}

type Extracted = {
  rooms: string[];
  area?: Range;
  floor?: Range;
  money?: Range;
  text: string;
};

export function extractNumbers(input: string): Extracted {
  let t = input;
  const rooms: string[] = [];

  // Stüdyo = 1+0
  t = t.replace(/\bstudyo\b/g, (m) => {
    rooms.push("1+0");
    return MARK.repeat(m.length);
  });

  // Oda: 3+1, 2 + 1
  t = t.replace(/(?<![\d.,])(\d{1,2})\s*\+\s*(\d)(?!\d)/g, (m, a: string, b: string) => {
    const left = Number(a);
    if (left < 1 || left > 10) return m;
    const val = `${left}+${b}`;
    if (!rooms.includes(val)) rooms.push(val);
    return MARK.repeat(m.length);
  });

  // Metrekare (aralık veya tek)
  let area: Range | undefined;
  const areaRe = new RegExp(
    String.raw`(${NUMBER})(?:\s*(?:-|ile|ila|ve)\s*(${NUMBER}))?\s*(?:m2|metrekare(?:lik)?|metre\s*kare(?:lik)?|m\s*kare|mkare|metre)(?![a-z])`,
  );
  const am = areaRe.exec(t);
  if (am) {
    const start = am.index;
    const end = start + am[0].length;
    const a = toNumber(am[1]);
    const b = am[2] ? toNumber(am[2]) : null;
    let work = blank(t, start, end);
    if (b != null) {
      const d = readDirection(work, start, end);
      work = d.text;
      area = { min: Math.min(a, b), max: Math.max(a, b) };
    } else {
      const d = readDirection(work, start, end);
      work = d.text;
      area = applyDirection(a, d.dir, "about");
    }
    t = work;
  }

  // Kat: "3. kat", "zemin kat", "2-4. kat"
  let floor: Range | undefined;
  const zemin = /\b(?:zemin|giris)\s+kat(?:ta|i|inda)?(?![a-z])/.exec(t);
  const floorRe = /(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*\.?\s*kat(?:ta|i|inda|a)?(?![a-z])/;
  const fm = floorRe.exec(t);
  if (zemin && (!fm || zemin.index < fm.index)) {
    const start = zemin.index;
    const end = start + zemin[0].length;
    const d = readDirection(blank(t, start, end), start, end);
    t = d.text;
    floor = applyDirection(0, d.dir, "exact");
  } else if (fm) {
    const start = fm.index;
    const end = start + fm[0].length;
    const a = Number(fm[1]);
    const b = fm[2] ? Number(fm[2]) : null;
    const d = readDirection(blank(t, start, end), start, end);
    t = d.text;
    floor = b != null ? { min: Math.min(a, b), max: Math.max(a, b) } : applyDirection(a, d.dir, "exact");
  }

  // Para: önce "2 buçuk milyon"
  let money: Range | undefined;
  const moneyUnit = `(${MONEY_UNIT})`;
  const bucuk = new RegExp(String.raw`(\d+)\s+bucuk\s+${moneyUnit}(?![a-z])(?:\s*(?:tl|lira|try)(?![a-z]))?`).exec(t);
  const rangeRe = new RegExp(
    String.raw`(${NUMBER})\s*${moneyUnit}?\s*(?:-|ile|ila|ve)\s*(${NUMBER})\s*${moneyUnit}(?![a-z])(?:\s*(?:tl|lira|try)(?![a-z]))?`,
  );
  const singleRe = new RegExp(
    String.raw`(${NUMBER})\s*${moneyUnit}(?![a-z])(?:\s*(?:tl|lira|try)(?![a-z]))?|(${NUMBER})\s*(?:tl|lira|try)(?![a-z])|(?<![\d.,+])(\d{1,3}(?:\.\d{3}){1,}|\d{5,})(?![\d.,])`,
  );

  const rm = rangeRe.exec(t);
  if (bucuk && (!rm || bucuk.index <= rm.index)) {
    const start = bucuk.index;
    const end = start + bucuk[0].length;
    const value = (Number(bucuk[1]) + 0.5) * unitMultiplier(bucuk[2]);
    const d = readDirection(blank(t, start, end), start, end);
    t = d.text;
    money = applyDirection(Math.round(value), d.dir, "max");
  } else if (rm) {
    const start = rm.index;
    const end = start + rm[0].length;
    // Grup sırası: 1=sayı1, 2=birim1 (isteğe bağlı), 3=sayı2, 4=birim2
    const n1 = toNumber(rm[1]) * (rm[2] ? unitMultiplier(rm[2]) : unitMultiplier(rm[4]));
    const n2 = toNumber(rm[3]) * unitMultiplier(rm[4]);
    const d = readDirection(blank(t, start, end), start, end);
    t = d.text;
    money = { min: Math.round(Math.min(n1, n2)), max: Math.round(Math.max(n1, n2)) };
  } else {
    const sm = singleRe.exec(t);
    if (sm) {
      const start = sm.index;
      const end = start + sm[0].length;
      let value: number;
      if (sm[1]) value = toNumber(sm[1]) * unitMultiplier(sm[2]);
      else if (sm[3]) value = toNumber(sm[3]);
      else value = toNumber(sm[4]);
      const d = readDirection(blank(t, start, end), start, end);
      t = d.text;
      if (Number.isFinite(value) && value > 0) money = applyDirection(Math.round(value), d.dir, "max");
    }
  }

  return { rooms, area, floor, money, text: t };
}

// ---------------------------------------------------------------------------
// Konum eşleme
// ---------------------------------------------------------------------------

type GeoMatch = { item: GeoItem; dist: number };

/** Pencere (1-3 sözcük) → en yakın konum adayları. Belirsizlik varsa birden çok aday döner. */
function matchWindow(window: string, list: GeoItem[], folded: Map<string, string>): GeoMatch[] {
  const cands = new Set(
    window.includes(" ")
      ? stemCandidates(window.split(" ").pop() ?? window).map((last) =>
          [...window.split(" ").slice(0, -1), last].join(" "),
        )
      : stemCandidates(window),
  );
  let best = Number.POSITIVE_INFINITY;
  let found: GeoMatch[] = [];
  for (const cand of cands) {
    const tol = tolerance(cand.length);
    for (const item of list) {
      const name = folded.get(item.id) ?? "";
      if (!name) continue;
      if (Math.abs(name.length - cand.length) > tol) continue;
      const d = editDistance(cand, name, tol);
      if (d > tol) continue;
      if (d < best) {
        best = d;
        found = [{ item, dist: d }];
      } else if (d === best) {
        found.push({ item, dist: d });
      }
    }
  }
  return found;
}

type Tok = { text: string; used: boolean };

/**
 * Bir geo seviyesini jetonlar üzerinde eşler. Uzun pencereler önce; aynı uzunlukta kesin eşleşme
 * yaklaşık eşleşmeden önce gelir. Tek aday varsa işaretler ve tüketir.
 */
function matchLevel(
  toks: Tok[],
  list: GeoItem[],
  notes: string[],
  levelLabel: string,
): GeoItem | null {
  if (list.length === 0) return null;
  const folded = new Map(list.map((i) => [i.id, foldTr(i.name)]));
  for (const size of [3, 2, 1]) {
    for (const exactOnly of [true, false]) {
      for (let i = 0; i + size <= toks.length; i += 1) {
        const slice = toks.slice(i, i + size);
        if (slice.some((s) => s.used)) continue;
        if (size === 1 && (GEO_SKIP.has(slice[0].text) || slice[0].text.length < 3)) continue;
        if (slice.some((s) => /\d/.test(s.text))) continue;
        const win = slice.map((s) => s.text).join(" ");
        const matches = matchWindow(win, list, folded).filter((m) => (exactOnly ? m.dist === 0 : true));
        if (matches.length === 0) continue;
        if (matches.length > 1) {
          notes.push(`"${win}" birden çok ${levelLabel} ile eşleşiyor; konum filtresi uygulanmadı.`);
          for (const s of slice) s.used = true;
          return null;
        }
        for (const s of slice) s.used = true;
        return matches[0].item;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Çıktı biçimleri
// ---------------------------------------------------------------------------

export function formatMoneyShort(n: number): string {
  if (n >= 1e9) return `${trim(n / 1e9)} Milyar TL`;
  if (n >= 1e6) return `${trim(n / 1e6)} Mn TL`;
  if (n >= 1e3) return `${trim(n / 1e3)} Bin TL`;
  return `${n} TL`;
}

function trim(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

function rangeLabel(r: Range, fmt: (n: number) => string): string {
  if (r.min != null && r.max != null) {
    return r.min === r.max ? fmt(r.min) : `${fmt(r.min)} – ${fmt(r.max)}`;
  }
  if (r.max != null) return `En çok ${fmt(r.max)}`;
  return `En az ${fmt(r.min ?? 0)}`;
}

export const NL_GROUP_LABELS: Record<NlGroup, string> = {
  islem: "İşlem",
  kategori: "Tür",
  oda: "Oda",
  fiyat: "Fiyat",
  m2: "Metrekare",
  kat: "Kat",
  il: "İl",
  ilce: "İlçe",
  mahalle: "Mahalle",
};

export const NL_GROUPS = Object.keys(NL_GROUP_LABELS) as NlGroup[];

// ---------------------------------------------------------------------------
// Ana fonksiyon
// ---------------------------------------------------------------------------

export function parseNlQuery(
  raw: string,
  geo: NlGeo = { provinces: [], districts: [] },
  opts: { exclude?: ReadonlySet<NlGroup> | NlGroup[] } = {},
): NlParseResult {
  const exclude = new Set<NlGroup>(opts.exclude ? [...opts.exclude] : []);
  const notes: string[] = [];

  // Normalleştirme: Türkçe katlama, kesme işareti sonrası ekleri at ("Kadıköy'de" -> "kadikoy").
  let t = foldTr(raw.slice(0, 300))
    .replace(/²/g, "2")
    .replace(/[’‘`´]/g, "'")
    .replace(/'[a-z]*/g, " ")
    .replace(/(?<!\d),|,(?!\d)|[;!?()"]/g, " ")
    .replace(/(?<=\d)\s*\+\s*(?=\d)/g, "+");

  const num = extractNumbers(t);
  t = num.text;

  // Jetonlar (sayısal işaretli aralıklar atlanır)
  const words = t
    .split(/[\s\u0001]+/)
    .map((w) => w.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter(Boolean);
  const toks: Tok[] = words.map((text) => ({ text, used: false }));

  // Hedef (talep / müşteri) sözcükleri
  let target: NlTarget = "portfoy";
  for (const tok of toks) {
    if (TARGET_TALEP.has(tok.text)) {
      target = "talep";
      tok.used = true;
    } else if (TARGET_MUSTERI.has(tok.text) && target === "portfoy") {
      target = "musteri";
      tok.used = true;
    }
  }

  // "müstakil ev" ikilisi
  for (let i = 0; i + 1 < toks.length; i += 1) {
    if (toks[i].text.startsWith("mustakil") && toks[i + 1].text === "ev") {
      toks[i + 1].used = true;
      toks[i].text = "mustakil-ev";
    }
    if (toks[i].text === "is" && toks[i + 1].text.startsWith("yeri")) {
      toks[i].text = "isyeri";
      toks[i + 1].used = true;
    }
  }

  // İşlem türü
  const transactions = new Set<"Satılık" | "Kiralık">();
  for (const tok of toks) {
    if (tok.used) continue;
    const v = transactionOf(tok.text);
    if (v) {
      transactions.add(v);
      tok.used = true;
    }
  }
  let islem: "Satılık" | "Kiralık" | null = null;
  if (transactions.size === 1) islem = [...transactions][0];
  else if (transactions.size > 1) notes.push("Hem satılık hem kiralık yazılmış; işlem filtresi uygulanmadı.");

  // Mülk türü
  const types: string[] = [];
  for (const tok of toks) {
    if (tok.used) continue;
    if (tok.text === "mustakil-ev") {
      types.push("Müstakil ev");
      tok.used = true;
      continue;
    }
    if (tok.text === "mustakil") {
      types.push("Müstakil ev");
      tok.used = true;
      continue;
    }
    const v = typeOf(tok.text);
    if (v) {
      if (!types.includes(v)) types.push(v);
      tok.used = true;
    }
  }
  let kategori: string | null = null;
  if (types.length === 1) kategori = types[0];
  else if (types.length > 1) notes.push(`Birden çok tür yazılmış (${types.join(", ")}); tür filtresi uygulanmadı.`);

  // Konum: il → ilçe → mahalle
  const province = matchLevel(toks, geo.provinces, notes, "il");
  const districtPool = province
    ? geo.districts.filter((d) => d.parentId === province.id)
    : geo.districts;
  const district = matchLevel(toks, districtPool, notes, "ilçe");
  const neighborhood = district && geo.neighborhoods ? matchLevel(toks, geo.neighborhoods, notes, "mahalle") : null;
  const resolvedProvinceId = province?.id ?? district?.parentId ?? null;
  const resolvedProvince = province ?? geo.provinces.find((p) => p.id === resolvedProvinceId) ?? null;

  const unknown = toks
    .filter((tok) => !tok.used && !NOISE.has(tok.text) && !/^[+\-./\d]+$/.test(tok.text) && tok.text.length > 1)
    .map((tok) => tok.text);

  // Chip'ler
  const all: NlChip[] = [];
  if (islem) all.push({ group: "islem", label: islem, params: { islem } });
  if (kategori) all.push({ group: "kategori", label: kategori, params: { kategori } });
  if (num.rooms.length) {
    all.push({ group: "oda", label: num.rooms.join(" / "), params: { oda: num.rooms.join(",") } });
  }
  if (num.money) {
    const p: Partial<Record<NlParam, string>> = {};
    if (num.money.min != null) p.fiyat_min = String(num.money.min);
    if (num.money.max != null) p.fiyat_max = String(num.money.max);
    all.push({ group: "fiyat", label: rangeLabel(num.money, formatMoneyShort), params: p, assumed: num.money.assumed });
  }
  if (num.area) {
    const p: Partial<Record<NlParam, string>> = {};
    if (num.area.min != null) p.m2_min = String(num.area.min);
    if (num.area.max != null) p.m2_max = String(num.area.max);
    all.push({ group: "m2", label: rangeLabel(num.area, (n) => `${n} m²`), params: p, assumed: num.area.assumed });
  }
  if (num.floor) {
    const p: Partial<Record<NlParam, string>> = {};
    if (num.floor.min != null) p.kat_min = String(num.floor.min);
    if (num.floor.max != null) p.kat_max = String(num.floor.max);
    all.push({ group: "kat", label: rangeLabel(num.floor, (n) => (n === 0 ? "Zemin kat" : `${n}. kat`)), params: p });
  }
  if (resolvedProvince && (province || !district)) {
    all.push({ group: "il", label: resolvedProvince.name, params: { il: resolvedProvince.id } });
  }
  if (district) {
    const label = resolvedProvince ? `${district.name} (${resolvedProvince.name})` : district.name;
    all.push({ group: "ilce", label, params: { ilce: district.id } });
  }
  if (neighborhood) {
    all.push({ group: "mahalle", label: `${neighborhood.name} Mah.`, params: { mahalle: neighborhood.id } });
  }

  const chips = all.filter((c) => !exclude.has(c.group));
  const excluded = all.filter((c) => exclude.has(c.group));
  const filters: Partial<Record<NlParam, string>> = {};
  for (const c of chips) Object.assign(filters, c.params);

  return { target, filters, chips, excluded, unknown, notes, provinceId: resolvedProvinceId };
}
