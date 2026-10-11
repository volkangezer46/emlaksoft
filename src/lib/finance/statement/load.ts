import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import type { ColumnMapping } from "./parse";
import { shiftIso, type CollectionCandidate, type EntryCandidate, type MatchLine, type RuleCandidate } from "./match";

/**
 * Ekstre taslağı + mutabakat okuyucuları (kullanıcı oturumu, RLS). Şema (migration 20261011001200) yoksa `available:false` döner
 * ve arayüz "Ekstre yükle"yi göstermez. Bu dosya istemci OLUŞTURMAZ.
 */

export type ReconStatus = {
  account_id: string;
  last_reconciled_at: string | null;
  unreconciled_count: number;
  pending_lines: number;
  has_import: boolean;
  coverage_from: string | null;
  coverage_to: string | null;
};

export async function loadReconStatus(supabase: SupabaseClient): Promise<{ available: boolean; byAccount: Map<string, ReconStatus> }> {
  const { data, error } = await supabase.rpc("finance_reconciliation_status");
  const byAccount = new Map<string, ReconStatus>();
  if (error) {
    if (!isMissingCashSchema(error)) console.error("loadReconStatus", { code: error.code });
    return { available: false, byAccount };
  }
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    byAccount.set(String(r.account_id), {
      account_id: String(r.account_id),
      last_reconciled_at: (r.last_reconciled_at as string | null) ?? null,
      unreconciled_count: Number(r.unreconciled_count ?? 0),
      pending_lines: Number(r.pending_lines ?? 0),
      has_import: Boolean(r.has_import),
      coverage_from: (r.coverage_from as string | null) ?? null,
      coverage_to: (r.coverage_to as string | null) ?? null,
    });
  }
  return { available: true, byAccount };
}

export type PendingLine = MatchLine & { importId: string; balance: number | null };

export async function loadPendingLines(supabase: SupabaseClient, accountId: string): Promise<PendingLine[]> {
  const { data, error } = await supabase
    .from("finance_statement_lines")
    .select("id, import_id, line_date, direction, amount, description, balance_after")
    .eq("account_id", accountId)
    .eq("status", "pending")
    .order("line_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) {
    if (!isMissingCashSchema(error)) console.error("loadPendingLines", { code: error.code });
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    importId: String(r.import_id),
    date: String(r.line_date),
    dir: r.direction as "in" | "out",
    amount: Number(r.amount),
    description: String(r.description ?? ""),
    balance: r.balance_after === null || r.balance_after === undefined ? null : Number(r.balance_after),
  }));
}

export async function loadSavedMapping(supabase: SupabaseClient, accountId: string): Promise<Partial<ColumnMapping> | null> {
  const { data } = await supabase.from("finance_statement_mappings").select("mapping").eq("account_id", accountId).maybeSingle();
  const m = (data as { mapping?: unknown } | null)?.mapping;
  if (!m || typeof m !== "object") return null;
  const out: Partial<ColumnMapping> = {};
  for (const key of ["date", "description", "amount", "debit", "credit", "balance"] as const) {
    const v = (m as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 100) out[key] = v;
  }
  return out;
}

export type LoadedMatchContext = { entries: EntryCandidate[]; collections: CollectionCandidate[]; rules: RuleCandidate[] };

