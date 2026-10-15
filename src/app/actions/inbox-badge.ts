"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { isMissingFunctionError, recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { inboxBadgeHref } from "@/lib/inbox-badge";

const RPC = "inbox_conversations";

/**
 * Gelen kutusu "Yanıt bekliyor" rozeti (COM-01): yan menü ve mobil alt çubuk için TEK sayı. Kabuk akışını bekletmez:
 * istemci boşta çağırır (src/components/app/use-inbox-badge.ts). Kaynak gelen kutusunun kendi RPC'si
 * (`inbox_conversations`, SECURITY INVOKER + RLS; sayfa sayacıyla aynı tanım). Kapsam: ofis geneli roller tüm ofis,
 * diğerleri "Bana atananlar" (sayfadaki `danisman=ben` süzgeciyle aynı). Yetki/RPC yoksa ya da hata varsa `null`
 * (rozet çıkmaz; sahte sıfır yok).
 */
export async function getInboxWaitingBadge(): Promise<{ count: number; href: string } | null> {
  const gate = await requirePermission("calls", "view");
  if (!gate.ok || rpcKnownMissing(RPC)) return null;
  const mine = !hasOfficeWideDataScope(gate.role);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(RPC, {
    p_state: "bekliyor",
    p_assignee: mine ? gate.userId : null,
    p_q: null,
    p_limit: 1,
    p_offset: 0,
  });
  recordRpcOutcome(RPC, error);
  if (error) {
    if (!isMissingFunctionError(error)) console.error("inbox badge", error.message);
    return null;
  }
  const rows = (data ?? []) as Array<{ total_count?: number | string | null }>;
  const count = rows.length > 0 ? Number(rows[0]!.total_count ?? 0) : 0;
  return { count: Number.isFinite(count) ? count : 0, href: inboxBadgeHref(mine) };
}
