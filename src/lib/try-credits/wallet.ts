import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TRY_IDEM_PATTERN,
  TRY_RPC,
  tryBalanceSchema,
  tryGrantResultSchema,
  tryInvoiceHoldSchema,
  tryRefundResultSchema,
  tryReserveResultSchema,
  tryReverseResultSchema,
  trySettleResultSchema,
  type TryBalance,
  type TryGrantKind,
  type TryGrantResult,
  type TryInvoiceHold,
  type TryRefundResult,
  type TryReserveResult,
  type TryReverseResult,
  type TrySettleResult,
} from "./config";

/**
 * TL HESAP KREDİSİ cüzdanı — RPC sarmalayıcıları. Bu dosya kendi service_role istemcisini YARATMAZ: istemci
 * ÇAĞIRAN tarafından verilir (service_role kullanımı allowlist'te kayıtlı mevcut işlevlerde kalır; yeni kullanım YOK).
 * FAIL-CLOSED: hiçbiri fırlatmaz; cüzdan/RPC yoksa ya da hata olursa `null`/`false` döner ve çağıran para akışını AÇMAZ.
 * Kişisel veri YAZILMAZ: yalnız kimlikler, tutarlar, neden kodları.
 */

type Rpc = Pick<SupabaseClient, "rpc">;

/** PostgREST "fonksiyon yok" (migration uygulanmamış). */
export function isMissingRpc(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

async function call<T>(
  client: Rpc,
  fn: string,
  args: Record<string, unknown> | undefined,
  parse: (data: unknown) => T | null,
): Promise<T | null> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) return null;
    return parse(data);
  } catch {
    return null;
  }
}

