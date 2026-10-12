import Link from "@/components/ui/smart-link";
import { Coins } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadManagementFeeIncome } from "@/lib/property-management/load";
import { formatAccountMoney } from "@/lib/finance/cash/money";

/** "YYYY-MM-DD" günün ait olduğu ayın ilk günü ve sonraki ayın ilk günü (saf metin hesabı; saat dilimi yok). */
export function monthBoundsOf(today: string): { from: string; toExclusive: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { from: `${today.slice(0, 7)}-01`, toExclusive: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01` };
}

/**
 * Özet kartı: "Yönetim ücretleri" = bu ay mülk yönetimindeki kira tahsilatlarından ofise kalan ücret (kâr-zarardaki gelirle AYNI kaynak:
 * `rent_payments.management_fee`). Tahsilatın kendisi zaten kasaya "Kira tahsilatı" olarak girdiği için ücret ayrıca hareket yazılmaz
 * (çift sayım olurdu); bu kart ücreti görünür kılar ve kira listesindeki ücret süzgecine götürür. Ücret yoksa (ya da okunamıyorsa) çizilmez.
 */
export async function ManagementFeeCard({ supabase, tenantId, today }: { supabase: SupabaseClient; tenantId: string; today: string }) {
  const { from, toExclusive } = monthBoundsOf(today);
  const income = await loadManagementFeeIncome(supabase, { tenantId, fromDay: from, toDayExclusive: toExclusive });
  if (!income || income.total <= 0) return null;
  return (
    <Link
      href="/app/kiralama?yonetim=ucret"
      className="focus-ring press lift flex items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 transition hover:border-brand-300"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-accent-soft text-accent-text"><Coins className="h-5 w-5" aria-hidden="true" /></span>
      <span>
        <span className="block font-display text-sm font-bold text-text">Yönetim ücretleri: {formatAccountMoney(income.total, "TRY")}</span>
        <span className="block text-xs text-text-muted">Bu ay {income.byRental.size} kiradan ofise kalan ücret. Kira tahsilatları kasaya zaten girer; ücret ayrıca sayılmaz.</span>
      </span>
    </Link>
  );
}
