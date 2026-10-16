/**
 * Birleşmiş alanların akıllı doğrulaması (SAF): VKN/TCKN sağlaması, matrah + KDV ≈ toplam (kesintiler dahil), oran bazında
 * KDV = matrah × oran, tek oranda KDV = toplam × oran / (100 + oran), tarih makullüğü (gelecek değil, ≤ 1 yıl), yabancı
 * para. Tutarlı çapraz denetim güveni ARTIRIR, tutarsızlık uyarı üretir ve güveni düşürür. Değer DEĞİŞTİRİLMEZ.
 */
import { approxEqual, dayDiff, round2 } from "./numbers";
import { classifyTaxId } from "./tax-id";
import type { Field, LegacySuggestion, ReceiptFields, ReceiptWarning } from "./types";

const boost = <T>(f: Field<T> | undefined, by = 0.08): void => {
  if (f && f.source !== "karekod" && f.source !== "xml") f.confidence = Math.min(0.98, Math.round((f.confidence + by) * 100) / 100);
};
const cap = <T>(f: Field<T> | undefined, max: number): void => {
  if (f) f.confidence = Math.min(f.confidence, max);
};

export const fmtTry = (n: number): string => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function validateFields(input: ReceiptFields, todayIso: string): { fields: ReceiptFields; warnings: ReceiptWarning[] } {
  const f: ReceiptFields = structuredClone(input);
  const warnings: ReceiptWarning[] = [];

  for (const key of ["sellerTaxId", "buyerTaxId"] as const) {
    const fld = f[key];
    if (!fld) continue;
    const id = classifyTaxId(fld.value);
    if (!id) {
      delete f[key];
      continue;
    }
    if (!id.valid) {
      cap(fld, 0.45);
      warnings.push({
        code: id.kind === "vkn" ? "vkn_checksum" : "tckn_checksum",
        field: key,
        message: `${key === "sellerTaxId" ? "Satıcının" : "Alıcının"} ${id.kind === "vkn" ? "vergi kimlik numarası" : "T.C. kimlik numarası"} doğrulanamadı (sağlama tutmuyor). Rakamları belgeyle karşılaştırın.`,
      });
    } else if (fld.source !== "karekod" && fld.source !== "xml") boost(fld, 0.06);
  }

  const total = f.total?.value;
  const net = f.net?.value;
  const vat = f.vatTotal?.value;
  const wh = (f.vatWithholding?.value ?? 0) + (f.incomeTaxWithholding?.value ?? 0);
  const gross = f.grossTotal?.value;

  if (total != null && vat != null && vat > total + 0.01) {
    cap(f.vatTotal, 0.4);
    warnings.push({ code: "vat_mismatch", field: "vatTotal", message: "Okunan KDV toplamdan büyük görünüyor; KDV tutarını kontrol edin." });
  } else if (net != null && vat != null && (gross != null || total != null)) {
    const expectedGross = round2(net + vat);
    const ref = gross ?? round2((total ?? 0) + wh);
    if (approxEqual(expectedGross, ref, Math.max(0.05, ref * 0.002))) {
      boost(f.total);
      boost(f.net);
      boost(f.vatTotal);
    } else {
      cap(f.total, 0.75);
      warnings.push({
        code: "total_mismatch",
        field: "total",
        message: `Matrah + KDV (${fmtTry(expectedGross)}) belgedeki toplamla (${fmtTry(ref)}) tutmuyor; tutarları kontrol edin.`,
      });
    }
  } else if (total != null && vat != null && f.vatLines?.value.length === 1 && wh === 0) {
    const rate = f.vatLines.value[0]!.rate;
    if (rate > 0) {
      const expected = round2((total * rate) / (100 + rate));
      if (approxEqual(vat, expected, Math.max(0.05, expected * 0.01))) {
        boost(f.total);
        boost(f.vatTotal);
        boost(f.vatLines);
      } else if (Math.abs(vat - expected) > Math.max(0.5, expected * 0.03)) {
        warnings.push({
          code: "vat_mismatch",
          field: "vatTotal",
          message: `%${rate} oranla beklenen KDV ${fmtTry(expected)}, okunan ${fmtTry(vat)}. Birden çok oran olabilir; kontrol edin.`,
        });
        cap(f.vatLines, 0.6);
      }
    }
  }

  for (const line of f.vatLines?.value ?? []) {
    if (line.base == null || line.amount == null || line.rate <= 0) continue;
    const expected = round2((line.base * line.rate) / 100);
    if (!approxEqual(line.amount, expected, Math.max(0.05, expected * 0.01))) {
      warnings.push({ code: "vat_mismatch", field: "vatLines", message: `%${line.rate} KDV satırında matrah × oran (${fmtTry(expected)}) okunan KDV ile (${fmtTry(line.amount)}) tutmuyor.` });
      cap(f.vatLines, 0.6);
      break;
    }
  }

  if (f.date) {
    const diff = dayDiff(f.date.value, todayIso);
    if (diff > 1) {
      cap(f.date, 0.4);
      warnings.push({ code: "future_date", field: "date", message: "Belge tarihi ileri bir tarih görünüyor; tarihi kontrol edin." });
    } else if (diff < -366) {
      warnings.push({ code: "old_date", field: "date", message: "Belge bir yıldan eski. Tarihi ve ilgili dönemin kapalı olup olmadığını kontrol edin." });
      cap(f.date, f.date.source === "karekod" || f.date.source === "xml" ? 0.95 : 0.6);
    }
  }

  if (f.currency && f.currency.value !== "TRY") {
    warnings.push({ code: "foreign_currency", field: "currency", message: `Belge ${f.currency.value} cinsinden. Kaydederken para birimini ve kuru kontrol edin.` });
  }
  if (f.total && f.total.confidence < 0.7) {
    warnings.push({ code: "low_confidence", field: "total", message: "Toplam düşük güvenle okundu; kaydetmeden önce belgeyle karşılaştırın." });
  }
  return { fields: f, warnings };
}

/** Eski öneri biçimi (fiş kutusu, kayıt formunun boş alan doldurması). Yalnız ≥ 0,5 güvenli alanlar. */
export function toLegacySuggestion(f: ReceiptFields): LegacySuggestion {
  const out: LegacySuggestion = {};
  if (f.total && f.total.confidence >= 0.5 && f.total.value > 0) out.amount = f.total.value;
  if (f.date && f.date.confidence >= 0.5) out.date = f.date.value;
  const rates = f.vatLines?.value.map((l) => l.rate) ?? [];
  if (rates.length === 1 && (rates[0] === 1 || rates[0] === 10 || rates[0] === 20) && (f.vatLines?.confidence ?? 0) >= 0.5) out.vatRate = rates[0];
  if (f.sellerName && f.sellerName.confidence >= 0.5) out.vendor = f.sellerName.value;
  return out;
}
