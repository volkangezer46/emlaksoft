import { policyForRpc } from "../check-state-machine";
import type { ListingControlConfig } from "../config";
import { listingCheckToResult, type ListingCheckResult } from "../adapters/types";
import { CHECK_RESULTS, SOURCE_KINDS, type CheckResultKind, type SourceKind } from "../types";
import { isMissingSchema, type Db } from "./db";
import { syncProperties } from "./sync";

/**
 * Kontrol SONUCU işleme (idempotent). `lc_complete_listing_check` RPC'si durum makinesini tek transaction'da uygular
 * (FOR UPDATE; aynı job iki kez işlenirse 'replay'); ardından portföy motoru çalışır (anomali aç/kapat + KPI bayrakları).
 * service_role istemcisi ÇAĞIRAN tarafından verilir (cron/ajan API). Kullanıcının elle doğrulaması
 * `submitManualCheck` ile kullanıcı oturumundan yapılır (RPC JWT'den ofis/kullanıcı çıkarır).
 */

export type ProcessCheckInput = {
  tenantId: string;
  listingId: string;
  result: CheckResultKind;
  sourceKind: SourceKind;
  clientId?: string | null;
  jobId?: string | null;
  /** Yalnız izinli alanlar: price, title, advisor_name, status, error_code. Ham HTML/kişisel veri YOK. */
  observed?: { price?: number | null; title?: string | null; advisor_name?: string | null; status?: string | null; error_code?: string | null };
  evidenceHash?: string | null;
  checkedAtIso?: string | null;
};

export type ProcessCheckOutcome =
  | { ok: true; outcome: "applied" | "replay"; propertyId?: string; stateAfter?: string; stateChanged?: boolean; confidence?: number }
  | { ok: false; outcome: string };

/** Gözlem alanlarını boyut/tip olarak sınırlar (kuyruk istemcisinden gelen veriye güvenilmez). */
export function sanitizeObserved(raw: unknown): Record<string, unknown> {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof o.price === "number" && Number.isFinite(o.price) && o.price > 0 && o.price < 1e12) out.price = o.price;
  for (const [key, max] of [["title", 300], ["advisor_name", 120], ["status", 40], ["error_code", 60]] as const) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim().slice(0, max);
  }
  return out;
}

export async function processCheckResult(db: Db, cfg: ListingControlConfig, input: ProcessCheckInput, nowMs: number): Promise<ProcessCheckOutcome> {
  if (!CHECK_RESULTS.includes(input.result) || !SOURCE_KINDS.includes(input.sourceKind)) return { ok: false, outcome: "invalid_input" };
  const { data, error } = await db.rpc("lc_complete_listing_check", {
    p_tenant_id: input.tenantId,
    p_listing_id: input.listingId,
    p_result: input.result,
    p_source_kind: input.sourceKind,
    p_client_id: input.clientId ?? null,
    p_job_id: input.jobId ?? null,
    p_observed: sanitizeObserved(input.observed),
    p_evidence_hash: input.evidenceHash ? input.evidenceHash.slice(0, 128) : null,
    p_policy: policyForRpc(cfg.stateMachine, cfg.cadence.normalHours),
    p_checked_at: input.checkedAtIso ?? null,
  });
  if (error) {
    if (!isMissingSchema(error)) console.error("lc_complete_listing_check", { code: error.code });
    return { ok: false, outcome: isMissingSchema(error) ? "schema_missing" : "rpc_error" };
  }
  const r = (data ?? {}) as { outcome?: string; property_id?: string; state_after?: string; state_changed?: boolean; confidence?: number };
  if (r.outcome === "replay") return { ok: true, outcome: "replay" };
  if (r.outcome !== "applied" || !r.property_id) return { ok: false, outcome: r.outcome ?? "unknown" };
  // Durum değişimi ya da başarılı gözlem portföy motorunu tetikler (anomali anında açılır/kapanır).
  await syncProperties(db, input.tenantId, [r.property_id], cfg, nowMs);
  return { ok: true, outcome: "applied", propertyId: r.property_id, stateAfter: r.state_after, stateChanged: r.state_changed, confidence: r.confidence };
}

/** Adaptör `ListingCheckResult`'ını RPC girdisine çevirir (found=null/hata → ASLA "yok" değil). */
export function fromAdapterResult(
  tenantId: string,
  listingId: string,
  sourceKind: SourceKind,
  r: ListingCheckResult,
  extra: { clientId?: string | null; jobId?: string | null } = {},
): ProcessCheckInput {
  return {
    tenantId,
    listingId,
    sourceKind,
    result: listingCheckToResult(r),
    clientId: extra.clientId ?? null,
    jobId: extra.jobId ?? null,
    observed: { price: r.price, title: r.title, advisor_name: r.advisorName, error_code: r.error },
    checkedAtIso: r.seenAt,
  };
}
