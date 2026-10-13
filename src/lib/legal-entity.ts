/**
 * Sağlayıcı (EmlakSoft işletmecisi) yasal kimlik bilgileri TEK KAYNAK: mesafeli satış sözleşmesi ve ön bilgilendirme
 * formu buradan okur. Değerler yalnız sunucu env'inden gelir (LEGAL_UNVAN, LEGAL_ADRES, LEGAL_MERSIS, LEGAL_VERGI,
 * LEGAL_KEP); koda bilgi YAZILMAZ ve uydurulmaz. Boş alan sayfada köşeli parantezli yer tutucu yerine
 * LEGAL_ENTITY_PENDING notuyla gösterilir (legal-placeholder-contract.test.ts).
 */
export type LegalEntityField = { key: "unvan" | "adres" | "mersis" | "vergi" | "kep"; label: string; value: string | null };

export const LEGAL_ENTITY_PENDING = "Şirket bilgileri tamamlanıyor; destek adresinden talep edebilirsiniz.";

function envValue(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function legalEntityFields(): LegalEntityField[] {
  return [
    { key: "unvan", label: "Ticari ünvan", value: envValue("LEGAL_UNVAN") },
    { key: "adres", label: "Adres", value: envValue("LEGAL_ADRES") },
    { key: "mersis", label: "MERSİS no", value: envValue("LEGAL_MERSIS") },
    { key: "vergi", label: "Vergi dairesi / vergi no", value: envValue("LEGAL_VERGI") },
    { key: "kep", label: "KEP adresi", value: envValue("LEGAL_KEP") },
  ];
}
