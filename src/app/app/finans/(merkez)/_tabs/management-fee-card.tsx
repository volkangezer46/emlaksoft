import { financePath } from "@/lib/finance/routes";
import Link from "@/components/ui/smart-link";
import { Coins, HandCoins } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadManagementFeeIncome, loadOwnerPayoutTotals } from "@/lib/property-management/load";
import { OWNER_PAYOUT_CATEGORY } from "@/lib/finance/cash/categories";
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

/**
 * Özet kartı: "Mülk sahibi ödemeleri" = bu ay mülk sahiplerine yapılan hakediş ödemeleri (iptal edilmemiş `owner_payouts`).
 * Hesap seçilerek yapılanlar kasada "Mülk sahibi ödemesi" çıkışı olarak görünür; karta tıklayınca o hareketler açılır.
 * Ödeme yoksa (ya da okunamıyorsa) çizilmez.
 */
export async function OwnerPayoutsCard({ supabase, tenantId, today }: { supabase: SupabaseClient; tenantId: string; today: string }) {
  const { from, toExclusive } = monthBoundsOf(today);
  const totals = await loadOwnerPayoutTotals(supabase, { tenantId, fromDay: from, toDayExclusive: toExclusive });
  if (!totals || totals.count === 0) return null;
  return (
    <Link
      href={`${financePath("hareketler")}?kategori=${OWNER_PAYOUT_CATEGORY}&from=${from}`}
      className="focus-ring press lift flex items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 transition hover:border-brand-300"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-accent-soft text-accent-text"><HandCoins className="h-5 w-5" aria-hidden="true" /></span>
      <span>
        <span className="block font-display text-sm font-bold text-text">Mülk sahibi ödemeleri: {formatAccountMoney(totals.total, "TRY")}</span>
        <span className="block text-xs text-text-muted">Bu ay {totals.count} hakediş ödemesi. Hesap seçilerek yapılanlar kasada çıkış olarak görünür.</span>
      </span>
    </Link>
  );
}
