"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { HandCoins } from "lucide-react";
import { retryCommissionCash } from "@/app/actions/commissions";
import { useToast } from "@/components/app/toast-provider";
import { FinanceAccountPicker } from "@/components/app/finance-account-picker";
import { Button } from "@/components/ui/button";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { formatDateTr } from "@/lib/format";

export type CommissionCashQueueItem = { id: string; amount: number; date: string; label: string };

/**
 * "Kasaya işle" kuyruğu (SK6/B109): tahsil edildi işaretlenmiş ama kasaya hareketi olmayan komisyonlar. Hesap seçilir,
 * seçilenler (varsayılan hepsi) `retryCommissionCash` ile KDV dahil tutarla yazılır (idempotent: hareketi olan atlanır).
 */
export function CommissionCashQueue({ items, total, partial }: { items: readonly CommissionCashQueueItem[]; total: number; partial: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [accountId, setAccountId] = useState("");
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [skip, setSkip] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const chosen = items.filter((i) => !skip.has(i.id));
  const chosenTotal = Math.round(chosen.reduce((s, i) => s + i.amount, 0) * 100) / 100;

  async function run() {
    if (!accountId || chosen.length === 0) return;
    setBusy(true);
    const res = await retryCommissionCash(chosen.map((i) => i.id), accountId);
    setBusy(false);
    if (res.recorded > 0) push(`${res.recorded} komisyon tahsilatı kasaya işlendi`, "ok");
    if (res.error) push(res.error, "err");
    if (res.recorded > 0) router.refresh();
  }

  const toggle = (id: string) =>
    setSkip((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FinanceAccountPicker value={accountId} onChange={setAccountId} required onAccountsLoaded={setAccountCount} />
        <Button type="button" size="sm" icon={HandCoins} loading={busy} disabled={busy || !accountId || chosen.length === 0} onClick={run} className="touch:h-11">
          Kasaya işle ({chosen.length} · {formatAccountMoney(chosenTotal, "TRY")})
        </Button>
        {accountCount === 0 ? <span className="text-xs text-text-muted">Önce bir ofis hesabı açın; tahsilatlar o hesaba işlenir.</span> : null}
      </div>
      <ul className="grid gap-1" aria-label="Kasaya işlenmemiş komisyon tahsilatları">
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 text-xs hover:bg-surface-hover touch:min-h-11">
              <input
                type="checkbox"
                checked={!skip.has(i.id)}
                onChange={() => toggle(i.id)}
                className="focus-ring h-4 w-4 cursor-pointer rounded border-line accent-[var(--accent)]"
                aria-label={`${i.label} tahsilatını kasaya işle`}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-text">{i.label}</span>
              <span className="numeric text-text-muted">{formatDateTr(i.date)}</span>
              <span className="numeric w-28 text-right font-semibold text-text">{formatAccountMoney(i.amount, "TRY")}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-text-muted">
        Toplam {formatAccountMoney(total, "TRY")} (KDV dahil tahsilat).{partial ? " Son 200 tahsilat tarandı." : ""}{" "}
        <Link href="/app/komisyon?durum=tahsil" className="font-semibold text-accent-text hover:underline">
          Tahsil edilen komisyonlar
        </Link>
      </p>
    </div>
  );
}