/** Satırların tarih aralığına göre eşleştirme adayları. `withCollections`: yalnız ofis hesabında komisyon/kira/aidat tahsilatı aranır. */
export async function loadMatchContext(
  supabase: SupabaseClient,
  accountId: string,
  lines: readonly MatchLine[],
  withCollections: boolean,
): Promise<LoadedMatchContext> {
  const empty: LoadedMatchContext = { entries: [], collections: [], rules: [] };
  if (lines.length === 0) return empty;
  const dates = lines.map((l) => l.date).sort();
  const from = shiftIso(dates[0]!, -3);
  const to = shiftIso(dates[dates.length - 1]!, 3);

  const [entriesRes, rulesRes, rentRes, bldRes, commRes] = await Promise.all([
    supabase
      .from("cash_entries")
      .select("id, entry_date, direction, amount, title, counterparty")
      .eq("account_id", accountId)
      .is("voided_at", null)
      .is("reconciled_at", null)
      .in("kind", ["income", "expense", "transfer"])
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: true })
      .limit(1000),
    supabase.from("recurring_rules").select("id, direction, amount, pay_day, title, category").eq("account_id", accountId).eq("active", true).limit(200),
    withCollections
      ? supabase.from("rent_payments").select("id, paid_on, amount, receipt_no").is("voided_at", null).gte("paid_on", from).lte("paid_on", to).limit(500)
      : Promise.resolve({ data: [] as unknown[] }),
    withCollections
      ? supabase.from("building_payments").select("id, paid_on, amount, receipt_no").is("voided_at", null).gte("paid_on", from).lte("paid_on", to).limit(500)
      : Promise.resolve({ data: [] as unknown[] }),
    withCollections
      ? supabase.from("commissions").select("id, gross_amount, vat_amount, status").gte("created_at", `${shiftIso(from, -365)}T00:00:00Z`).limit(1000)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const entries = ((entriesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    date: String(r.entry_date),
    dir: r.direction as "in" | "out",
    amount: Number(r.amount),
    title: String(r.title ?? ""),
    counterparty: (r.counterparty as string | null) ?? null,
  }));
  const rules = ((rulesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    dir: r.direction as "in" | "out",
    amount: Number(r.amount),
    payDay: Number(r.pay_day),
    title: String(r.title ?? ""),
    category: String(r.category ?? ""),
  }));

  const collections: CollectionCandidate[] = [];
  if (withCollections) {
    for (const r of (rentRes.data ?? []) as Record<string, unknown>[]) {
      collections.push({ source: "rent", id: String(r.id), date: String(r.paid_on), amounts: [Number(r.amount)], label: `Kira tahsilatı (makbuz ${r.receipt_no})` });
    }
    for (const r of (bldRes.data ?? []) as Record<string, unknown>[]) {
      collections.push({ source: "building", id: String(r.id), date: String(r.paid_on), amounts: [Number(r.amount)], label: `Aidat tahsilatı (makbuz ${r.receipt_no})` });
    }
    for (const r of (commRes.data ?? []) as Record<string, unknown>[]) {
      const gross = Number(r.gross_amount);
      const settled = r.status === "paid" || r.status === "collected";
      collections.push({
        source: "commission", id: String(r.id), date: null, amounts: [gross, gross + Number(r.vat_amount ?? 0)],
        label: settled ? "Tahsil edilmiş komisyon (kasaya bağlı değil)" : "Komisyon tutarıyla eşleşiyor",
      });
    }
    // Herhangi bir hesaba (başka hesap dahil) zaten işlenmiş tahsilatlar tekrar önerilmez: tahsil edilmiş ve kasaya bağlı komisyon aday değildir;
    // tahsil edilmiş ama kasaya bağlanmamış olan kalır (kullanıcı hangi hesaba girdiğini ekstreden bağlar).
    const usedKeys = await linkedSourceKeys(supabase, collections);
    return { entries, rules, collections: collections.filter((c) => !usedKeys.has(`${c.source}:${c.id}`)) };
  }
  return { entries, rules, collections };
}

const LINK_CHUNK = 100;

/** `source_type:source_id` anahtarları; geçersiz kılınmamış (voided_at null) kasa hareketine bağlı kaynaklar. Uzun `in(...)` URL'si sessizce
 *  boş dönüp tekrar önermesin diye 100'lük parçalarla sorgulanır. */
async function linkedSourceKeys(supabase: SupabaseClient, collections: readonly CollectionCandidate[]): Promise<Set<string>> {
  const used = new Set<string>();
  const ids = collections.map((c) => c.id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LINK_CHUNK) chunks.push(ids.slice(i, i + LINK_CHUNK));
  await Promise.all(
    chunks.map(async (part) => {
      const { data, error } = await supabase
        .from("cash_entries")
        .select("source_type, source_id")
        .in("source_type", ["commission", "rent", "building"])
        .in("source_id", part)
        .is("voided_at", null)
        .limit(1000);
      if (error) {
        console.error("loadMatchContext linked", { code: error.code });
        return;
      }
      for (const u of (data ?? []) as Record<string, unknown>[]) used.add(`${u.source_type}:${u.source_id}`);
    }),
  );
  return used;
}
