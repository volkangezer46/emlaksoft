/**
 * Kesin kurallı Türkçe fiş/fatura METİN çözümleyici (SAF). PDF metin katmanından kurulan satırlar ve görsel OCR çıktısı
 * aynı kurallarla okunur. Desteklenen düzenler: ÖKC (yazar kasa) fişi (TOPLAM / TOPKDV / KDV %X / Z NO / FİŞ NO / EKÜ),
 * e-Arşiv / e-Fatura PDF'i (Ödenecek Tutar / Vergiler Dahil Toplam / Hesaplanan KDV(%20) / KDV Matrahı / Fatura No /
 * ETTN / VKN / SAYIN alıcı bloğu), serbest meslek makbuzu (Brüt / GV stopajı), banka dekontu (İşlem tutarı).
 *
 * Her alan, eşleşen kalıbın gücüne göre güven taşır; OCR çıktısında güven tanıma kalitesiyle ölçeklenir. Hiçbir değer
 * uydurulmaz: kalıp yoksa alan boş kalır.
 */
import { classifyTaxId } from "./tax-id";
import { amountsInLine, datesInLine, fixOcrDigits, foldTr, isKnownVatRate, round2 } from "./numbers";
import type { LayerFields, LineItem, PaymentMethod, ReceiptDocType, ReceiptSource, VatLine } from "./types";

export type TextParseInput = {
  lines: readonly string[];
  source: Extract<ReceiptSource, "pdf-text" | "ocr">;
  /** OCR ortalama tanıma kalitesi (0..1); PDF metni için 1. */
  quality?: number;
};

const MAX_LINES = 400;

type Line = { raw: string; fold: string; idx: number };

function prepare(lines: readonly string[]): Line[] {
  const out: Line[] = [];
  for (const l of lines.slice(0, MAX_LINES * 2)) {
    // 3+ boşluk sütun ayracı olarak korunur (PDF satır kurucu ve OCR "preserve_interword_spaces"); diğerleri teke iner.
    const raw = l
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s{3,}/g, "\u0001")
      .replace(/\s+/g, " ")
      .replace(/\u0001/g, "   ")
      .trim()
      .slice(0, 300);
    if (!raw) continue;
    out.push({ raw, fold: foldTr(raw), idx: out.length });
    if (out.length >= MAX_LINES) break;
  }
  return out;
}


function lastAmount(l: Line): number | null {
  const a = amountsInLine(l.raw);
  return a.length ? a[a.length - 1]! : null;
}

/** Satırda tutar yoksa (etiket alt satırda kalmışsa) sonraki satırın TEK tutarı. */
function amountAtOrNext(lines: Line[], i: number): number | null {
  const own = lastAmount(lines[i]!);
  if (own != null) return own;
  const next = lines[i + 1];
  if (!next) return null;
  const a = amountsInLine(next.raw);
  return a.length === 1 && next.fold.replace(/[\d\s%]/g, "").length <= 6 ? a[0]! : null;
}

/** Satırdaki KDV oranları. "%20", "% 20", "(%20)", "KDV 20", "20%", "%01"; OCR'de % → 4/X/Z okunmuş "420" yalnız oran yuvasında. */
export function ratesInLine(raw: string): number[] {
  const out: number[] = [];
  const push = (n: number) => {
    if (isKnownVatRate(n) && !out.includes(n)) out.push(n);
  };
  for (const m of raw.matchAll(/%\s?0?(\d{1,2})(?:[.,]0{1,2})?(?![\d])/g)) push(Number(m[1]));
  for (const m of raw.matchAll(/(?<![\d.,])(\d{1,2})\s?%/g)) push(Number(m[1]));
  for (const m of raw.matchAll(/\bKDV\s*\(?\s*0?(\d{1,2})\s*\)?(?![\d.,])/gi)) push(Number(m[1]));
  if (!out.length) {
    // OCR: "%20" → "820" / "420" / "X20" / "Z20". Rakam karışması yalnız ÖKC'nin yıldızlı tutarından hemen önce kabul edilir.
    for (const m of raw.matchAll(/(?<![\w.,%])[48](0?1|8|10|18|20)(?=\s+\*\s?\d)/g)) push(Number(m[1]));
    for (const m of raw.matchAll(/(?<![\w.,%])[XxZz](0?1|8|10|18|20)(?=\s+\*?\s?\d)/g)) push(Number(m[1]));
  }
  return out;
}

