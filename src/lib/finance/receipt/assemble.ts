/**
 * Çıkarım derleyici (SAF): katman çıktıları → birleştirme → doğrulama → (çağıranın verdiği) kategori/cari/mükerrer
 * önerileri → saklanabilir `ReceiptExtraction`. Saklanan JSON ham metin İÇERMEZ (KVKK): yalnız alanlar, güven ve kaynak.
 */
import { mergeLayers } from "./merge";
import { validateFields } from "./validate";
import type { AiState, CategorySuggestion, DuplicateHit, LayerFields, LayerReport, PartySuggestion, ReceiptExtraction, ReceiptFields, ReceiptWarning } from "./types";

export function assembleExtraction(input: {
  layers: readonly LayerFields[];
  reports: readonly LayerReport[];
  todayIso: string;
  nowIso: string;
  ai: AiState;
}): ReceiptExtraction {
  const merged = mergeLayers(input.layers);
  const checked = validateFields(merged.fields, input.todayIso);
  return {
    version: 1,
    fields: checked.fields,
    layers: [...input.reports],
    warnings: dedupeWarnings([...checked.warnings, ...merged.warnings]),
    duplicates: [],
    ai: input.ai,
    extractedAt: input.nowIso,
  };
}

export function withSuggestions(x: ReceiptExtraction, s: { category?: CategorySuggestion; party?: PartySuggestion; duplicates?: DuplicateHit[] }): ReceiptExtraction {
  const out: ReceiptExtraction = { ...x, category: s.category ?? x.category, party: s.party ?? x.party, duplicates: s.duplicates ?? x.duplicates };
  const warnings = out.warnings.filter((w) => w.code !== "duplicate");
  if (out.duplicates.length) warnings.unshift({ code: "duplicate", message: "Bu belge daha önce kaydedilmiş olabilir. Aşağıdaki eşleşmeyi kontrol edin." });
  out.warnings = warnings;
  return out;
}

function dedupeWarnings(ws: ReceiptWarning[]): ReceiptWarning[] {
  const seen = new Set<string>();
  return ws.filter((w) => {
    const k = `${w.code}|${w.field ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Alan sayısı (arayüz "N alan okundu"). */
export function fieldCount(f: ReceiptFields): number {
  return Object.values(f).filter(Boolean).length;
}

/** Saklama sınırı (DB denetimi 32 KB); aşılırsa kalemler ve ikincil alanlar atılır. */
export function compactForStorage(x: ReceiptExtraction, maxBytes = 30_000): ReceiptExtraction {
  let out = x;
  const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
  if (size(out) <= maxBytes) return out;
  const fields = { ...out.fields };
  delete fields.items;
  out = { ...out, fields };
  if (size(out) <= maxBytes) return out;
  out = { ...out, warnings: out.warnings.slice(0, 5), duplicates: out.duplicates.slice(0, 2), layers: out.layers.slice(0, 5) };
  return out;
}

/** Saklanan JSON'u güvenle geri okur (sürüm/şekil uymuyorsa null). */
export function readStoredExtraction(json: unknown): ReceiptExtraction | null {
  if (!json || typeof json !== "object") return null;
  const x = json as Partial<ReceiptExtraction>;
  if (x.version !== 1 || !x.fields || typeof x.fields !== "object") return null;
  return {
    version: 1,
    fields: x.fields,
    layers: Array.isArray(x.layers) ? x.layers : [],
    warnings: Array.isArray(x.warnings) ? x.warnings : [],
    category: x.category,
    party: x.party,
    duplicates: Array.isArray(x.duplicates) ? x.duplicates : [],
    ai: x.ai ?? "off",
    extractedAt: typeof x.extractedAt === "string" ? x.extractedAt : "",
  };
}
