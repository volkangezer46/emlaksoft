import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APPROVAL_KINDS, DEFAULT_APPROVAL_POLICY, isDelegationActive, type ApprovalPolicy } from "@/lib/approvals";
import { APPROVAL_AUTO_KEYS, APPROVAL_POLICY_KEYS, approvalSlaKey } from "@/lib/settings/registry/tenant";
import { readTenantSettings } from "@/lib/settings/tenant-read";

/**
 * Onay politikası okuyucusu (OA12). İstemciyi ÇAĞIRAN verir (sayfa/eylem: oturumlu istemci, RLS ile kendi ofisi);
 * her sorgu `tenant_id` süzgeçlidir. Ayar yoksa/okunamazsa varsayılan politika (otomatik onay KAPALI) döner.
 */
export async function loadApprovalPolicy(db: SupabaseClient, tenantId: string): Promise<ApprovalPolicy> {
  try {
    const v = await readTenantSettings(db, tenantId, APPROVAL_POLICY_KEYS);
    const num = (key: string, fallback: number) => {
      const n = v[key];
      return typeof n === "number" && Number.isFinite(n) ? n : fallback;
    };
    const sla = { ...DEFAULT_APPROVAL_POLICY.slaHours };
    for (const kind of APPROVAL_KINDS) sla[kind] = num(approvalSlaKey(kind), sla[kind]);
    return {
      slaHours: sla,
      autoMaxCommissionPoints: num(APPROVAL_AUTO_KEYS.commissionPoints, 0),
      autoMaxExpenseTry: num(APPROVAL_AUTO_KEYS.expenseTry, 0),
      autoMaxPriceDropPct: num(APPROVAL_AUTO_KEYS.priceDropPct, 0),
    };
  } catch {
    return DEFAULT_APPROVAL_POLICY;
  }
}

export type ApprovalDelegation = {
  delegateId: string;
  delegateName: string | null;
  untilOn: string;
  note: string | null;
  active: boolean;
};

/**
 * Ofisin vekil onaylayıcısı. `available:false` = tablo yok (migration 20261019080003 uygulanmamış): ekran vekil
 * formunu "kurulum bekliyor" ile gösterir, karar yetkisi eski kurala göre kalır.
 */
export async function loadApprovalDelegation(
  db: SupabaseClient,
  tenantId: string,
  todayKey: string,
): Promise<{ available: boolean; delegation: ApprovalDelegation | null }> {
  const { data, error } = await db
    .from("approval_delegations")
    .select("delegate_id, until_on, note, delegate:profiles!approval_delegations_delegate_id_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return { available: false, delegation: null };
  if (!data) return { available: true, delegation: null };
  const row = data as { delegate_id: string; until_on: string; note: string | null; delegate: { full_name: string | null } | { full_name: string | null }[] | null };
  const person = Array.isArray(row.delegate) ? row.delegate[0] : row.delegate;
  return {
    available: true,
    delegation: {
      delegateId: row.delegate_id,
      delegateName: person?.full_name ?? null,
      untilOn: row.until_on,
      note: row.note,
      active: isDelegationActive({ delegate_id: row.delegate_id, until_on: row.until_on }, todayKey),
    },
  };
}
