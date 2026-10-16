/**
 * Yapay zekâ katmanının istem şeması ve yanıt çözümleyicisi (SAF). Model yalnız AÇIKÇA okunan değeri döndürür; her alan
 * için 0..1 güven verir. Yanıttaki her değer burada yeniden doğrulanır (tutar aralığı, tarih biçimi, VKN/TCKN hanesi,
 * oran listesi); maske yer tutucusu ([TELEFON_1] vb.) içeren metin reddedilir. AI güveni en çok 0,9'a ölçeklenir:
 * kesin katmanlar (karekod/XML/PDF) her zaman önce gelir.
 */
import { parseReceiptDate, parseTrAmount, parseVendor } from "@/lib/finance/ocr/parse-receipt";
import { classifyTaxId } from "./tax-id";
import { isKnownVatRate, round2 } from "./numbers";
import type { LayerFields, LineItem, PaymentMethod, ReceiptDocType, VatLine } from "./types";

export const AI_SYSTEM_PROMPT =
  "Türk fiş, fatura, makbuz ve banka dekontlarından YALNIZ belgede açıkça yazan bilgiyi çıkaran bir muhasebe asistanısın. " +
  "Okuyamadığın ya da emin olmadığın her alanı null bırak; asla tahmin etme, hesaplama yapıp alan uydurma. Yalnız geçerli JSON döndür.";

export const AI_USER_PROMPT = `Belgeden şu JSON'u çıkar (tutarlar belgede yazdığı gibi metin; tarih GG.AA.YYYY ya da YYYY-AA-GG):
{
  "belge_turu": "okc_fis" | "e_arsiv" | "e_fatura" | "fatura" | "makbuz" | "smm" | "dekont" | "diger" | null,
  "belge_no": string | null,
  "ettn": string | null,
  "tarih": string | null,
  "saat": string | null,
  "para_birimi": "TRY" | "USD" | "EUR" | null,
  "toplam": string | null,            // ÖDENECEK / GENEL TOPLAM (KDV dahil, kesintiler düşülmüş)
  "vergiler_dahil_toplam": string | null,
  "matrah": string | null,            // KDV hariç toplam
  "kdv_toplam": string | null,
  "kdv_kirilimi": [{ "oran": number, "matrah": string | null, "kdv": string | null }],
  "kdv_tevkifat": string | null,
  "gv_stopaj": string | null,
  "satici_unvan": string | null,
  "satici_vkn_tckn": string | null,
  "satici_vergi_dairesi": string | null,
  "alici_unvan": string | null,
  "alici_vkn_tckn": string | null,
  "odeme_sekli": "nakit" | "kart" | "havale" | "diger" | null,
  "kalemler": [{ "ad": string, "miktar": number | null, "tutar": string | null, "kdv_orani": number | null }],
  "guven": { "<alan_adı>": number }  // her doldurduğun alan için 0..1
}
Kalemler en çok 20 olsun. Belge fiş/fatura değilse tüm alanları null yap.`;

const DOC_TYPES: readonly ReceiptDocType[] = ["okc_fis", "e_arsiv", "e_fatura", "fatura", "makbuz", "smm", "dekont", "diger"];
const PAY: readonly PaymentMethod[] = ["nakit", "kart", "havale", "diger"];
const MASK = /\[[A-Z_]+_\d+\]/;

