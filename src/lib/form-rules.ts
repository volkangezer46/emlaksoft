/**
 * Alanlar arası zorunluluk kuralları ("müşteri ya da portföyden en az biri") — saf, istemci + sunucu ortak.
 *
 * Tek alanlık `required` tarayıcı doğrulamasıyla çözülür; birden çok alana bağlı kural bunu yapamaz.
 * Bu tür kurallar `FormRuleIssue[]` döndürür: TabbedFormShell bunları "N eksik" sayacına ve eksik listesine
 * ekler, gönderimi durdurup ilk eksik alana odaklanır; server action AYNI fonksiyonla reddeder.
 */

export type FormRuleIssue = {
  /** Kuralın kimliği (anahtar; React key ve test için). */
  key: string;
  /** Eksik listesinde görünen ad ("Müşteri ya da portföy"). */
  label: string;
  /** Alanın bulunduğu sekme id'si. */
  tab: string;
  /** Odaklanılacak alan: DOM id ya da name (Combobox için tetikleyici id'si). */
  field: string;
};

/** Sunucu hatası: "Eksik alan: Tutar, Müşteri ya da portföy." */
export function missingFieldsError(issues: readonly Pick<FormRuleIssue, "label">[]): string {
  return `Eksik alan: ${issues.map((i) => i.label).join(", ")}.`;
}

/** Boşluk dışı içerik var mı (FormData / form değeri). */
export function hasValue(v: FormDataEntryValue | string | null | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}
