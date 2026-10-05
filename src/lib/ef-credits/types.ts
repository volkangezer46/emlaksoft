/**
 * EF kontör servisi — paylaşılan SONUÇ tipleri (SAF: sunucu/istemci güvenli; yalnız tip, çalışma zamanı kodu yok).
 * İstemci bileşenleri `service.ts`/`wallet.ts` (server-only) yerine BURADAN tip alır.
 */
import type {
  OrtakErrorKind,
  OrtakValuationInsufficient,
  OrtakValuationOk,
  OrtakValuationResult,
} from "@/lib/integrations/emlakfiyati/ortak-contract";

export type EfReportRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  rapor_id: string;
  reservation_id: string | null;
  mahalle_id: number | null;
  ada: string | null;
  parsel: string | null;
  tip: string | null;
  guven_sinifi: string | null;
  sonuc_durumu: string | null;
  units_charged: number;
  pdf_charged: boolean;
  pdf_reservation_id: string | null;
  created_at: string;
  expires_at: string | null;
};

export type RunValuationResult =
  | {
      status: "ok";
      result: OrtakValuationOk;
      raporId: string;
      unitsCharged: number;
      replayed: boolean;
      requestId: string | null;
      /** commit yazılamadı (rapor verildi; kontör süpürücüde serbest kalır, mutabakatta izlenir). */
      settlementPending: boolean;
    }
  | { status: "insufficient"; result: OrtakValuationInsufficient; requestId: string | null; refunded: boolean }
  | { status: "no_credit"; available: number; needed: number }
  | { status: "invalid"; message: string }
  | { status: "disabled"; message: string; missing: string[] }
  | { status: "error"; kind: OrtakErrorKind; code: string | null; message: string; requestId: string | null; refunded: boolean };

export type ReportDetailResult =
  | { status: "ok"; result: OrtakValuationResult; row: EfReportRow; requestId: string | null; unitsCharged: number }
  | { status: "not_found" | "expired"; message: string }
  | { status: "no_credit"; available: number; needed: number }
  | { status: "disabled"; message: string; missing: string[] }
  | { status: "error"; kind: OrtakErrorKind; code: string | null; message: string; requestId: string | null };
