"use server";

import { requirePermission } from "@/lib/require-permission";
import { createClient } from "@/lib/supabase/server";
import type { RuleSuggestion } from "@/lib/finance/ledger/types";

/**
 * Kural önerisi (finance_rule_suggest): kayıt çalışma alanı açıklama/cari yazıldıkça çağırır. Yalnız okuma; `expenses:view`.
 * Kiracı sınırı RPC + RLS'dedir (oturum istemcisi); yazma yoktur, denetim kaydı gerekmez.
 */
export async function suggestEntryRule(input: { text: string; amount: number | null; direction: "in" | "out" }): Promise<RuleSuggestion | null> {
  const gate = await requirePermission("expenses", "view");
  if (!gate.ok) return null;
  const text = String(input?.text ?? "").trim().slice(0, 200);
  if (text.length < 3) return null;
  const amount = typeof input?.amount === "number" && Number.isFinite(input.amount) ? input.amount : null;
  const direction = input?.direction === "in" ? "in" : "out";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_rule_suggest", { p_text: text, p_amount: amount, p_iban_last4: null, p_direction: direction });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { rule_id?: string | null; category?: string | null; party_id?: string | null; mode?: string | null };
  if (!row.category) return null;
  return { ruleId: String(row.rule_id ?? ""), category: String(row.category), partyId: row.party_id ?? null, mode: row.mode === "auto" ? "auto" : "suggest" };
}
