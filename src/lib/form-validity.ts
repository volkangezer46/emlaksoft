/**
 * Tarayıcı dilinden bağımsız Türkçe form doğrulama iletileri (B097e). Saf: DOM'a dokunmaz; çağıran alanın
 * `validity` bayraklarını ve özniteliklerini verir (TabbedFormShell `invalid` olayında `setCustomValidity` ile uygular).
 * en-US Chromium'da zorunlu alan uyarısı "Please fill out this field." çıkıyordu.
 */
export type ValidityFlags = Pick<
  ValidityState,
  "valueMissing" | "typeMismatch" | "patternMismatch" | "tooShort" | "tooLong" | "rangeUnderflow" | "rangeOverflow" | "stepMismatch" | "badInput"
>;

export type ValidityField = {
  /** input türü ("text", "email", "checkbox"...), `select` ya da `textarea`. */
  type: string;
  validity: ValidityFlags;
  value: string;
  title?: string | null;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
};

/** İlk başarısız kurala göre Türkçe ileti; geçerliyse `null` (tarayıcı iletisine dokunulmaz). */
export function turkishValidityMessage(f: ValidityField): string | null {
  const v = f.validity;
  if (v.valueMissing) {
    if (f.type === "checkbox") return "Devam etmek için bu kutuyu işaretleyin.";
    if (f.type === "radio" || f.type === "select" || f.type === "select-one" || f.type === "select-multiple") return "Lütfen bir seçim yapın.";
    if (f.type === "file") return "Lütfen bir dosya seçin.";
    return "Bu alan zorunlu.";
  }
  if (v.typeMismatch) {
    if (f.type === "email") return "Geçerli bir e-posta adresi girin (ör. ad@alan.com).";
    if (f.type === "url") return "Geçerli bir web adresi girin (ör. https://…).";
    return "Geçerli bir değer girin.";
  }
  if (v.patternMismatch) {
    // Boşluktan ibaret zorunlu metin (`pattern=".*\S.*"`) de buraya düşer.
    if (!f.value.trim()) return "Bu alan zorunlu.";
    return f.title?.trim() || "Lütfen istenen biçimde girin.";
  }
  if (v.tooShort) return `En az ${f.minLength ?? 0} karakter girin.`;
  if (v.tooLong) return `En çok ${f.maxLength ?? 0} karakter girilebilir.`;
  if (v.rangeUnderflow) return `Değer en az ${f.min ?? ""} olmalı.`;
  if (v.rangeOverflow) return `Değer en çok ${f.max ?? ""} olabilir.`;
  if (v.stepMismatch || v.badInput) return "Geçerli bir değer girin.";
  return null;
}
