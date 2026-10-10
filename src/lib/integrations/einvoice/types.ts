/**
 * e-Fatura entegrasyonu: SAF tipler (sunucu/istemci güvenli; ağ ve gizli veri YOK).
 * Tek sağlayıcı arayüzü `EInvoiceAdapter`; sağlayıcı uygulamaları nilvera.ts / parasut.ts.
 */

export const EINVOICE_PROVIDERS = ["nilvera", "parasut"] as const;
export type EInvoiceProviderId = (typeof EINVOICE_PROVIDERS)[number];

export const EINVOICE_MODES = ["sandbox", "live"] as const;
export type EInvoiceMode = (typeof EINVOICE_MODES)[number];

export type EInvoiceDocType = "e-fatura" | "e-arsiv" | "e-smm";

export const EINVOICE_SOURCE_TYPES = ["commission", "deal", "rent_management_fee", "free"] as const;
export type EInvoiceSourceType = (typeof EINVOICE_SOURCE_TYPES)[number];

/** Yerel fatura satırı durumu (taslak | resmileşti | hata | iptal). */
export type EInvoiceStatus = "draft" | "issued" | "error" | "cancelled";
/** Sağlayıcının resmi işlem durumu (resmileştirildikten sonra sorgulanır). */
export type EInvoiceProviderState = "none" | "waiting" | "succeeded" | "failed";

export type EInvoiceLine = {
  description: string;
  quantity: number;
  /** KDV HARİÇ birim fiyat. */
  unitPrice: number;
  /** KDV oranı (%): 0, 1, 8, 10, 20 ... kullanıcı seçer (varsayılan 20). */
  vatRate: number;
};

export type EInvoiceBuyer = {
  name: string;
  /** VKN (10 hane) veya TCKN (11 hane). */
  taxId: string;
  taxOffice?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
};

export type InvoiceDraft = {
  /** Bizim ürettiğimiz kalıcı kimlik (sağlayıcıya UUID olarak gider; yeniden denemede tekrar kullanılır). */
  uuid: string;
  docType: EInvoiceDocType;
  /** YYYY-MM-DD. */
  issueDate: string;
  buyer: EInvoiceBuyer;
  lines: EInvoiceLine[];
  note?: string | null;
  /** e-Fatura için alıcının posta kutusu (taxpayer sorgusundan). */
  alias?: string | null;
};

/** Sağlayıcıdaki belgeyi anlatan, DB'de `provider_ref` olarak tutulan başvuru. */
export type EInvoiceRef = {
  externalId: string;
  docType: EInvoiceDocType;
  alias?: string | null;
  /** Parasüt: oluşturma işi (trackable job) ve e-belge kimlikleri. */
  jobId?: string | null;
  eDocId?: string | null;
  eDocType?: "e_invoices" | "e_archives" | "e_smms" | null;
  /** Resmileştirildi mi (Nilvera PDF yolu taslak/resmi arasında değişir). */
  issued?: boolean;
};

export type AdapterErrorCode =
  | "not_supported" // sağlayıcı/alan doğrulanamadı ya da API sunmuyor
  | "unauthorized" // anahtar/oturum geçersiz
  | "not_found"
  | "rejected" // sağlayıcı isteği reddetti (doğrulama vb.)
  | "rate_limited"
  | "unavailable" // ağ/zaman aşımı/5xx
  | "invalid_response"
  | "invalid_input";

export type AdapterError = {
  code: AdapterErrorCode;
  /** Kullanıcıya gösterilebilir Türkçe mesaj (sağlayıcı gövdesi/anahtar içermez). */
  message: string;
  status?: number;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: AdapterError };

export type AdapterCapabilities = {
  eFatura: boolean;
  eArsiv: boolean;
  eSmm: boolean;
  sandbox: boolean;
  cancelDocTypes: EInvoiceDocType[];
};

export type RemoteState = "draft" | "waiting" | "succeeded" | "failed" | "cancelled";

export interface EInvoiceAdapter {
  readonly id: EInvoiceProviderId;
  readonly capabilities: AdapterCapabilities;
  testConnection(): Promise<Result<{ company: string }>>;
  lookupTaxpayer(taxId: string): Promise<Result<{ isEInvoiceUser: boolean; alias?: string }>>;
  createDraft(draft: InvoiceDraft): Promise<Result<{ ref: EInvoiceRef; number?: string }>>;
  issue(ref: EInvoiceRef): Promise<Result<{ ref: EInvoiceRef; number?: string }>>;
  getStatus(ref: EInvoiceRef): Promise<Result<{ state: RemoteState; number?: string; reason?: string; ref: EInvoiceRef }>>;
  getPdf(ref: EInvoiceRef): Promise<Result<{ bytes?: Uint8Array; url?: string }>>;
  /** Yalnız `capabilities.cancelDocTypes` içindeki türler için. */
  cancel?(ref: EInvoiceRef, reason: string): Promise<Result<void>>;
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: AdapterErrorCode, message: string, status?: number): Result<T> {
  return { ok: false, error: { code, message, ...(status !== undefined ? { status } : {}) } };
}
