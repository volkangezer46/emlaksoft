import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";

/**
 * İçe aktarma geri alma yardımcıları (denetim B4): kayıt kaldırma bağlı-kayıt korumasıyla,
 * eski değere döndürme "kayıt sonradan düzenlendi mi" kontrolüyle yapılır; hiçbir hata yutulmaz,
 * sonuç sayaçlarında görünür.
 */

export type UndoTarget = "customers" | "properties" | "demands";

export const TABLE_BY_TARGET = {
  customers: "customers",
  properties: "properties",
  demands: "customer_demands",
} as const;

/** Geri alınırken kayda bağlı iş verisi varsa kayıt dokunulmadan bırakılır: [tablo, kayda işaret eden kolon]. */
export const LINK_CHECKS: Record<UndoTarget, readonly (readonly [string, string])[]> = {
  customers: [
    ["deals", "customer_id"],
    ["customer_demands", "customer_id"],
    ["appointments", "customer_id"],
    ["offers", "customer_id"],
    ["tasks", "customer_id"],
  ],
  properties: [
    ["deals", "property_id"],
    ["offers", "property_id"],
    ["appointments", "property_id"],
  ],
  demands: [["network_demands", "demand_id"]],
};

const ID_CHUNK = 200;
const RESTORE_PARALLEL = 10;

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type RemoveResult = { removed: number; skippedLinked: number; failed: number };

/** Bu kimliklerden bağlı kaydı olanları döndürür; sorgu hatasında HATA fırlatır (güvenli tarafta kalmak için). */
async function linkedIds(
  supabase: SupabaseClient,
  target: UndoTarget,
  tenantId: string,
  ids: string[],
): Promise<Set<string>> {
  const linked = new Set<string>();
  for (const [table, col] of LINK_CHECKS[target]) {
    const { data, error } = await supabase.from(table).select(col).eq("tenant_id", tenantId).in(col, ids);
    if (error) throw new Error(`link-check:${table}`);
    for (const row of (data ?? []) as unknown as Record<string, string | null>[]) {
      const v = row[col];
      if (v) linked.add(v);
    }
  }
  return linked;
}

export async function removeCreated(
  supabase: SupabaseClient,
  opts: { target: UndoTarget; tenantId: string; ids: string[]; checkLinks: boolean },
): Promise<RemoveResult> {
  const table = TABLE_BY_TARGET[opts.target];
  const res: RemoveResult = { removed: 0, skippedLinked: 0, failed: 0 };
  for (const part of chunked(opts.ids, ID_CHUNK)) {
    let ids = part;
    if (opts.checkLinks) {
      try {
        const linked = await linkedIds(supabase, opts.target, opts.tenantId, part);
        ids = part.filter((id) => !linked.has(id));
        res.skippedLinked += part.length - ids.length;
      } catch (e) {
        console.error("import undo link check", e);
        res.failed += part.length;
        continue;
      }
    }
    if (!ids.length) continue;
    const q =
      opts.target === "demands"
        ? supabase.from(table).delete()
        : supabase.from(table).update({ deleted_at: new Date(now()).toISOString() });
    let query = q.in("id", ids).eq("tenant_id", opts.tenantId);
    if (opts.target !== "demands") query = query.is("deleted_at", null);
    const { data, error } = await query.select("id");
    if (error) {
      console.error("import undo remove", opts.target, error);
      res.failed += ids.length;
    } else {
      res.removed += data?.length ?? 0;
    }
  }
  return res;
}

export type RestoreEntry = { id: string; prev: Record<string, unknown>; importAt: string };
export type RestoreResult = { restored: number; skippedEdited: number; failed: number };

/** Kayıt içe aktarmadan SONRA düzenlendiyse (updated_at > importAt) kullanıcı çalışması ezilmez. */
export function isEditedAfterImport(updatedAt: string | null | undefined, importAt: string): boolean {
  if (!updatedAt) return false;
  const u = Date.parse(updatedAt);
  const i = Date.parse(importAt);
  if (!Number.isFinite(u) || !Number.isFinite(i)) return true; // belirsizse ezme
  return u > i;
}

export async function restoreUpdated(
  supabase: SupabaseClient,
  opts: { target: UndoTarget; tenantId: string; entries: RestoreEntry[] },
): Promise<RestoreResult> {
  const table = TABLE_BY_TARGET[opts.target];
  const res: RestoreResult = { restored: 0, skippedEdited: 0, failed: 0 };
  for (const part of chunked(opts.entries, ID_CHUNK)) {
    const { data, error } = await supabase
      .from(table)
      .select("id, updated_at")
      .eq("tenant_id", opts.tenantId)
      .in("id", part.map((e) => e.id));
    if (error) {
      console.error("import undo restore read", error);
      res.failed += part.length;
      continue;
    }
    const current = new Map((data ?? []).map((r) => [r.id as string, r.updated_at as string | null]));
    const todo: RestoreEntry[] = [];
    for (const e of part) {
      if (!current.has(e.id)) {
        res.failed += 1; // kayıt yok/erişilemiyor
      } else if (isEditedAfterImport(current.get(e.id), e.importAt)) {
        res.skippedEdited += 1;
      } else {
        todo.push(e);
      }
    }
    for (const batch of chunked(todo, RESTORE_PARALLEL)) {
      await Promise.all(
        batch.map(async (e) => {
          const { error: upErr } = await supabase
            .from(table)
            .update(e.prev)
            .eq("id", e.id)
            .eq("tenant_id", opts.tenantId);
          if (upErr) {
            console.error("import undo restore", upErr);
            res.failed += 1;
          } else {
            res.restored += 1;
          }
        }),
      );
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Geri alma kilidi (audit tabanlı): migration olmadan çift çalışmayı engeller
// ---------------------------------------------------------------------------

export type RollbackLogRow = {
  id?: string | null;
  action: string;
  created_at: string;
  new_value: Record<string, unknown> | null;
};

/** Serbest bırakılmamış geri alma talepleri (eski → yeni, eşitlikte id sırasıyla). */
export function activeRollbackClaims(rows: RollbackLogRow[], batchId: string): string[] {
  const mine = rows.filter((r) => (r.new_value ?? {}).batch_id === batchId);
  const released = new Set(
    mine.filter((r) => r.action === "import.rollback.released").map((r) => String((r.new_value ?? {}).claim ?? "")),
  );
  return mine
    .filter((r) => r.action === "import.rollback")
    .sort((a, b) => (a.created_at === b.created_at ? String(a.id ?? "").localeCompare(String(b.id ?? "")) : a.created_at < b.created_at ? -1 : 1))
    .map((r) => String((r.new_value ?? {}).claim ?? ""))
    .filter((c) => !released.has(c));
}

/** Kilidi kazanan: serbest bırakılmamış en eski talep. Eski kayıtlarda (claim yok) boş dizge. */
export function claimWon(rows: RollbackLogRow[], batchId: string, claim: string): boolean {
  return activeRollbackClaims(rows, batchId)[0] === claim;
}
