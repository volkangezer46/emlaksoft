import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sağlayıcı SONUCUNU yazan e-Fatura RPC'leri yalnız service_role'e açıktır (20261012001000):
 * kullanıcı PostgREST'ten sahte "issued" yazamaz. Çağıran action, kullanıcı iznini
 * (`requirePermission("commissions","create")`) ve ofisi KENDİSİ doğruladıktan SONRA buraya gelir;
 * ofis her RPC'ye açıkça geçer ve SQL tarafı her UPDATE'i tenant_id ile sınırlar.
 */
type Ctx = { tenantId: string; actorId: string };
type RpcError = { code?: string; message?: string };
export type ServerWriteResult = { data: unknown; error: RpcError | null };

type WriteCall =
  | { fn: "einvoice_srv_record_progress"; args: { p_id: string; p_ref?: unknown; p_number?: string | null; p_error?: string | null; p_release?: boolean } }
  | { fn: "einvoice_srv_mark_issued"; args: { p_id: string; p_ref: unknown; p_number: string | null } }
  | {
      fn: "einvoice_srv_record_status";
      args: { p_id: string; p_status: string; p_provider_state: string | null; p_number: string | null; p_error: string | null; p_ref: unknown };
    }
  | { fn: "einvoice_srv_mark_cancelled"; args: { p_id: string; p_reason: string } }
  | { fn: "einvoice_srv_recover_issue"; args: { p_id: string; p_outcome: string; p_ref: unknown; p_number: string | null } };

export async function writeEInvoiceResult(ctx: Ctx, call: WriteCall): Promise<ServerWriteResult> {
  const admin = createAdminClient();
  const base = call.fn === "einvoice_srv_recover_issue" ? { p_tenant: ctx.tenantId } : { p_tenant: ctx.tenantId, p_actor: ctx.actorId };
  const { data, error } = await admin.rpc(call.fn, { ...base, ...call.args });
  return { data, error: error ? { code: error.code, message: error.message } : null };
}
