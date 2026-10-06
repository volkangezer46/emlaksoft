import type { InsightDraft } from "@/lib/insights/types";

/**
 * LLM çıktısı için SAF doğrulayıcılar (sunucu modülü içermez; vitest ile doğrudan test edilir).
 *
 * "Sayıları yalnızca verilen maddelerden al" istemi tek başına yetmez: kod, çıktıdaki her sayının
 * girdide geçtiğini doğrular; geçmiyorsa çıktı REDDEDİLİR ve kural metnine dönülür.
 */

/** Türkçe/İngilizce biçimli sayıları ("1.250.000", "3,5", "%12", "42") yalın rakam dizisine çevirir. */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  const re = /\d[\d.,]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Sondaki noktalama (cümle sonu nokta/virgül) sayıya ait değildir.
    const raw = m[0].replace(/[.,]+$/, "");
    if (raw) out.push(normalizeNumber(raw));
  }
  return out;
}

/** "1.250.000" -> "1250000", "3,5" -> "3.5", "12" -> "12" (baştaki sıfırlar atılır). */
export function normalizeNumber(raw: string): string {
  let s = raw;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // Son ayırıcı ondalıktır.
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasDot) {
    // "1.250.000" (binlik) mi, "3.5" (ondalık) mi: 3 haneli gruplarsa binliktir.
    s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  s = s.replace(/^0+(?=\d)/, "");
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** Çıktıdaki TÜM sayılar girdide geçiyor mu? (Çıktıda sayı yoksa true.) */
export function outputNumbersAreGrounded(output: string, input: string): boolean {
  const allowed = new Set(extractNumbers(input));
  return extractNumbers(output).every((n) => allowed.has(n));
}

/** Kelime sayısı sınırı (anlatım kısa kalmalı). */
export function withinWordLimit(text: string, maxWords: number): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length <= maxWords;
}

/**
 * LLM çıktısını kabul et / reddet. Reddedilirse null (çağıran kural metnine döner).
 * Boş, aşırı uzun, girdide olmayan sayı içeren çıktı reddedilir.
 */
export function acceptNarrative(output: string | null | undefined, input: string, opts: { maxWords: number }): string | null {
  const text = output?.trim();
  if (!text) return null;
  if (!withinWordLimit(text, opts.maxWords)) return null;
  if (!outputNumbersAreGrounded(text, input)) return null;
  return text;
}

/** Modele giden metin: yalnız başlık + kural gerekçesi + sayısal kanıt etiketleri (saf, testli). */
export function buildNarrativeInput(draft: Pick<InsightDraft, "title" | "why" | "evidence">): string {
  const lines = [`Başlık: ${draft.title}`, `Özet: ${draft.why}`];
  if (draft.evidence.length > 0) {
    lines.push("Kanıtlar:");
    for (const e of draft.evidence) lines.push(`- ${e.label}: ${e.value}`);
  }
  return lines.join("\n");
}