export function parseAiReceipt(raw: string | null | undefined, todayIso: string): LayerFields {
  if (!raw) return {};
  let o: Record<string, unknown>;
  try {
    const v = JSON.parse(raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    o = v as Record<string, unknown>;
  } catch {
    return {};
  }
  const g = (o.guven && typeof o.guven === "object" ? o.guven : {}) as Record<string, unknown>;
  const conf = (key: string, fallback = 0.7) => {
    const c = Number(g[key]);
    const base = Number.isFinite(c) && c >= 0 && c <= 1 ? c : fallback;
    return round2(Math.min(0.9, base * 0.92));
  };
  const src = "ai" as const;
  const f: LayerFields = {};
  const str = (k: string) => (typeof o[k] === "string" && !MASK.test(o[k] as string) ? (o[k] as string).trim() : null);

  const total = parseTrAmount(o.toplam);
  if (total != null) f.total = { value: total, confidence: conf("toplam"), source: src };
  const gross = parseTrAmount(o.vergiler_dahil_toplam);
  if (gross != null) f.grossTotal = { value: gross, confidence: conf("vergiler_dahil_toplam"), source: src };
  const net = parseTrAmount(o.matrah);
  if (net != null) f.net = { value: net, confidence: conf("matrah"), source: src };
  const vat = parseTrAmount(o.kdv_toplam);
  if (vat != null) f.vatTotal = { value: vat, confidence: conf("kdv_toplam"), source: src };
  const wh = parseTrAmount(o.kdv_tevkifat);
  if (wh != null) f.vatWithholding = { value: wh, confidence: conf("kdv_tevkifat"), source: src };
  const gv = parseTrAmount(o.gv_stopaj);
  if (gv != null) f.incomeTaxWithholding = { value: gv, confidence: conf("gv_stopaj"), source: src };

  if (Array.isArray(o.kdv_kirilimi)) {
    const lines: VatLine[] = [];
    for (const l of o.kdv_kirilimi.slice(0, 6)) {
      if (!l || typeof l !== "object") continue;
      const rate = Number((l as Record<string, unknown>).oran);
      if (!Number.isFinite(rate) || !isKnownVatRate(rate)) continue;
      lines.push({ rate, base: parseTrAmount((l as Record<string, unknown>).matrah), amount: parseTrAmount((l as Record<string, unknown>).kdv) });
    }
    if (lines.length) f.vatLines = { value: lines, confidence: conf("kdv_kirilimi"), source: src };
  }

  const date = parseReceiptDate(o.tarih, todayIso);
  if (date) f.date = { value: date, confidence: conf("tarih"), source: src };
  const saat = str("saat");
  if (saat && /^([01]\d|2[0-3])[:.][0-5]\d/.test(saat)) f.time = { value: saat.slice(0, 5).replace(".", ":"), confidence: conf("saat"), source: src };
  const cur = str("para_birimi")?.toUpperCase();
  if (cur && /^(TRY|USD|EUR|GBP)$/.test(cur)) f.currency = { value: cur, confidence: conf("para_birimi", 0.8), source: src };
  const dt = str("belge_turu");
  if (dt && (DOC_TYPES as readonly string[]).includes(dt)) f.docType = { value: dt as ReceiptDocType, confidence: conf("belge_turu"), source: src };
  const no = str("belge_no");
  if (no && /^[A-Za-z0-9/-]{1,30}$/.test(no)) f.documentNo = { value: no.toUpperCase(), confidence: conf("belge_no"), source: src };
  const ettn = str("ettn")?.toLowerCase();
  if (ettn && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ettn)) f.ettn = { value: ettn, confidence: conf("ettn"), source: src };
  const seller = parseVendor(str("satici_unvan"));
  if (seller) f.sellerName = { value: seller, confidence: conf("satici_unvan"), source: src };
  const sTax = classifyTaxId(str("satici_vkn_tckn"));
  if (sTax) f.sellerTaxId = { value: sTax.value, confidence: conf("satici_vkn_tckn"), source: src };
  const office = parseVendor(str("satici_vergi_dairesi"));
  if (office) f.sellerTaxOffice = { value: office.slice(0, 60), confidence: conf("satici_vergi_dairesi"), source: src };
  const buyer = parseVendor(str("alici_unvan"));
  if (buyer) f.buyerName = { value: buyer, confidence: conf("alici_unvan"), source: src };
  const bTax = classifyTaxId(str("alici_vkn_tckn"));
  if (bTax) f.buyerTaxId = { value: bTax.value, confidence: conf("alici_vkn_tckn"), source: src };
  const pay = str("odeme_sekli");
  if (pay && (PAY as readonly string[]).includes(pay)) f.paymentMethod = { value: pay as PaymentMethod, confidence: conf("odeme_sekli"), source: src };

  if (Array.isArray(o.kalemler)) {
    const items: LineItem[] = [];
    for (const it of o.kalemler.slice(0, 20)) {
      if (!it || typeof it !== "object") continue;
      const r = it as Record<string, unknown>;
      const name = parseVendor(r.ad);
      if (!name) continue;
      const q = Number(r.miktar);
      const rate = Number(r.kdv_orani);
      items.push({ name: name.slice(0, 80), quantity: Number.isFinite(q) && q > 0 ? q : null, total: parseTrAmount(r.tutar), vatRate: Number.isFinite(rate) && isKnownVatRate(rate) ? rate : null });
    }
    if (items.length) f.items = { value: items, confidence: conf("kalemler", 0.6), source: src };
  }
  return f;
}
