/**
 * Katman birleştirme (SAF). Öncelik: karekod > XML > PDF metni > OCR > yapay zekâ. Üstteki kaynak alanı boşsa alttaki
 * kullanılır. Kaynaklar AYNI değeri veriyorsa güven artar; FARKLI değer veriyorsa üstteki kalır ve "çelişki" uyarısı
 * üretilir. İstisna: üst kaynağın güveni çok düşükken (< 0,55) alttaki güçlü (≥ 0,75) aday seçilir (ör. bulanık OCR'yi
 * yapay zekâ düzeltir).
 */
import { foldTr } from "./numbers";
import { SOURCE_LABEL, SOURCE_PRECEDENCE, type Field, type LayerFields, type ReceiptFieldKey, type ReceiptFields, type ReceiptWarning, type VatLine } from "./types";

const FIELD_LABEL: Record<ReceiptFieldKey, string> = {
  total: "Toplam",
  grossTotal: "Vergiler dahil toplam",
  net: "Matrah",
  vatTotal: "KDV",
  vatLines: "KDV kırılımı",
  vatWithholding: "KDV tevkifatı",
  incomeTaxWithholding: "Stopaj",
  currency: "Para birimi",
  date: "Tarih",
  time: "Saat",
  docType: "Belge türü",
  documentNo: "Belge no",
  ettn: "ETTN",
  sellerName: "Satıcı",
  sellerTaxId: "Satıcı VKN/TCKN",
  sellerTaxOffice: "Vergi dairesi",
  buyerName: "Alıcı",
  buyerTaxId: "Alıcı VKN/TCKN",
  paymentMethod: "Ödeme şekli",
  items: "Kalemler",
  zNo: "Z no",
};

export function fieldLabel(k: ReceiptFieldKey): string {
  return FIELD_LABEL[k];
}

function tokens(s: string): Set<string> {
  return new Set(foldTr(s).split(" ").filter((t) => t.length >= 2 && !/^(ltd|sti|as|a|s|tic|san|ve|ltd sti)$/.test(t)));
}

/** 0..1 ad benzerliği (Jaccard + kapsama). */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const jac = inter / (ta.size + tb.size - inter);
  const cover = inter / Math.min(ta.size, tb.size);
  return Math.max(jac, cover * 0.9);
}

function sameValue(key: ReceiptFieldKey, a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= Math.max(0.01, Math.abs(a) * 0.0005);
  if (key === "sellerName" || key === "buyerName" || key === "sellerTaxOffice") return nameSimilarity(String(a), String(b)) >= 0.75;
  if (typeof a === "string" && typeof b === "string") return a.replace(/\s/g, "").toUpperCase() === b.replace(/\s/g, "").toUpperCase();
  if (key === "vatLines") {
    const ra = (a as VatLine[]).map((l) => l.rate).sort().join(",");
    const rb = (b as VatLine[]).map((l) => l.rate).sort().join(",");
    return ra === rb;
  }
  if (key === "items") return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Uyarı üretmeyen alanlar (ikincil bilgi; farklı okunması olağan). */
const QUIET = new Set<ReceiptFieldKey>(["items", "time", "paymentMethod", "sellerTaxOffice", "buyerName", "docType", "currency"]);

export function mergeLayers(layers: readonly LayerFields[]): { fields: ReceiptFields; warnings: ReceiptWarning[] } {
  const rank = (f: Field<unknown>) => SOURCE_PRECEDENCE.indexOf(f.source);
  const keys = new Set<ReceiptFieldKey>();
  for (const l of layers) for (const k of Object.keys(l) as ReceiptFieldKey[]) if (l[k]) keys.add(k);
  const fields: Record<string, Field<unknown>> = {};
  const warnings: ReceiptWarning[] = [];

  for (const key of keys) {
    const cands = layers
      .map((l) => l[key] as Field<unknown> | undefined)
      .filter((c): c is Field<unknown> => !!c && c.value != null && c.value !== "")
      .sort((a, b) => rank(a) - rank(b) || b.confidence - a.confidence);
    if (!cands.length) continue;
    let winner = cands[0]!;
    if (winner.confidence < 0.55) {
      const strong = cands.find((c) => c !== winner && c.confidence >= 0.75);
      if (strong) winner = strong;
    }
    const agreeing = cands.filter((c) => c !== winner && sameValue(key, winner.value, c.value));
    const conflicting = cands.filter((c) => c !== winner && c.confidence >= 0.6 && !sameValue(key, winner.value, c.value));
    let confidence = winner.confidence;
    if (agreeing.length) confidence = Math.min(0.99, Math.max(confidence, ...agreeing.map((c) => c.confidence)) + 0.05 * agreeing.length);
    if (conflicting.length && !QUIET.has(key)) {
      confidence = Math.min(confidence, Math.max(0.5, confidence - 0.1));
      const other = conflicting[0]!;
      warnings.push({
        code: "conflict",
        field: key,
        message: `${FIELD_LABEL[key]}: ${SOURCE_LABEL[winner.source]} ile ${SOURCE_LABEL[other.source]} farklı okudu; değeri kontrol edin.`,
      });
    }
    fields[key] = { value: winner.value, confidence: Math.round(confidence * 100) / 100, source: winner.source };
  }
  return { fields: fields as ReceiptFields, warnings };
}
