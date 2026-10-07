import Link from "@/components/ui/smart-link";
import { cache } from "react";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { TrendPill, computeTrend } from "@/components/ui/premium";
import { CountUp } from "@/components/ui/count-up";
import { trDayKey } from "@/lib/clock";
import { moneyTry } from "@/lib/leak-shield";
import { assertQueryBatchSucceeded } from "@/lib/supabase/query-batch";
import { createClient } from "@/lib/supabase/server";
import type { HomeCtx } from "./data";

type ExpenseRow = { id: string; title: string | null; amount: number | string | null; expense_date: string };

/** Önceki ay başından bugüne gider satırları (yeniden eskiye); toplamlar JS'te ayrılır. */
const loadExpenses = cache(async (ctx: HomeCtx) => {
  const supabase = await createClient();
  const prevKey = trDayKey(ctx.prevMonthStartIso);
  const result = await supabase
    .from("expenses")
    .select("id, title, amount, expense_date")
    .gte("expense_date", prevKey)
    .order("expense_date", { ascending: false })
    .limit(500);
  assertQueryBatchSucceeded([result], ["expenses-summary"], "Ana panel");
  return { rows: (result.data ?? []) as ExpenseRow[], truncated: (result.data ?? []).length >= 500 };
});

/** Bu ay / geçen ay gider toplamı ve son kayıtlar (saf; satırlar ay anahtarıyla bölünür). */
export function splitExpenses(rows: readonly ExpenseRow[], monthStartKey: string) {
  const sum = (r: readonly ExpenseRow[]) => r.reduce((t, x) => t + Number(x.amount ?? 0), 0);
  const cur = rows.filter((r) => r.expense_date >= monthStartKey);
  const prev = rows.filter((r) => r.expense_date < monthStartKey);
  return { cur: sum(cur), prev: sum(prev), recent: rows.slice(0, 5) };
}

/**
 * MUHASEBE İKİNCİL BLOK — Gider özeti: bu ay toplam (geçen aya fark; artış kötü), son 5 gider satırı. Gider modülünü
 * görebilen role çizilir (sayfa `canSeeExpenses` ile kapıyı kurar). Satır sayısı kırpılırsa toplam gösterilmez.
 */
export async function GiderOzeti({ ctx }: { ctx: HomeCtx }) {
  const { rows, truncated } = await loadExpenses(ctx);
  const s = splitExpenses(rows, ctx.monthStartKey);
  return (
    <section aria-labelledby="gider-baslik" className="pm-c1 flex h-full min-h-[14rem] flex-col p-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="gider-baslik" className="pm-bx-eyebrow">
          Gider özeti · bu ay
        </h2>
        <Link href="/app/giderler" className="focus-ring rounded-[var(--radius-control)] px-1 text-xs font-semibold text-[var(--accent-text)]">
          Giderler
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState variant="compact" title="Kayıtlı gider yok" description="Son iki ayda gider kaydı bulunmuyor." action={{ href: "/app/giderler", label: "Giderlere git" }} />
      ) : (
        <>
          {truncated ? (
            <p className="mt-2 px-1 text-xs text-[var(--pm-warn-text)]">Kayıt sayısı sınıra ulaştı; toplam gösterilmiyor.</p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-3 px-1">
              <span className="pm-num text-3xl">
                <CountUp value={s.cur} format="money" />
              </span>
              <TrendPill trend={computeTrend(s.cur, s.prev, true)} />
              <span className="text-xs text-text-muted">Geçen ay {moneyTry(s.prev)}</span>
            </div>
          )}
          <ul className="pm-sep mt-3">
            {s.recent.map((r) => (
              <li key={r.id}>
                <Link href="/app/giderler" className="pm-r36 focus-ring group">
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">{r.title ?? "Gider"}</span>
                  <span className="flex-none text-xs tabular-nums text-text-muted">{r.expense_date}</span>
                  <span className="pm-num w-24 flex-none text-right text-sm">{moneyTry(Number(r.amount ?? 0))}</span>
                  <ChevronRight className="h-4 w-4 flex-none text-[var(--text-faint)] group-hover:text-[var(--accent-text)]" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
