import type { SupabaseClient } from "@supabase/supabase-js";
import { FileSpreadsheet } from "lucide-react";
import { formatDateTr } from "@/lib/format";
import { guessCategory, suggestAll, type FinanceRuleLike } from "@/lib/finance/statement/match";
import { loadMatchContext, loadPendingLines } from "@/lib/finance/statement/load";
import { isMissingCashSchema, type AccountWithBalance } from "@/lib/finance/cash/load";
import { StatementReviewTable, type ReviewLine } from "./statement-review-table";

/**
 * Ekstre onay ekranı (sunucu): taslak satırlar + otomatik eşleştirme önerileri (mevcut hareket, tahsilat, düzenli ödeme, kategori tahmini).
 * Öneriler her yüklemede güncel verilerle hesaplanır; hiçbiri kendiliğinden kaydedilmez.
 */
export async function StatementReview({ supabase, account, canSalary }: { supabase: SupabaseClient; account: AccountWithBalance; canSalary: boolean }) {
  const [lines, financeRules] = await Promise.all([loadPendingLines(supabase, account.id), account.owner_scope === "office" ? loadFinanceRules(supabase) : Promise.resolve([])]);
  if (lines.length === 0) return null;
  // Tahsilat (komisyon/kira/aidat) eşleşmesi yalnız ofis hesabında ve TL girişlerde anlamlıdır.
  const ctx = await loadMatchContext(supabase, account.id, lines, account.owner_scope === "office" && account.currency === "TRY");
  const suggestions = suggestAll(lines, { ...ctx, financeRules, canSalary });

  const review: ReviewLine[] = lines.map((l) => ({
    id: l.id,
    importId: l.importId,
    date: l.date,
    dir: l.dir,
    amount: l.amount,
    description: l.description,
    suggestion: suggestions.get(l.id) ?? { kind: "none" },
    fallbackCategory: guessCategory(l.description, l.dir, canSalary).category,
  }));
  const importIds = [...new Set(lines.map((l) => l.importId))];
  const first = lines[0]!.date;
  const last = lines[lines.length - 1]!.date;
  const existing = review.filter((r) => r.suggestion.kind === "existing").length;

  return (
    <section aria-label="Ekstre taslağı" className="grid gap-3 rounded-[var(--radius-panel)] border border-accent/30 bg-surface p-4 shadow-[var(--shadow-xs)]">
      <header className="flex flex-wrap items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-accent-soft text-accent-text"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-text">{account.name}: ekstre taslağı</h2>
          <p className="text-xs text-text-muted">
            {lines.length} satır · {formatDateTr(first)} – {formatDateTr(last)}. {existing > 0 ? `${existing} satır mevcut hareketle eşleşti. ` : ""}
            Önerileri kontrol edin, gerekirse düzeltin; onayladıklarınız hesaba işlenir ve mutabık işaretlenir.
          </p>
        </div>
      </header>
      <StatementReviewTable accountId={account.id} importIds={importIds} currency={account.currency} canSalary={canSalary} lines={review} />
    </section>
  );
}

/**
 * Ofisin etkin kategori kuralları (finance_rules; RLS kiracı). Eşleştirme TS'de (match.ts `suggestFromRules`) yapılır:
 * satır başına finance_rule_suggest RPC turu yerine tek okuma; aynı anlam (yön, metin, IBAN, tutar aralığı).
 * Tablo yoksa (FN1 migration'ı uygulanmadan) boş liste.
 */
export async function loadFinanceRules(supabase: SupabaseClient): Promise<FinanceRuleLike[]> {
  const { data, error } = await supabase
    .from("finance_rules")
    .select("id, direction, match_text, match_iban_last4, amount_min, amount_max, set_category, set_party_id, mode")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    if (!isMissingCashSchema(error)) console.error("loadFinanceRules", { code: error.code });
    return [];
  }
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return ((data ?? []) as Record<string, unknown>[])
    .filter((r) => typeof r.set_category === "string" && r.set_category)
    .map((r) => ({
      id: String(r.id),
      direction: r.direction === "in" || r.direction === "out" ? r.direction : null,
      matchText: (r.match_text as string | null) ?? null,
      ibanLast4: (r.match_iban_last4 as string | null) ?? null,
      amountMin: n(r.amount_min),
      amountMax: n(r.amount_max),
      category: String(r.set_category),
      partyId: (r.set_party_id as string | null) ?? null,
      mode: r.mode === "auto" ? "auto" : "suggest",
    }));
}
