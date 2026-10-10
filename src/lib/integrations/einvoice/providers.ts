/**
 * Yalnız GERÇEKTEN yazılmış sağlayıcılar listelenir (sahte "yakında" yok). İstemci güvenli (ağ/gizli veri yok).
 */
import type { EInvoiceMode, EInvoiceProviderId } from "./types";

export type ProviderField = {
  name: string;
  label: string;
  type: "text" | "password";
  hint?: string;
  autoComplete?: string;
};

export type ProviderMeta = {
  id: EInvoiceProviderId;
  name: string;
  summary: string;
  modes: EInvoiceMode[];
  /** Bağlantı formu alanları (sunucu action'ı bunları okur; gizli olanlar geri gösterilmez). */
  fields: ProviderField[];
  docTypes: string;
};

export const EINVOICE_PROVIDER_META: Record<EInvoiceProviderId, ProviderMeta> = {
  nilvera: {
    id: "nilvera",
    name: "Nilvera",
    summary: "Doğrudan entegratör: muhasebe programı gerekmez. API anahtarıyla bağlanır.",
    modes: ["sandbox", "live"],
    docTypes: "e-Fatura ve e-Arşiv",
    fields: [
      {
        name: "apiKey",
        label: "API anahtarı",
        type: "password",
        hint: "Nilvera panelinde oluşturduğunuz anahtar. Kaydedildikten sonra bir daha gösterilmez.",
        autoComplete: "off",
      },
    ],
  },
  parasut: {
    id: "parasut",
    name: "Paraşüt",
    summary:
      "Mevcut Paraşüt hesabınız üzerinden fatura keser. İstemci kimliği ve sırrını Paraşüt destekten (destek@parasut.com) alırsınız.",
    modes: ["live"],
    docTypes: "e-Fatura ve e-Arşiv",
    fields: [
      { name: "clientId", label: "İstemci kimliği (client_id)", type: "text", autoComplete: "off" },
      { name: "clientSecret", label: "İstemci sırrı (client_secret)", type: "password", autoComplete: "off" },
      { name: "companyId", label: "Firma numarası", type: "text", hint: "Paraşüt adres çubuğundaki firma numarası (yalnız rakam).", autoComplete: "off" },
      { name: "email", label: "Paraşüt e-postası", type: "text", hint: "Yalnız bir kez yetkilendirmek için kullanılır.", autoComplete: "off" },
      { name: "password", label: "Paraşüt parolası", type: "password", hint: "KAYDEDİLMEZ; yalnız yetkilendirme için kullanılır.", autoComplete: "off" },
    ],
  },
};

export const EINVOICE_PROVIDER_LIST = Object.values(EINVOICE_PROVIDER_META);

export function isProviderId(value: unknown): value is EInvoiceProviderId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EINVOICE_PROVIDER_META, value);
}

export const MODE_LABEL: Record<EInvoiceMode, string> = { sandbox: "Test", live: "Canlı" };
export const DOC_TYPE_LABEL = { "e-fatura": "e-Fatura", "e-arsiv": "e-Arşiv", "e-smm": "e-SMM" } as const;