/** SQL şeması hazır mı? (service_role kimliği gerekir.) false/hata → kredi akışı KAPALI. */
export async function tryCreditReady(client: Rpc): Promise<boolean> {
  try {
    const { data, error } = await client.rpc(TRY_RPC.ready);
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function tryBalance(client: Rpc, tenantId: string): Promise<TryBalance | null> {
  return call(client, TRY_RPC.balance, { p_tenant: tenantId }, (d) => {
    const p = tryBalanceSchema.safeParse(d);
    return p.success ? p.data : null;
  });
}

export type TryGrantInput = {
  tenantId: string;
  amountTry: number;
  kind: TryGrantKind;
  /** (tenant, idem) tekil: yeniden deneme AYNI anahtarı kullanır. 8-128, [A-Za-z0-9_.:-]. */
  idem: string;
  /** Opsiyonel vade (gelecekte olmalı). İlk yazılan geçerlidir; yeniden denemede karşılaştırılmaz. */
  expiresAt?: string | null;
  /** Kişisel veri İÇERMEYEN teknik alanlar. */
  meta?: Record<string, string | number | boolean | null> | null;
};

export async function tryGrant(client: Rpc, input: TryGrantInput): Promise<TryGrantResult | null> {
  if (!TRY_IDEM_PATTERN.test(input.idem) || !(input.amountTry > 0)) return null;
  return call(
    client,
    TRY_RPC.grant,
    {
      p_tenant: input.tenantId,
      p_amount: input.amountTry,
      p_kind: input.kind,
      p_idem: input.idem,
      p_expires_at: input.expiresAt ?? null,
      p_meta: input.meta ?? null,
    },
    (d) => {
      const p = tryGrantResultSchema.safeParse(d);
      return p.success ? p.data : null;
    },
  );
}

export type TryReserveInput = {
  tenantId: string;
  userId: string | null;
  amountTry: number;
  idem: string;
  invoiceId: string;
  /** Faturada kredinin en yüksek payı (0, 1]. */
  maxShare: number;
};

/** `null` = cüzdan yazılamadı (FAIL-CLOSED: çağıran krediyi UYGULAMAZ). */
export async function tryReserve(client: Rpc, input: TryReserveInput): Promise<TryReserveResult | null> {
  if (!TRY_IDEM_PATTERN.test(input.idem) || !(input.amountTry > 0)) return null;
  return call(
    client,
    TRY_RPC.reserve,
    {
      p_tenant: input.tenantId,
      p_user: input.userId,
      p_amount: input.amountTry,
      p_idem: input.idem,
      p_invoice: input.invoiceId,
      p_max_share: input.maxShare,
    },
    (d) => {
      const p = tryReserveResultSchema.safeParse(d);
      return p.success ? p.data : null;
    },
  );
}

export async function tryCommit(
  client: Rpc,
  tenantId: string,
  reservationId: string,
  ref: Record<string, string | number | boolean | null> | null = null,
): Promise<TrySettleResult | null> {
  return call(client, TRY_RPC.commit, { p_tenant: tenantId, p_reservation: reservationId, p_ref: ref }, (d) => {
    const p = trySettleResultSchema.safeParse(d);
    return p.success ? p.data : null;
  });
}

export async function tryRelease(client: Rpc, tenantId: string, reservationId: string, reason: string): Promise<TrySettleResult | null> {
  return call(client, TRY_RPC.release, { p_tenant: tenantId, p_reservation: reservationId, p_reason: reason }, (d) => {
    const p = trySettleResultSchema.safeParse(d);
    return p.success ? p.data : null;
  });
}

export type TryReverseInput = {
  tenantId: string;
  amountTry: number;
  reason: string;
  idem: string;
  /** Geri alınan grant'in idem anahtarı: verilirse toplam geri alma grant tutarını AŞAMAZ. */
  originalIdem?: string | null;
  meta?: Record<string, string | number | boolean | null> | null;
};

/** CLAWBACK: bakiye eksiye düşebilir (eksi bakiye harcanamaz). */
export async function tryReverse(client: Rpc, input: TryReverseInput): Promise<TryReverseResult | null> {
  if (!TRY_IDEM_PATTERN.test(input.idem) || !(input.amountTry > 0) || !input.reason.trim()) return null;
  return call(
    client,
    TRY_RPC.reverse,
    {
      p_tenant: input.tenantId,
      p_amount: input.amountTry,
      p_reason: input.reason,
      p_idem: input.idem,
      p_original_idem: input.originalIdem ?? null,
      p_meta: input.meta ?? null,
    },
    (d) => {
      const p = tryReverseResultSchema.safeParse(d);
      return p.success ? p.data : null;
    },
  );
}

/**
 * Faturanın en son kredi rezervi. `{has_hold:false}` = kredi YOK ya da SQL henüz uygulanmamış (RPC yok).
 * `null` = bilinmeyen hata (çağıran FAIL-CLOSED davranır: para akışını sürdürmez).
 */
export async function tryInvoiceHold(client: Rpc, tenantId: string, conversationId: string): Promise<TryInvoiceHold | null> {
  try {
    const { data, error } = await client.rpc(TRY_RPC.invoiceHold, { p_tenant: tenantId, p_conversation_id: conversationId });
    if (error) return isMissingRpc(error) ? { has_hold: false } : null;
    const p = tryInvoiceHoldSchema.safeParse(data);
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

export async function tryReleaseInvoice(client: Rpc, tenantId: string, invoiceId: string, reason: string): Promise<TrySettleResult | null> {
  return call(client, TRY_RPC.releaseInvoice, { p_tenant: tenantId, p_invoice: invoiceId, p_reason: reason }, (d) => {
    const p = trySettleResultSchema.safeParse(d);
    return p.success ? p.data : null;
  });
}

/** void/expired faturaların açık rezervlerini bırakır; bırakılan sayı ya da null. */
export async function tryReleaseDead(client: Rpc, limit = 500): Promise<number | null> {
  return call(client, TRY_RPC.releaseDead, { p_limit: limit }, (d) => (typeof d === "number" && Number.isFinite(d) ? d : null));
}

export type TryRefundInput = {
  tenantId: string;
  invoiceId: string;
  /** null = harcanan kredinin kalanının tamamı. */
  amountTry: number | null;
  idem: string;
  reason: string;
};

export async function tryRefundInvoice(client: Rpc, input: TryRefundInput): Promise<TryRefundResult | null> {
  if (!TRY_IDEM_PATTERN.test(input.idem)) return null;
  return call(
    client,
    TRY_RPC.refundInvoice,
    {
      p_tenant: input.tenantId,
      p_invoice: input.invoiceId,
      p_amount: input.amountTry,
      p_idem: input.idem,
      p_reason: input.reason,
    },
    (d) => {
      const p = tryRefundResultSchema.safeParse(d);
      return p.success ? p.data : null;
    },
  );
}

/** Rezerv idem anahtarı: fatura başına TEK (yeniden deneme aynı rezerve çözülür). */
export function tryReserveIdem(invoiceId: string): string {
  return `inv-${invoiceId}`;
}

/** İade geri yazma idem anahtarı (kısmi iadeler için `seq` ayrı). */
export function tryRefundIdem(invoiceId: string, seq: string | number): string {
  return `refund-${invoiceId}-${seq}`;
}
