/**
 * Şube karşılaştırma (/app/franchise) rollup'ı: şube başına portföy/müşteri sayısı + dönemdeki işlem toplam/kazanılan
 * ve kazanılan hacim. Hızlı yol `branch_rollup` RPC'si (P5, migration 20261016110300; SECURITY INVOKER → RLS çağıranın
 * yetkisiyle) tek GROUP BY turudur. RPC yoksa/hata verirse `null` döner; sayfa eski sayfalı taramaya düşer ve aynı
 * katlamayı `foldBranchRollup` ile yapar (rpc-probe deseni). Sahte sıfır üretilmez: bozuk yanıt da `null`.
 *
 * Anahtar `branch_id` (null = şubesiz). Pasif/görünmeyen şube kimliklerini "Şubesiz"e katlamak çağıranın işidir.
 */
import { recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";

export const BRANCH_ROLLUP_RPC = "branch_rollup";

export type BranchRollupCounts = { properties: number; customers: number; dealsTotal: number; won: number; wonValue: number };
export type BranchRollup = Map<string | null, BranchRollupCounts>;

type RpcResult = { data: unknown; error: { code?: string | null; message?: string | null } | null };
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };

const empty = (): BranchRollupCounts => ({ properties: 0, customers: 0, dealsTotal: 0, won: 0, wonValue: 0 });

function num(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Eski sayfa katlaması (RPC yokken yedek yol ve SQL eşdeğerlik testi için tek kaynak):
 * portföy/müşteri `branch_id`'ye göre; işlemler atanan danışmanın AKTİF profilindeki şubeye göre (profil yoksa null),
 * kazanılan = stage 'won', hacim = deal_value (boşsa 0). Satırlar çağıranın süzdüğü kümedir (silinmemiş / dönem).
 */
export function foldBranchRollup(input: {
  properties: readonly { branch_id?: string | null }[];
  customers: readonly { branch_id?: string | null }[];
  deals: readonly { assigned_to?: string | null; stage?: string | null; deal_value?: number | string | null }[];
  activeProfiles: readonly { id: string; branch_id?: string | null }[];
}): BranchRollup {
  const out: BranchRollup = new Map();
  const at = (b: string | null | undefined) => {
    const key = b ?? null;
    let row = out.get(key);
    if (!row) out.set(key, (row = empty()));
    return row;
  };
  const advisorBranch = new Map(input.activeProfiles.map((p) => [p.id, p.branch_id ?? null]));
  for (const p of input.properties) at(p.branch_id).properties += 1;
  for (const c of input.customers) at(c.branch_id).customers += 1;
  for (const d of input.deals) {
    const row = at(d.assigned_to ? advisorBranch.get(d.assigned_to) ?? null : null);
    row.dealsTotal += 1;
    if (d.stage !== "won") continue;
    row.won += 1;
    row.wonValue += Number(d.deal_value || 0);
  }
  return out;
}

export function parseBranchRollup(raw: unknown): BranchRollup | null {
  if (!Array.isArray(raw)) return null;
  const out: BranchRollup = new Map();
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") return null;
    const b = r.branch_id;
    if (b !== null && typeof b !== "string") return null;
    const properties = num(r.properties);
    const customers = num(r.customers);
    const dealsTotal = num(r.deals_total);
    const won = num(r.deals_won);
    const wonValue = num(r.won_value);
    if (properties === null || customers === null || dealsTotal === null || won === null || wonValue === null) return null;
    out.set(b, { properties, customers, dealsTotal, won, wonValue });
  }
  return out;
}

/** Tek turda şube rollup'ı; `fromIso`/`toIso` işlem dönemi (her iki uç dahil, null = sınırsız). */
export async function loadBranchRollup(
  supabase: RpcClient,
  args: { fromIso: string | null; toIso: string | null },
): Promise<BranchRollup | null> {
  if (rpcKnownMissing(BRANCH_ROLLUP_RPC)) return null;
  try {
    const res = await supabase.rpc(BRANCH_ROLLUP_RPC, { p_from: args.fromIso, p_to: args.toIso });
    recordRpcOutcome(BRANCH_ROLLUP_RPC, res.error);
    if (res.error || res.data == null) return null;
    return parseBranchRollup(res.data);
  } catch {
    return null;
  }
}
