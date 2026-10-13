import "server-only";
import { getSettings } from "@/lib/settings/read";
import { LEGAL_ENTITY_KEYS } from "@/lib/settings/registry/legal";

/**
 * Sağlayıcı (EmlakSoft işletmecisi) yasal kimlik bilgileri TEK KAYNAK: mesafeli satış sözleşmesi, ön bilgilendirme
 * formu ve abonelik faturası başlığı buradan okur. Kaynak sırası: ayar defteri (`legal.entity_*`, /admin/ayarlar/yasal
 * ?sekme=sirket; ≤30 sn önbellek, deploy gerekmez) > sunucu env yedeği (LEGAL_UNVAN, LEGAL_ADRES, LEGAL_MERSIS,
 * LEGAL_VERGI_DAIRESI, LEGAL_VERGI_NO, eski birleşik LEGAL_VERGI, LEGAL_KEP, LEGAL_TELEFON). Koda bilgi YAZILMAZ ve
 * uydurulmaz: iki kaynak da boşsa alan listede hiç görünmez (legal-placeholder-contract.test.ts).
 */
export type LegalEntityKey = "unvan" | "adres" | "mersis" | "vergi" | "kep" | "telefon";
export type LegalEntityField = { key: LegalEntityKey; label: string; value: string };

export type LegalEntityRaw = {
  unvan: string;
  adres: string;
  mersis: string;
  vergiDairesi: string;
  vergiNo: string;
  kep: string;
  telefon: string;
};

function envValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function pick(setting: unknown, ...envNames: string[]): string {
  const s = typeof setting === "string" ? setting.trim() : "";
  if (s) return s;
  for (const n of envNames) {
    const v = envValue(n);
    if (v) return v;
  }
  return "";
}

/** SAF: ayar değerleri + env → ham kimlik (test edilebilir; boş = ""). */
export function resolveLegalEntity(settings: Record<string, unknown>): LegalEntityRaw {
  return {
    unvan: pick(settings["legal.entity_unvan"], "LEGAL_UNVAN"),
    adres: pick(settings["legal.entity_adres"], "LEGAL_ADRES"),
    mersis: pick(settings["legal.entity_mersis"], "LEGAL_MERSIS"),
    vergiDairesi: pick(settings["legal.entity_vergi_dairesi"], "LEGAL_VERGI_DAIRESI"),
    vergiNo: pick(settings["legal.entity_vergi_no"], "LEGAL_VERGI_NO"),
    kep: pick(settings["legal.entity_kep"], "LEGAL_KEP"),
    telefon: pick(settings["legal.entity_telefon"], "LEGAL_TELEFON"),
  };
}

/** SAF: gösterim satırları; boş alan atlanır. Vergi dairesi + no tek satırda (yoksa eski birleşik LEGAL_VERGI). */
export function entityFieldsFrom(raw: LegalEntityRaw): LegalEntityField[] {
  const vergi = [raw.vergiDairesi, raw.vergiNo].filter(Boolean).join(" / ") || envValue("LEGAL_VERGI");
  const rows: LegalEntityField[] = [
    { key: "unvan", label: "Ticari ünvan", value: raw.unvan },
    { key: "adres", label: "Adres", value: raw.adres },
    { key: "mersis", label: "MERSİS no", value: raw.mersis },
    { key: "vergi", label: "Vergi dairesi / vergi no", value: vergi },
    { key: "kep", label: "KEP adresi", value: raw.kep },
    { key: "telefon", label: "Telefon", value: raw.telefon },
  ];
  return rows.filter((r) => r.value);
}

export async function getLegalEntity(): Promise<LegalEntityRaw> {
  try {
    return resolveLegalEntity(await getSettings(LEGAL_ENTITY_KEYS));
  } catch {
    return resolveLegalEntity({}); // ayar okunamazsa env yedeği (derleme/sahte env dahil)
  }
}

/** Yasal sayfa / fatura başlığı satırları (yalnız dolu alanlar). */
export async function legalEntityFields(): Promise<LegalEntityField[]> {
  return entityFieldsFrom(await getLegalEntity());
}
