/**
 * Sağlayıcı durumundan yerel satır güncellemesi (SAF; DB/ağ yok). Server action ve cron aynı kuralı kullanır.
 */
import type { EInvoiceProviderState, EInvoiceRef, EInvoiceStatus, RemoteState } from "./types";

export type StatusSnapshot = {
  status: EInvoiceStatus;
  provider_state: EInvoiceProviderState;
  number: string | null;
  error: string | null;
};

export type StatusPatch = {
  status: EInvoiceStatus;
  provider_state: EInvoiceProviderState;
  number: string | null;
  error: string | null;
  provider_ref: EInvoiceRef;
};

export function applyRemoteStatus(
  current: StatusSnapshot,
  remote: { state: RemoteState; number?: string; reason?: string; ref: EInvoiceRef },
): StatusPatch {
  const number = remote.number ?? current.number;
  switch (remote.state) {
    case "succeeded":
      return { status: "issued", provider_state: "succeeded", number, error: null, provider_ref: remote.ref };
    case "failed":
      return {
        status: "error",
        provider_state: "failed",
        number,
        error: (remote.reason ?? "Sağlayıcı belgeyi kabul etmedi.").slice(0, 500),
        provider_ref: remote.ref,
      };
    case "cancelled":
      return { status: "cancelled", provider_state: "succeeded", number, error: null, provider_ref: remote.ref };
    case "waiting":
      return { status: "issued", provider_state: "waiting", number, error: null, provider_ref: remote.ref };
    case "draft":
    default:
      // Sağlayıcıda henüz resmi belge yok: yerel durum değişmez.
      return { status: current.status, provider_state: current.provider_state, number, error: current.error, provider_ref: remote.ref };
  }
}

/** Cron bekleme eşiği: beklemede olan belgeler en erken bu süre sonra yeniden sorulur. */
export const STATUS_RECHECK_MS = 5 * 60 * 1000;
export const STATUS_SYNC_BATCH = 25;
