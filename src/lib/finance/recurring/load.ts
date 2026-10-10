import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import type { Recurrence } from "@/lib/finance/recurring-expenses";

/** Düzenli ödeme okuyucuları (kullanıcı oturumu, RLS). Şema yoksa `available:false` -> sekme/kart görünmez. */
export type RecurringRule = {
  id: string;
  scope: "office" | "user";
  direction: "in" | "out";
  category: string;
  title: string;
  amount: number;
  account_id: string;
  frequency: Recurrence;
  pay_day: number;
  start_date: string;
  end_date: string | null;
  anchor: string;
  mode: "auto" | "approve";
  portal_key: string | null;
  next_due: string | null;
  last_period: string | null;
  active: boolean;
};

export type PendingOccurrence = {
  id: string;
  rule_id: string;
  period: string;
  due_date: string;
  amount: number;
  title: string;
  scope: "office" | "user";
  direction: "in" | "out";
};

const RULE_COLUMNS = "id, scope, direction, category, title, amount, account_id, frequency, pay_day, start_date, end_date, anchor, mode, portal_key, next_due, last_period, active";

/** `scope` verilirse yalnız o kapsamın kuralları (Kasam: yalnız kişisel; ofis verisi asla gelmez). */
export async function loadRecurringRules(
  supabase: SupabaseClient,
  opts: { scope?: "office" | "user"; ownerUserId?: string } = {},
): Promise<{ available: boolean; rules: RecurringRule[] }> {
  let q = supabase.from("recurring_rules").select(RULE_COLUMNS).order("active", { ascending: false }).order("next_due", { ascending: true, nullsFirst: false });
  if (opts.scope) q = q.eq("scope", opts.scope);
  if (opts.scope === "user" && opts.ownerUserId) q = q.eq("owner_user_id", opts.ownerUserId);
  const { data, error } = await q.limit(200);
  if (error) {
    if (!isMissingCashSchema(error)) console.error("loadRecurringRules", { code: error.code });
    return { available: false, rules: [] };
  }
  return { available: true, rules: ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...(r as unknown as RecurringRule), amount: Number(r.amount) })) };
}

/** Onay bekleyen taslaklar (RLS görünür kurallarla sınırlar). `rules` verilirse yalnız onların taslakları. */
export async function loadPendingOccurrences(
  supabase: SupabaseClient,
  rules: readonly RecurringRule[],
): Promise<PendingOccurrence[]> {
  if (rules.length === 0) return [];
  const byId = new Map(rules.map((r) => [r.id, r]));
  const { data, error } = await supabase
    .from("recurring_occurrences")
    .select("id, rule_id, period, due_date, amount")
    .eq("status", "pending")
    .in("rule_id", [...byId.keys()])
    .order("due_date", { ascending: true })
    .limit(100);
  if (error) {
    if (!isMissingCashSchema(error)) console.error("loadPendingOccurrences", { code: error.code });
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).flatMap((o) => {
    const r = byId.get(String(o.rule_id));
    if (!r) return [];
    return [{ id: String(o.id), rule_id: r.id, period: String(o.period), due_date: String(o.due_date), amount: Number(o.amount), title: r.title, scope: r.scope, direction: r.direction }];
  });
}
