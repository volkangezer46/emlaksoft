import type { SupabaseClient } from "@supabase/supabase-js";
import { TRY_MOVEMENTS_VIEW, TRY_RPC, tryOverviewSchema, type TryOverview } from "./config";

/**
 * Ofis OKUMA katmanı: oturumlu (RLS'li) istemci ile çalışır, service_role KULLANMAZ.
 * Bakiye `try_credit_my_overview()` (authenticated, yalnız kendi tenant'ı), hareketler `try_credit_movements`
 * görünümü (security_invoker; idempotency_key/meta yok). SQL henüz uygulanmamışsa ikisi de `null`/boş döner:
 * çağıran sayfa "etkin değil" gösterir, ASLA fırlatmaz.
 */

export async function readTryOverview(supabase: Pick<SupabaseClient, "rpc">): Promise<TryOverview | null> {
  try {
    const { data, error } = await supabase.rpc(TRY_RPC.myOverview);
    if (error) return null;
    const p = tryOverviewSchema.safeParse(data);
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** Ham hareket satırı (görünümün sütunları). */
export type TryMovementRow = {
  id: number;
  entryType: string;
  amount: number;
  source: string;
  feature: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export const TRY_MOVEMENT_FETCH_LIMIT = 200;

export function normalizeMovementRow(raw: Record<string, unknown>): TryMovementRow | null {
  const id = Number(raw.id);
  const amount = Number(raw.amount);
  const createdAt = typeof raw.created_at === "string" ? raw.created_at : "";
  if (!Number.isFinite(id) || !Number.isFinite(amount) || !createdAt) return null;
  return {
    id,
    entryType: String(raw.entry_type ?? ""),
    amount,
    source: String(raw.source ?? ""),
    feature: typeof raw.feature === "string" ? raw.feature : null,
    expiresAt: typeof raw.expires_at === "string" ? raw.expires_at : null,
    createdAt,
  };
}

export async function readTryMovements(
  supabase: Pick<SupabaseClient, "from">,
  limit = TRY_MOVEMENT_FETCH_LIMIT,
): Promise<TryMovementRow[]> {
  try {
    const { data, error } = await supabase
      .from(TRY_MOVEMENTS_VIEW)
      .select("id, entry_type, amount, source, feature, expires_at, created_at")
      .order("id", { ascending: false })
      .limit(limit);
    if (error) return [];
    return ((data ?? []) as Record<string, unknown>[])
      .map(normalizeMovementRow)
      .filter((r): r is TryMovementRow => r !== null);
  } catch {
    return [];
  }
}
