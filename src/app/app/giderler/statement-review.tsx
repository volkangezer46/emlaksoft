import type { SupabaseClient } from "@supabase/supabase-js";
import { FileSpreadsheet } from "lucide-react";
import { formatDateTr } from "@/lib/format";
import { guessCategory, suggestAll } from "@/lib/finance/statement/match";
import { loadMatchContext, loadPendingLines } from "@/lib/finance/statement/load";
import type { AccountWithBalance } from "@/lib/finance/cash/load";
import { StatementReviewTable, type ReviewLine } from "./statement-review-table";

/**
 * Ekstre onay ekranı (sunucu): taslak satırlar + otomatik eşleştirme önerileri (mevcut hareket, tahsilat, düzenli ödeme, kategori tahmini).
 * Öneriler her yüklemede güncel verilerle hesaplanır; hiçbiri kendiliğinden kaydedilmez.
 */
export async function StatementReview({ supabase, account, canSalary }: { supabase: SupabaseClient; account: AccountWithBalance; canSalary: boolean }) {
  const lines = await loadPendingLines(supabase, account.id);
  if (lines.length === 0) return null;
  // Tahsilat (komisyon/kira/aidat) eşleşmesi yalnız ofis hesabında ve TL girişlerde anlamlıdır.
  const ctx = await loadMatchContext(supabase, account.id, lines, account.owner_scope === "office" && account.currency === "TRY");
  const suggestions = suggestAll(lines, { ...ctx, canSalary });

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
