/**
 * GA-04 hızlı görev — Türkçe doğal dil: "yarın 10'da Ahmet'i ara" → başlık "Ahmet'i ara", vade yarın 10:00, tür arama,
 * kişi ipucu "Ahmet". SAF: tarih/saat çekirdeği `/app/hizli` ile aynı (`readWhen`, `note-fields.ts`).
 * Yanlış ayrıştırmaya karşı arayüz önizleme çipi gösterir ve çip kaldırılabilir (kaldırılınca ham başlık kaydedilir).
 */
import { readWhen } from "@/lib/field-capture/note-fields";

export type QuickTaskParse = {
  /** Tarih ifadesi çıkarılmış başlık (boşsa ham metin). */
  title: string;
  /** Vade (ISO) ve önizleme etiketi ("Yarın 10:00"); tarih yoksa null. */
  dueIso: string | null;
  dueLabel: string | null;
  /** Gün ya da saat varsayıldı (ör. yalnız "yarın" → 10:00). */
  assumed: boolean;
  /** Fiil "ara/arama" → arama görevi. */
  kind: "call" | null;
  /** Büyük harfli ad + ek ("Ahmet'i", "Ayşe Hanım'ı") → müşteri arama ipucu. */
  personHint: string | null;
};

/** Varsayılan saat: yalnız gün söylenirse 10:00 (ofis açılışı). */
const DEFAULT_HOUR = 10;

const L = "[A-Za-zÇĞİÖŞÜçğıöşü]";
const SUFFIX = String.raw`(?:\s*['’]?\s*(?:da|de|ta|te|dan|den|tan|ten|a|e|ya|ye))?`;
const DATE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:öbür\s*gün|ertesi\s*gün|yarından\s+sonra)${SUFFIX}(?!${L})`, "giu"),
  new RegExp(String.raw`\b(?:yarın|bugün|bu\s+akşam|bu\s+sabah|birazdan)${SUFFIX}(?!${L})`, "giu"),
  new RegExp(String.raw`\b(?:haftaya|gelecek\s+hafta|önümüzdeki\s+hafta)(?!${L})`, "giu"),
  new RegExp(String.raw`\b(?:pazartesi|salı|çarşamba|perşembe|cumartesi|cuma|pazar)(?:\s+günü)?${SUFFIX}(?!${L})`, "giu"),
  new RegExp(String.raw`\b\d{1,2}\s+(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)${SUFFIX}(?!${L})`, "giu"),
  new RegExp(String.raw`\b\d{1,2}\s+gün\s+sonra(?!${L})`, "giu"),
  /\bsaat\s+\d{1,2}(?:[:.]\d{2})?(?:\s*buçuk)?(?:\s*['’]?\s*(?:da|de|ta|te))?/giu,
  /(?<![\d.:])\d{1,2}[:.]\d{2}(?:\s*['’]?\s*(?:da|de|ta|te))?(?![\d])/giu,
  /(?<![\d.,+])\d{1,2}\s*['’]\s*(?:da|de|ta|te)(?![A-Za-zÇĞİÖŞÜçğıöşü])/giu,
  new RegExp(String.raw`\b(?:sabah|akşam|öğleden\s+sonra|öğlen?)(?!${L})`, "giu"),
];

const CALL_VERB = /(?:^|\s)(?:ara(?:yın|yalım|nacak|yacağım|sın)?|arama|geri\s+ara|telefon\s+et)(?![A-Za-zÇĞİÖŞÜçğıöşü])/iu;

/** Ad + iyelik/belirtme eki: "Ahmet'i", "Ayşe Hanım'ı", "Mehmet Bey'e". */
const PERSON = /([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+(?:Hanım|Bey|[A-ZÇĞİÖŞÜ][a-zçğıöşü]+))?)\s*['’]\s*(?:[ıiuü]|y[ıiuü]|[ae]|y[ae]|n[ıiuü]n|[ıiuü]n|l[ae]|yl[ae])(?![a-zçğıöşü])/u;

function stripDates(text: string): string {
  let out = text;
  for (const re of DATE_PATTERNS) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, "").trim();
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1) : s;
}

export function parseQuickTask(raw: string, nowMs: number): QuickTaskParse {
  const text = raw.replace(/\s+/g, " ").trim();
  const when = text ? readWhen(text, nowMs, DEFAULT_HOUR) : null;
  const stripped = when ? stripDates(text) : text;
  const title = capitalize(stripped || text).slice(0, 200);
  const person = PERSON.exec(text);
  const hint = person ? person[1]!.replace(/\s+(?:Hanım|Bey)$/u, "").trim() : null;
  return {
    title,
    dueIso: when?.iso ?? null,
    dueLabel: when?.label ?? null,
    assumed: Boolean(when?.assumed),
    kind: CALL_VERB.test(` ${text.toLocaleLowerCase("tr-TR")}`) ? "call" : null,
    personHint: hint && hint.length >= 2 ? hint : null,
  };
}
