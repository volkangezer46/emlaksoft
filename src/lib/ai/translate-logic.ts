import { extractNumbers, normalizeNumber } from "@/lib/ai/narrative-guard";

/**
 * İlan metni çevirisi — SAF mantık (sunucu modülü içermez; vitest ile doğrudan test edilir).
 *
 * Çeviri yalnız TASLAKTIR: kayda yazılmaz, kullanıcı panelde düzenler/kopyalar. Etiket: "AI çevirisi".
 * Sayı koruması: çıktıdaki her sayı kaynakta geçmelidir (fiyat, m², oda, telefon kuyruğu vb. değişmemeli).
 */

export type TranslateLang = "en" | "de" | "ar" | "ru";

export const TRANSLATE_LANGS: { code: TranslateLang; label: string; promptName: string }[] = [
  { code: "en", label: "İngilizce", promptName: "English" },
  { code: "de", label: "Almanca", promptName: "German" },
  { code: "ar", label: "Arapça", promptName: "Arabic" },
  { code: "ru", label: "Rusça", promptName: "Russian" },
];

export const TRANSLATE_MAX_SOURCE_CHARS = 6000;

export function isTranslateLang(v: unknown): v is TranslateLang {
  return typeof v === "string" && TRANSLATE_LANGS.some((l) => l.code === v);
}

export function translateLangLabel(code: TranslateLang): string {
  return TRANSLATE_LANGS.find((l) => l.code === code)?.label ?? code;
}

export const TRANSLATION_LABEL = "AI çevirisi";
export const TRANSLATION_NOTICE = "AI çevirisi — yayınlamadan önce kontrol edin. Kayda yazılmaz; yalnız kopyalayabilirsiniz.";

/** Doğu Arap ve Fars rakamlarını Batı rakamlarına çevirir (sayı doğrulaması için). */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function buildTranslateMessages(text: string, lang: TranslateLang): { system: string; user: string } {
  const target = TRANSLATE_LANGS.find((l) => l.code === lang)!.promptName;
  return {
    system:
      `You are a professional real-estate translator. Translate the Turkish listing text into ${target}. ` +
      "Rules: keep every number, price, area (m²), room count and code EXACTLY as written (use Western digits 0-9); " +
      "keep placeholders such as [TELEFON_1] untouched; do not add, remove or embellish facts; keep line breaks, bullets and hashtags; " +
      "output only the translation, no commentary.",
    user: text,
  };
}

export type TranslationCheck = { ok: true; text: string } | { ok: false; error: string };

/** Çeviriyi kabul/reddet: boş, aşırı uzun veya kaynakta olmayan sayı içeren çıktı reddedilir. */
export function checkTranslation(output: string | null | undefined, source: string): TranslationCheck {
  const text = (output ?? "").trim();
  if (!text) return { ok: false, error: "Çeviri üretilemedi. Lütfen tekrar deneyin." };
  if (text.length > source.length * 3 + 400) {
    return { ok: false, error: "Çeviri beklenenden uzun çıktı; güvenlik için reddedildi. Tekrar deneyin." };
  }
  const allowed = new Set(extractNumbers(normalizeDigits(source)).map(normalizeNumber));
  const extra = extractNumbers(normalizeDigits(text)).filter((n) => !allowed.has(n));
  if (extra.length > 0) {
    return { ok: false, error: "Çeviride kaynak metinde olmayan sayılar var; güvenlik için reddedildi. Tekrar deneyin." };
  }
  return { ok: true, text };
}