const NOISE_TOP =
  /^(e ?arsiv fatura|e ?fatura|fatura|fis|bilgi fisi|satis fisi|hos ?geldiniz|tesekkur|iyi gunler|mali degeri yoktur|irsaliye yerine gecer|sayin|tarih|saat|tel|telefon|fax|faks|www|http|mersis|ticaret sicil|sicil no|vkn|tckn|vergi|v d|mf|eku|z no|fis no|belge|nusha|orijinal|kopya|ozelestirme|senaryo|fatura tipi|ettn)\b/;
const COMPANY_MARK =
  /\b(ltd|sti|limited|sirketi|a s|as|anonim|tic|ticaret|san|sanayi|koll|kollektif|holding|grup|petrol|akaryakit|market|marketcilik|gida|insaat|emlak|gayrimenkul|otomotiv|turizm|lokanta|restoran|cafe|kirtasiye|elektrik|enerji|dagitim|iletisim|telekom|bankasi|bank)\b/;
const ADDRESS_MARK = /\b(mah|mahallesi|cad|caddesi|cd|sok|sokak|sk|bulv|bulvari|no|kat|daire|apt|blok|site|osb|pk)\b|\/[a-z]/;
const SUFFIX_TOKENS = new Set(["tic", "tec", "tlc", "ticaret", "san", "sanayi", "ltd", "lt", "limited", "sti", "stl", "sirketi", "a", "s", "as", "anonim", "ve", "paz", "pazarlama", "ith", "ihr", "ithalat", "ihracat", "insaat", "ic", "dis"]);
const STRONG_SUFFIX = /\b(ltd|lt|limited|sti|stl|sirketi|anonim|as|a s)\b/;
/** Satır yalnız unvan eklerinden mi oluşuyor ("TİC. LTD. ŞTİ.", OCR'de "TEC. LTD. STİ." dahil)? */
function isLegalSuffixLine(fold: string): boolean {
  const t = fold.split(" ").filter(Boolean);
  if (!t.length || t.length > 8) return false;
  const hits = t.filter((x) => SUFFIX_TOKENS.has(x)).length;
  return hits / t.length >= 0.6 && STRONG_SUFFIX.test(fold);
}

function looksLikeName(l: Line): boolean {
  if (l.fold.length < 3 || l.fold.length > 90) return false;
  if (NOISE_TOP.test(l.fold)) return false;
  if (/\d{5,}/.test(l.raw)) return false;
  if (datesInLine(l.raw, foldTr).length) return false;
  if (amountsInLine(l.raw).length) return false;
  const letters = l.raw.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, "").length;
  return letters >= Math.max(3, l.raw.length * 0.5);
}

