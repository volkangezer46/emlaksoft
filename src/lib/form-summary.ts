/**
 * Sekmeli formların "Girilen bilgiler" özeti için saf görüntü mantığı (DOM'suz, birim testli).
 * DOM okuma `components/app/use-form-fields.ts`te; burada yalnız ham değer -> gösterim metni.
 */
import { formatPhoneDisplay } from "@/lib/phone";

export type FieldKind = "text" | "select" | "checkbox" | "radio";

export type FieldRead = {
  kind: FieldKind;
  /** FormData ham değeri (yoksa null). */
  raw: string | null;
  /** select/combobox/radio için seçili seçeneğin görünen etiketi. */
  selectedLabel?: string | null;
  /** checkbox işaretli mi. */
  checked?: boolean;
};

const PHONE_NAME = /(phone|tel|gsm|mobile)/i;

/** "2026-10-03" -> "03.10.2026"; "2026-10-03T14:30" -> "03.10.2026 14:30"; başka biçim -> null. */
export function formatDateValue(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(raw);
  if (!m) return null;
  const date = `${m[3]}.${m[2]}.${m[1]}`;
  return m[4] ? `${date} ${m[4]}:${m[5]}` : date;
}

/**
 * Özet satırında gösterilecek metin; boşsa null ("Girilmedi").
 * Telefon biçimlenir (formatPhoneDisplay), e-posta olduğu gibi, il/ilçe/mahalle ve seçimler etiketle,
 * onay kutusu Evet/Hayır, tarih GG.AA.YYYY.
 */
export function fieldDisplay(name: string, read: FieldRead): string | null {
  if (read.kind === "checkbox") return read.checked ? "Evet" : "Hayır";
  const raw = (read.raw ?? "").trim();
  if (!raw) return null;
  if ((read.kind === "select" || read.kind === "radio") && read.selectedLabel) {
    return read.selectedLabel.replace(/\s+/g, " ").trim() || null;
  }
  if (PHONE_NAME.test(name)) return formatPhoneDisplay(raw) || null;
  const date = formatDateValue(raw);
  if (date) return date;
  return raw.replace(/\s+/g, " ");
}

/** Etiket metnini temizler: zorunlu işareti (*) ve fazla boşluk atılır; boşsa null. */
export function cleanLabel(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
  return t || null;
}
