/**
 * EF değerleme sonucu SUNUM modeli — SAF (sunucu/istemci güvenli). K10 kuralları (docs/integrations/EMLAKFIYATI_ORTAK_API_V1.md §6):
 *  - `fiyat_yayin.guven_sinifi == "dusuk"` → "Düşük güven: kesin TL yok" + yalnız `guven_sunumu` aralığı/metni; null TL ASLA 0/"bilinmiyor" yazılmaz.
 *  - Fiyatlar İLAN fiyatlarına dayanır, gerçekleşen satış fiyatı DEĞİLDİR; "kesin değer/garanti/hızlı satış" dili YOK.
 *  - Değeri kendimiz hesaplamayız, eksik alanı doldurmayız; yalnız sunucunun gönderdiği alanlar gösterilir.
 * Motor çıktısının iç yapısı doğrulanmadığı için alanlar genel olarak (anahtar -> değer) listelenir.
 */
import type { OrtakValuationOk } from "@/lib/integrations/emlakfiyati/ortak-contract";

export const EF_LISTING_PRICE_NOTE = "Fiyatlar ilan fiyatlarına dayanır; gerçekleşen satış fiyatı değildir.";
export const EF_LOW_CONFIDENCE_TITLE = "Düşük güven: kesin TL yok";

export type EfLine = { label: string; value: string };
export type EfView = {
  dusukGuven: boolean;
  guvenEtiketi: string;
  /** Düşük güvende dolu: "Düşük güven: kesin TL yok". */
  baslik: string | null;
  /** `guven_sunumu`: aralık/sayı satırları. */
  sunumSatirlari: EfLine[];
  /** `guven_sunumu`: açıklama metinleri. */
  sunumMetinleri: string[];
  parsel: EfLine[];
  tahmin: EfLine[];
  emsal: EfLine[];
  konut: EfLine[];
  notlar: string[];
  /** Rapor geçerlilik bitişi (ISO) ve gün sayısı; gösterim biçimlendirmesi arayüzde. */
  expiresAt: string | null;
  gecerlilikGun: number | null;
};

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const MONEY_KEY_RE = /(?:tl|fiyat|tutar|deger|bedel|birim|ucret|alt_|ust_|min|max|aralik|dusuk|yuksek)/i;
const COUNT_KEY_RE = /(?:adet|sayi|gun|yuzde|oran|yil|kat|oda|m2)/i;

function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1) : key;
}

export function isMoneyKey(key: string): boolean {
  return MONEY_KEY_RE.test(key) && !COUNT_KEY_RE.test(key);
}

type Opts = { dusuk: boolean; max: number };

/** Nesneyi yaprak satırlarına düzleştirir. null para alanı: düşük güvende "Kesin TL yok" yazılır (ASLA 0/bilinmiyor); diğer null'lar atlanır. */
export function flattenLines(node: unknown, opts: Opts, prefix = "", depth = 0, out: EfLine[] = []): EfLine[] {
  if (out.length >= opts.max || depth > 4 || node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    node.slice(0, 5).forEach((n, i) => flattenLines(n, opts, `${prefix}${prefix ? " " : ""}${i + 1}`, depth + 1, out));
    return out;
  }
  if (typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (out.length >= opts.max) break;
    const label = prefix ? `${prefix} · ${humanize(k)}` : humanize(k);
    if (v === null || v === undefined) {
      if (opts.dusuk && isMoneyKey(k)) out.push({ label, value: "Kesin TL yok" });
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      out.push({ label, value: isMoneyKey(k) ? `${nf.format(v)} ₺` : nf.format(v) });
    } else if (typeof v === "string" && v.trim()) {
      out.push({ label, value: v.trim().slice(0, 300) });
    } else if (typeof v === "boolean") {
      out.push({ label, value: v ? "Evet" : "Hayır" });
    } else if (typeof v === "object") {
      flattenLines(v, opts, label, depth + 1, out);
    }
  }
  return out;
}

function sunumOf(node: unknown): { satirlar: EfLine[]; metinler: string[] } {
  const satirlar: EfLine[] = [];
  const metinler: string[] = [];
  const walk = (n: unknown, prefix: string, depth: number) => {
    if (n === null || n === undefined || depth > 3) return;
    if (typeof n === "string") {
      if (n.trim()) metinler.push(n.trim().slice(0, 400));
      return;
    }
    if (Array.isArray(n)) {
      n.slice(0, 6).forEach((x) => walk(x, prefix, depth + 1));
      return;
    }
    if (typeof n !== "object") return;
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      const label = prefix ? `${prefix} · ${humanize(k)}` : humanize(k);
      if (typeof v === "number" && Number.isFinite(v)) {
        satirlar.push({ label, value: COUNT_KEY_RE.test(k) && !isMoneyKey(k) ? nf.format(v) : `${nf.format(v)} ₺` });
      } else if (typeof v === "string") {
        if (v.trim()) metinler.push(v.trim().slice(0, 400));
      } else if (typeof v === "object") {
        walk(v, label, depth + 1);
      }
    }
  };
  walk(node, "", 0);
  return { satirlar: satirlar.slice(0, 8), metinler: metinler.slice(0, 5) };
}

export function guvenEtiketi(sinifi: string | null): string {
  switch (sinifi) {
    case "yuksek":
      return "Güven: yüksek";
    case "orta":
      return "Güven: orta";
    case "dusuk":
      return "Güven: düşük";
    default:
      return "Güven sınıfı bildirilmedi";
  }
}

export function presentValuation(r: OrtakValuationOk): EfView {
  const dusuk = r.dusukGuven;
  const sunum = sunumOf(r.guvenSunumu);
  const o: Opts = { dusuk, max: 16 };
  const fiyat = r.fiyatYayin && typeof r.fiyatYayin === "object" ? { ...(r.fiyatYayin as Record<string, unknown>) } : null;
  if (fiyat) {
    delete fiyat.guven_sunumu; // ayrı gösterilir
    delete fiyat.guven_sinifi;
  }
  const tahmin = [...flattenLines(r.tahmin, o), ...flattenLines(fiyat, { ...o, max: 12 })].slice(0, 20);
  return {
    dusukGuven: dusuk,
    guvenEtiketi: guvenEtiketi(r.guvenSinifi),
    baslik: dusuk ? EF_LOW_CONFIDENCE_TITLE : null,
    sunumSatirlari: sunum.satirlar,
    sunumMetinleri: sunum.metinler,
    parsel: flattenLines(r.parsel, { dusuk: false, max: 10 }),
    tahmin,
    emsal: flattenLines(r.emsaller, { dusuk: false, max: 10 }),
    konut: flattenLines(r.konutOzellikleri, { dusuk: false, max: 14 }),
    notlar: [EF_LISTING_PRICE_NOTE],
    expiresAt: r.expiresAt,
    gecerlilikGun: r.gecerlilikGun,
  };
}
