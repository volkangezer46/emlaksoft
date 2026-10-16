import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Clock3, HandCoins } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { commissionPayoutState, type ExistingPayout, type PayoutSplit } from "@/lib/finance/commission-payouts";
import { financePath } from "@/lib/finance/routes";
import { PayoutBulkButton } from "./payout-bulk-button";

/** Taranan son tahsil edilmiş komisyon sayısı (IN listeleri kısa kalsın; daha eskisi defterde sayfalı). */
export const PAYABLE_SCAN_LIMIT = 100;

const fmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

/**
 * C24: Komisyon sekmesi sahibin asıl sorusuyla açılır — "danışmana ne ödeyeceğim, kimden ne tahsil edeceğim".
 * - Ödenecek paylar (yalnız ödeme yetkisi, owner/gm): müşteriden TAHSİL EDİLMİŞ ama danışman payı henüz ödenmemiş
 *   komisyonlar; hesap defterdeki satır durumuyla AYNI kural (`commissionPayoutState`). "Danışmanlara öde" mevcut toplu
 *   ödeme akışını açar (sunucu kuralı yeniden uygular).
 * - Tahsil bekleyen komisyon: deftere süzülmüş "bekleyen" listesine gider (tutar sayfanın KPI'sıyla aynı kaynaktan gelir).
 * Tahmin, indirim analizi ve simülatör bunun altında "Analiz" bölümünde kalır.
 */
export async function PayableShares({ canPay, pending, pendingHref }: { canPay: boolean; pending: number; pendingHref: string }) {
  let payable: { ids: string[]; total: number; truncated: boolean } | null = null;
  if (canPay) {
    const supabase = await createClient();
    const { data: collected, error } = await supabase
      .from("commissions")
      .select("id")
      .in("status", ["paid", "collected"])
      .order("created_at", { ascending: false })
      .limit(PAYABLE_SCAN_LIMIT);
    const ids = error ? [] : ((collected ?? []) as { id: string }[]).map((r) => r.id);
    if (!error) {
      const [splitRes, payoutRes] = ids.length
        ? await Promise.all([
            supabase
              .from("commission_splits")
              .select("id, commission_id, profile_id, amount")
              .in("commission_id", ids)
              .eq("kind", "advisor")
              .eq("unresolved", false)
              .not("profile_id", "is", null),
            supabase.from("commission_payouts").select("id, split_id, status, approved_at, commission_id").in("commission_id", ids).neq("status", "cancelled"),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (!splitRes.error && !payoutRes.error) {
        const splits = (splitRes.data ?? []) as PayoutSplit[];
        const payouts = (payoutRes.data ?? []) as (ExistingPayout & { commission_id: string })[];
        const out: string[] = [];
        let total = 0;
        for (const id of ids) {
          const s = commissionPayoutState(
            true,
            splits.filter((x) => x.commission_id === id),
            payouts.filter((x) => x.commission_id === id),
          );
          if (s.state === "payable") {
            out.push(id);
            total += s.payableAmount;
          }
        }
        payable = { ids: out, total, truncated: ids.length >= PAYABLE_SCAN_LIMIT };
      }
    }
  }

  return (
    <section data-testid="odenecek-paylar" aria-labelledby="odenecek-paylar-baslik" className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
      <h2 id="odenecek-paylar-baslik" className="flex items-center gap-2 border-b border-line px-5 py-3 font-display text-base font-bold text-text">
        <HandCoins className="h-4 w-4 text-accent-text" aria-hidden="true" /> Ödenecek paylar
      </h2>
      <div className="divide-y divide-line">
        {canPay ? (
          payable === null ? (
            <p className="px-5 py-3 text-sm text-text-muted">Ödenecek danışman payları şu an okunamadı. Danışman ödemeleri sayfasından bakabilirsiniz.</p>
          ) : payable.ids.length === 0 ? (
            <p className="px-5 py-3 text-sm text-text-muted">Tahsil edilmiş komisyonlarda ödenmemiş danışman payı yok.</p>
          ) : (
            <div>
              <p className="px-5 pt-3 text-sm text-text">
                Müşteriden tahsil edildi, danışmana henüz ödenmedi:{" "}
                <strong className="numeric">{payable.ids.length} komisyon · {fmt.format(payable.total)}</strong>
                {payable.truncated ? <span className="text-text-muted"> (son {PAYABLE_SCAN_LIMIT} tahsilat)</span> : null}
              </p>
              <PayoutBulkButton commissionIds={payable.ids} total={payable.total} />
            </div>
          )
        ) : null}
        <Link href={pendingHref} className="focus-ring flex min-h-11 items-center gap-3 px-5 py-2.5 text-sm transition hover:bg-canvas/60">
          <Clock3 className="h-4 w-4 text-[color:var(--pm-warn-text)]" aria-hidden="true" />
          <span className="font-semibold text-text">Tahsil bekleyen komisyon</span>
          <span className="numeric ml-auto font-bold text-text">{fmt.format(pending)}</span>
          <ArrowUpRight className="h-4 w-4 text-text-faint" aria-hidden="true" />
        </Link>
        {canPay ? (
          <Link href={financePath("hakedis")} className="focus-ring flex min-h-11 items-center gap-3 px-5 py-2.5 text-sm font-semibold text-accent-text transition hover:bg-canvas/60">
            Danışman başına paylar
            <ArrowUpRight className="ml-auto h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