function cleanName(s: string): string {
  return s
    .replace(/^[*#\s.:-]+|[*#\s:,-]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function detectDocType(all: string): { value: ReceiptDocType; confidence: number } | null {
  if (/serbest meslek makbuzu/.test(all)) return { value: "smm", confidence: 0.95 };
  if (/e ?arsiv fatura|earsivfatura/.test(all)) return { value: "e_arsiv", confidence: 0.95 };
  if (/temelfatura|ticarifatura|\be ?fatura\b/.test(all)) return { value: "e_fatura", confidence: 0.9 };
  if (/\bz ?no\b|\beku no\b|\bekü no\b|\btopkdv\b|\bmf [a-z]{2,3} ?\d/.test(all)) return { value: "okc_fis", confidence: 0.92 };
  if (/\bdekont\b|hesap hareket|para transferi|\beft\b|\bhavale\b|\bfast\b/.test(all) && /\bbanka|\bbank\b|\biban\b/.test(all)) return { value: "dekont", confidence: 0.85 };
  if (/\bfis no\b|\bfis\b/.test(all) && /\btoplam\b/.test(all)) return { value: "okc_fis", confidence: 0.7 };
  if (/\bfatura\b/.test(all)) return { value: "fatura", confidence: 0.75 };
  if (/\bmakbuz\b/.test(all)) return { value: "makbuz", confidence: 0.75 };
  return null;
}

type Cand<T> = { value: T; score: number; idx: number };

function best<T>(c: Cand<T>[]): Cand<T> | null {
  if (!c.length) return null;
  return [...c].sort((a, b) => b.score - a.score || b.idx - a.idx)[0]!;
}

export function parseReceiptText(input: TextParseInput): LayerFields {
  const lines = prepare(input.lines);
  const f: LayerFields = {};
  if (!lines.length) return f;
  const src = input.source;
  const q = input.source === "ocr" ? Math.min(1, Math.max(0, input.quality ?? 0.7)) : 1;
  // Kaynak ölçeği: PDF metni olduğu gibi; OCR 0.85 tavanlı ve kaliteyle azalır.
  const scale = (c: number) => round2(Math.min(0.97, input.source === "ocr" ? c * (0.72 + 0.16 * q) : c));
  const all = lines.map((l) => l.fold).join(" \n ");

  const doc = detectDocType(all);
  if (doc) f.docType = { value: doc.value, confidence: scale(doc.confidence), source: src };

  // --- Alıcı bloğu ("SAYIN ...") — satıcı alanları buradan alınmaz.
  // Dekontta "Alıcı" ödeme yapılan taraftır (ofisin karşı tarafı = satıcı); alıcı bloğu aranmaz.
  const isDekont = doc?.value === "dekont";
  const buyerStart = isDekont ? -1 : lines.findIndex((l) => /^sayin\b|^alici\b|^musteri bilgileri|^fatura adresi/.test(l.fold));
  const buyerEnd = buyerStart >= 0 ? Math.min(lines.length, buyerStart + 8) : -1;
  const inBuyer = (i: number) => buyerStart >= 0 && i >= buyerStart && i < buyerEnd;

  // --- Toplamlar
  const totals: Cand<number>[] = [];
  const grossC: Cand<number>[] = [];
  const netC: Cand<number>[] = [];
  const vatTotalC: Cand<number>[] = [];
  const vatWhC: Cand<number>[] = [];
  const gvC: Cand<number>[] = [];
  const payments: { amount: number; method: PaymentMethod; idx: number }[] = [];
  const vatByRate = new Map<number, VatLine & { score: number }>();
  const itemRates = new Set<number>();
  const items: LineItem[] = [];
  let firstTotalIdx = Infinity;

  lines.forEach((l, i) => {
    const s = l.fold;
    const amt = () => amountAtOrNext(lines, i);
    if (/tevkifat/.test(s) && !/tabi islem|matrah/.test(s)) {
      const a = amt();
      if (a != null) vatWhC.push({ value: a, score: 0.9, idx: i });
      return;
    }
    if (/stopaj|gelir vergisi kesintisi|g ?v ?stopaj/.test(s)) {
      const a = amt();
      if (a != null) gvC.push({ value: a, score: 0.88, idx: i });
      return;
    }
    if (/odenecek (tutar|toplam)|^odenecek\b|net tahsilat|tahsil edilen tutar/.test(s)) {
      const a = amt();
      if (a != null) totals.push({ value: a, score: 0.95, idx: i });
      firstTotalIdx = Math.min(firstTotalIdx, i);
      return;
    }
    if (/genel toplam/.test(s)) {
      const a = amt();
      if (a != null) totals.push({ value: a, score: 0.93, idx: i });
      firstTotalIdx = Math.min(firstTotalIdx, i);
      return;
    }
    if (/vergiler dahil|vergi dahil|kdv dahil (toplam|tutar)/.test(s)) {
      const a = amt();
      if (a != null) {
        grossC.push({ value: a, score: 0.92, idx: i });
        totals.push({ value: a, score: 0.88, idx: i });
      }
      firstTotalIdx = Math.min(firstTotalIdx, i);
      return;
    }
    if (/\btopkdv\b|toplam kdv|kdv toplam|hesaplanan kdv|kdv tutari|^kdv\b|\bkdv\b/.test(s) && !/dahil|haric|matrah/.test(s)) {
      const rates = ratesInLine(l.raw);
      const a = amt();
      if (a == null) return;
      if (/\btopkdv\b|toplam kdv|kdv toplam/.test(s) || (/hesaplanan kdv/.test(s) && rates.length === 0)) {
        vatTotalC.push({ value: a, score: 0.92, idx: i });
      } else if (rates.length === 1) {
        const r = rates[0]!;
        const cur = vatByRate.get(r) ?? { rate: r, base: null, amount: null, score: 0 };
        cur.amount = a;
        cur.score = Math.max(cur.score, 0.9);
        vatByRate.set(r, cur);
      } else if (rates.length === 0) {
        vatTotalC.push({ value: a, score: 0.75, idx: i });
      }
      return;
    }
    if (/matrah/.test(s)) {
      const rates = ratesInLine(l.raw);
      const a = amt();
      if (a == null) return;
      if (rates.length === 1) {
        const r = rates[0]!;
        const cur = vatByRate.get(r) ?? { rate: r, base: null, amount: null, score: 0 };
        cur.base = a;
        cur.score = Math.max(cur.score, 0.88);
        vatByRate.set(r, cur);
      } else netC.push({ value: a, score: 0.85, idx: i });
      return;
    }
    if (/mal hizmet toplam|ara toplam|toplam tutar kdv haric|kdv haric toplam|tutar kdv haric/.test(s)) {
      const a = amt();
      if (a != null) netC.push({ value: a, score: 0.88, idx: i });
      return;
    }
    if (/\b(nakit|kredi karti|k karti|kart|banka karti|temassiz|pos|havale|eft)\b/.test(s) && !/para ustu|degisim/.test(s)) {
      const a = lastAmount(l);
      if (a != null) {
        const method: PaymentMethod = /nakit/.test(s) ? "nakit" : /havale|eft/.test(s) ? "havale" : "kart";
        payments.push({ amount: a, method, idx: i });
      }
      return;
    }
    if (/\btoplami?\b|\btop\b|\btutari?\b/.test(s) && !/indirim|iskonto|adet|miktar|satir|urun|kalem|puan/.test(s)) {
      const a = amt();
      if (a != null) {
        const strong = /^\*?\s*toplam\b|^top\b|\btoplam\s*(tl|try)?$/.test(s) || /^toplam\b/.test(s);
        const isTutar = !/\btoplami?\b|\btop\b/.test(s);
        totals.push({ value: a, score: isTutar ? (doc?.value === "dekont" ? 0.82 : 0.6) : strong ? 0.88 : 0.8, idx: i });
        firstTotalIdx = Math.min(firstTotalIdx, i);
      }
      return;
    }
    // ÖKC kalem satırı: "KURŞUNSUZ 95 %20 *1.250,00", "EKMEK %01 *12,50"
    const rates = ratesInLine(l.raw);
    const a = lastAmount(l);
    if (a != null && rates.length === 1 && /[a-zçğıöşü]{3}/i.test(l.raw) && i < firstTotalIdx) {
      itemRates.add(rates[0]!);
      if (items.length < 20) {
        const firstCol = l.raw.split(/\s{3,}/)[0]!;
        const name = cleanName(
          firstCol
            .replace(/%\s?\d{1,2}|(?<![\w.,])[48XxZz](?:0?1|8|10|18|20)(?=\s+\*?\s?\d)|\*?\s?[\d.,]+\s*(TL|TRY)?\s*$/gi, " ")
            .replace(/\s\d+([.,]\d+)?\s*(adet|ad|kg|lt|gr|ad\.)\b.*$/i, " "),
        );
        if (name.length >= 2) items.push({ name: name.slice(0, 80), quantity: null, total: a, vatRate: rates[0]! });
      }
    }
  });

  // Toplam seçimi: en güçlü kalıp; ödeme satırı aynı tutarı doğruluyorsa güven artar.
  let total = best(totals);
  if (!total && payments.length) {
    const p = payments.reduce((a, b) => (b.amount > a.amount ? b : a));
    total = { value: p.amount, score: 0.7, idx: p.idx };
  }
  if (total) {
    // Aynı güçte birden çok aday varsa (ara toplam + toplam) en alttaki/ büyük olan tercih edilir.
    const same = totals.filter((c) => Math.abs(c.score - total!.score) < 0.001);
    if (same.length > 1) total = same.reduce((a, b) => (b.value > a.value || (b.value === a.value && b.idx > a.idx) ? b : a));
    let conf = total.score;
    if (payments.some((p) => Math.abs(p.amount - total!.value) < 0.01)) conf += 0.04;
    if (totals.filter((c) => Math.abs(c.value - total!.value) < 0.01).length > 1) conf += 0.03;
    f.total = { value: total.value, confidence: scale(Math.min(0.97, conf)), source: src };
  }
  const gross = best(grossC);
  if (gross) f.grossTotal = { value: gross.value, confidence: scale(gross.score), source: src };

  const vatLines = [...vatByRate.values()].sort((a, b) => b.rate - a.rate);
  const vt = best(vatTotalC);
  if (vatLines.length) {
    f.vatLines = { value: vatLines.map(({ rate, base, amount }) => ({ rate, base, amount })), confidence: scale(Math.min(...vatLines.map((v) => v.score))), source: src };
    const sum = vatLines.every((v) => v.amount != null) ? round2(vatLines.reduce((s, v) => s + (v.amount ?? 0), 0)) : null;
    if (vt) f.vatTotal = { value: vt.value, confidence: scale(sum != null && Math.abs(sum - vt.value) < 0.05 ? 0.95 : vt.score), source: src };
    else if (sum != null) f.vatTotal = { value: sum, confidence: scale(0.85), source: src };
    if (vatLines.every((v) => v.base != null)) f.net = { value: round2(vatLines.reduce((s, v) => s + (v.base ?? 0), 0)), confidence: scale(0.88), source: src };
  } else if (vt) {
    f.vatTotal = { value: vt.value, confidence: scale(vt.score), source: src };
    const total0 = best(totals)?.value;
    if (itemRates.size === 1) {
      // Kalemlerde tek oran okundu: toplamla tutarlıysa (OCR bir kalemin oranını kaçırmış olabilir) kabul edilir.
      const rate = [...itemRates][0]!;
      const expected = total0 != null ? (total0 * rate) / (100 + rate) : null;
      if (expected == null || Math.abs(expected - vt.value) <= Math.max(0.05, expected * 0.02)) {
        f.vatLines = { value: [{ rate, base: null, amount: vt.value }], confidence: scale(0.8), source: src };
      }
    }
  } else if (itemRates.size === 1) {
    const rate = [...itemRates][0]!;
    f.vatLines = { value: [{ rate, base: null, amount: null }], confidence: scale(0.7), source: src };
  }
  // Oran okunamadıysa (OCR "%" kaçırdı) tek oranlı belgede KDV / (toplam - KDV) oranından çıkarılır.
  if (!f.vatLines && f.vatTotal && f.total && f.total.value > f.vatTotal.value && f.vatTotal.value > 0) {
    const ratio = (f.vatTotal.value / (f.total.value - f.vatTotal.value)) * 100;
    const rate = [1, 8, 10, 18, 20].find((r) => Math.abs(ratio - r) <= Math.max(0.05, r * 0.004));
    if (rate) f.vatLines = { value: [{ rate, base: round2(f.total.value - f.vatTotal.value), amount: f.vatTotal.value }], confidence: scale(0.8), source: src };
  }
  if (!f.net) {
    const n = best(netC);
    if (n) f.net = { value: n.value, confidence: scale(n.score), source: src };
  }
  const wh = best(vatWhC);
  if (wh) f.vatWithholding = { value: wh.value, confidence: scale(wh.score), source: src };
  const gv = best(gvC);
  if (gv) f.incomeTaxWithholding = { value: gv.value, confidence: scale(gv.score), source: src };
  if (payments.length) {
    const methods = new Set(payments.map((p) => p.method));
    f.paymentMethod = { value: methods.size === 1 ? payments[0]!.method : "diger", confidence: scale(methods.size === 1 ? 0.85 : 0.6), source: src };
  }
  if (items.length) f.items = { value: items, confidence: scale(0.7), source: src };

  // --- Tarih / saat
  const dateC: Cand<string>[] = [];
  lines.forEach((l, i) => {
    const ds = datesInLine(l.raw, foldTr);
    if (!ds.length) return;
    let score = 0.7;
    if (/fatura tarihi|duzenleme tarihi|belge tarihi|islem tarihi|fis tarihi|makbuz tarihi|\btarih\b|\btarihi\b/.test(l.fold)) score += 0.22;
    if (/son odeme|vade|sevk|baslangic|bitis|donem|gecerlilik|dogum|teslim|okuma tarihi|ilk okuma|son okuma|basim|kayit tarihi/.test(l.fold)) score -= 0.45;
    if (inBuyer(i)) score -= 0.1;
    if (/\b([01]\d|2[0-3])[:.][0-5]\d\b/.test(l.raw)) score += 0.04;
    for (const d of ds) dateC.push({ value: d, score, idx: -i });
  });
  const date = best(dateC);
  if (date && date.score > 0.4) {
    const agree = dateC.filter((c) => c.value === date.value).length;
    f.date = { value: date.value, confidence: scale(Math.min(0.96, date.score + (agree > 1 ? 0.03 : 0))), source: src };
    const dl = lines[-date.idx]!;
    const tm = /\b([01]\d|2[0-3])[:.]([0-5]\d)(?::[0-5]\d)?\b/.exec(fixOcrDigits(dl.raw.replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g, " ")));
    const timeLine = tm ? null : lines.find((l) => /\bsaat\b/.test(l.fold));
    const tm2 = timeLine ? /\b([01]\d|2[0-3])[:.]([0-5]\d)\b/.exec(fixOcrDigits(timeLine.raw)) : null;
    const t = tm ?? tm2;
    if (t) f.time = { value: `${t[1]}:${t[2]}`, confidence: scale(0.85), source: src };
  }

  // --- Belge no, ETTN, Z no
  const upperAll = lines.map((l) => l.raw).join("\n");
  const ettn = /\b([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/.exec(upperAll);
  if (ettn) f.ettn = { value: ettn[1]!.toLowerCase(), confidence: scale(/ettn/i.test(upperAll) ? 0.96 : 0.85), source: src };
  const gibNo = /\b([A-Z0-9]{3}20\d{2}\d{9})\b/.exec(upperAll.toUpperCase().replace(/(?<=[A-Z0-9]{3}20\d{2}\d{0,8})O/g, "0"));
  if (gibNo) f.documentNo = { value: gibNo[1]!, confidence: scale(0.95), source: src };
  else {
    for (const l of lines) {
      const m = /\b(fatura no|belge no|fis no|makbuz no|seri sira no|dekont no|islem no|referans no|sira no|no)\b\s*:?\s*([a-z0-9][a-z0-9/-]{0,29})/.exec(l.fold);
      if (!m || (m[1] === "no" && !/fis|fatura|belge/.test(l.fold))) continue;
      if (/^(z|eku)$/.test(m[1]!)) continue;
      const rawVal = new RegExp(`${m[2]!.replace(/[-/]/g, "[-/]")}`, "i").exec(l.raw)?.[0] ?? m[2]!;
      if (!/\d/.test(rawVal)) continue;
      f.documentNo = { value: rawVal.toUpperCase().slice(0, 30), confidence: scale(m[1] === "no" ? 0.6 : 0.85), source: src };
      break;
    }
  }
  const z = lines.map((l) => /\bz ?no\s*:?\s*(\d{1,6})\b/.exec(l.fold)).find(Boolean);
  if (z) f.zNo = { value: z[1]!, confidence: scale(0.85), source: src };

  // --- Vergi kimlikleri ve vergi dairesi
  const sellerIds: Cand<string>[] = [];
  const buyerIds: Cand<string>[] = [];
  lines.forEach((l, i) => {
    const ctx = /\b(vkn|tckn|vergi no|vergi kimlik|v ?k ?n|t ?c ?k ?n|tc kimlik|t c no|v d|vd|vergi dairesi|vergi d)\b/.test(l.fold);
    const ctxPrev = i > 0 && /\b(vkn|tckn|vergi no|vergi dairesi|v d)\b\s*$/.test(lines[i - 1]!.fold);
    for (const m of fixOcrDigits(l.raw).matchAll(/(?<!\d)(\d{10,11})(?!\d)/g)) {
      const id = classifyTaxId(m[1]);
      if (!id) continue;
      if (/^0\d{10}$/.test(m[1]!) || /\b(tel|telefon|gsm|fax|faks|mersis|sicil|iban|hesap)\b/.test(l.fold)) continue;
      let score = ctx || ctxPrev ? 0.9 : 0.55;
      if (!id.valid) score -= 0.3;
      (inBuyer(i) ? buyerIds : sellerIds).push({ value: id.value, score, idx: -i });
    }
  });
  const sid = best(sellerIds);
  if (sid && sid.score >= 0.5) f.sellerTaxId = { value: sid.value, confidence: scale(sid.score), source: src };
  const bid = best(buyerIds.filter((b) => b.value !== sid?.value));
  if (bid && bid.score >= 0.5) f.buyerTaxId = { value: bid.value, confidence: scale(bid.score), source: src };
  for (const [i, l] of lines.entries()) {
    if (inBuyer(i)) continue;
    const m = /vergi dairesi\s*:?\s*([A-Za-zÇĞİÖŞÜçğıöşü. ]{2,40}?)(?:\s+(?:vkn|v\.?k\.?n|vergi no|tckn|no)\b|\s*[:\-]?\s*\d|$)/i.exec(l.raw) ?? /([A-ZÇĞİÖŞÜa-zçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü. ]{1,30}?)\s*V\.\s?D\.?/.exec(l.raw);
    if (m && m[1]!.trim().length >= 2) {
      f.sellerTaxOffice = { value: cleanName(m[1]!).slice(0, 60), confidence: scale(0.82), source: src };
      break;
    }
  }

  // --- Satıcı ve alıcı adı
  const sellerLabel = isDekont ? /^(alici|alici adi|alici unvani|lehdar|odeme yapilan)\b/ : /^(satici|satici unvani|unvan|unvani|firma|duzenleyen)\b/;
  const labeled = lines.find((l) => sellerLabel.test(l.fold) && !inBuyer(l.idx));
  if (labeled) {
    const v = cleanName(labeled.raw.replace(/^[^:]*:\s*/, ""));
    if (v.length >= 2 && !/^(satici|unvan|alici)/i.test(v)) f.sellerName = { value: v, confidence: scale(isDekont ? 0.8 : 0.9), source: src };
  }
  if (!f.sellerName) {
    const limit = Math.min(lines.length, buyerStart >= 0 ? Math.min(buyerStart, 10) : 10);
    let chosen: { text: string; score: number } | null = null;
    for (let i = 0; i < limit; i++) {
      const l = lines[i]!;
      if (inBuyer(i) || !looksLikeName(l)) continue;
      if (ADDRESS_MARK.test(l.fold) && !COMPANY_MARK.test(l.fold)) continue;
      let text = l.raw;
      const next = lines[i + 1];
      if (next && !inBuyer(i + 1) && isLegalSuffixLine(next.fold)) text = `${text} ${next.raw}`;
      const marked = COMPANY_MARK.test(foldTr(text));
      const score = (marked ? 0.84 : 0.62) - i * 0.015;
      if (!chosen || score > chosen.score + 0.1) chosen = { text, score };
      if (marked) break;
    }
    if (chosen) f.sellerName = { value: cleanName(chosen.text), confidence: scale(chosen.score), source: src };
  }
  if (buyerStart >= 0) {
    const l = lines[buyerStart]!;
    const sameLine = cleanName(l.raw.split(/\s{3,}/)[0]!.replace(/^\s*(sayın|sayin|alıcı|alici)\s*:?/i, ""));
    const nextLine = lines[buyerStart + 1];
    const nextCol = nextLine ? { ...nextLine, raw: nextLine.raw.split(/\s{3,}/)[0]!, fold: foldTr(nextLine.raw.split(/\s{3,}/)[0]!) } : null;
    const cand = sameLine.length >= 3 ? sameLine : nextCol && looksLikeName(nextCol) ? cleanName(nextCol.raw) : "";
    if (cand.length >= 3) f.buyerName = { value: cand, confidence: scale(0.8), source: src };
  }

  // --- Para birimi
  const curLine = lines.find((l) => /\b(toplam|odenecek|tutar)\b/.test(l.fold) && /\b(usd|eur|euro|dolar)\b|[$€]/i.test(l.raw));
  if (curLine) f.currency = { value: /eur|euro|€/i.test(curLine.raw) ? "EUR" : "USD", confidence: scale(0.85), source: src };
  else if (/\btl\b|\btry\b|turk lirasi/.test(all) || /₺/.test(upperAll)) f.currency = { value: "TRY", confidence: scale(0.9), source: src };
  else if (f.total) f.currency = { value: "TRY", confidence: scale(0.6), source: src };

  return f;
}
