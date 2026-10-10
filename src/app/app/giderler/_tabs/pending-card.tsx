import Link from "@/components/ui/smart-link";
import { BellRing } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPendingOccurrences, loadRecurringRules } from "@/lib/finance/recurring/load";
import { FINANCE_BASE } from "./finance-shell";

/** Özet kartı: "Onay bekleyen N ödeme" -> Düzenli ödemeler sekmesindeki bekleyenler. Bekleyen yoksa (veya şema yoksa) hiçbir şey çizmez. */
export async function PendingApprovalsCard({ supabase }: { supabase: SupabaseClient }) {
  const { available, rules } = await loadRecurringRules(supabase, { scope: "office" });
  if (!available) return null;
  const pending = await loadPendingOccurrences(supabase, rules);
  if (pending.length === 0) return null;
  return (
    <Link
      href={`${FINANCE_BASE}?sekme=duzenli&durum=bekleyen`}
      className="focus-ring press lift flex items-center gap-3 rounded-[var(--radius-panel)] border border-warning-200 bg-surface p-4 transition hover:border-brand-300"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-accent-soft text-accent-text"><BellRing className="h-5 w-5" aria-hidden="true" /></span>
      <span>
        <span className="block font-display text-sm font-bold text-text">Onay bekleyen {pending.length} ödeme</span>
        <span className="block text-xs text-text-muted">Vadesi gelen “Bana sor” ödemeleri onayınızı bekliyor.</span>
      </span>
    </Link>
  );
}
