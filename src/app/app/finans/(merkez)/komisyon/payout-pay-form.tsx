"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, X } from "lucide-react";
import { payCommissionPayouts } from "@/app/actions/commission-payouts";
import { PAYOUT_WITHHOLDING_MAX } from "@/lib/finance/commission-payouts";
import { withholding } from "@/lib/finance/ledger/vat";
import { useToast } from "@/components/app/toast-provider";
import { FinanceAccountPicker } from "@/components/app/finance-account-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const fmt = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 });

/**
 * "Hakediş öde" formu (satır ve toplu ödeme ortak): ödemenin çıktığı ofis hesabı ZORUNLU, stopaj oranı (%; brüt hakediş
 * üzerinden, vergi dairesine borç olur) ve ödeme açıklaması. Önizleme: brüt / stopaj / danışmana net. Yalnız owner/gm'e
 * çizilir; sunucu aynı kuralları yeniden uygular. Yapılmış ödeme geri alınamaz.
 */
export function PayoutPayForm({
  commissionIds,
  total,
  onClose,
}: {
  commissionIds: string[];
  /** Ödenecek brüt hakediş toplamı (önizleme). */
  total: number;
  onClose?: () => void;
}) {
  const { push } = useToast();
  const router = useRouter();
  const uid = useId();
  const [accountId, setAccountId] = useState("");
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [rate, setRate] = useState("0");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  const rateNum = Number(rate.replace(",", "."));
  const rateOk = rate.trim() === "" || (Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= PAYOUT_WITHHOLDING_MAX);
  const preview = withholding(total, rateOk && rate.trim() !== "" ? rateNum : 0);
  const ready = Boolean(accountId) && rateOk && !busy;

  async function pay() {
    setBusy(true);
    const res = await payCommissionPayouts(commissionIds, {
      accountId,
      withholdingRate: rate.trim() === "" ? 0 : rateNum,
      paymentRef: ref.trim() || null,
    });
    setBusy(false);
    if (res.error) {
      push(res.error, "err");
      return { error: res.error };
    }
    const tail = (res.withheldAmount ?? 0) > 0 ? ` · stopaj ${fmt.format(res.withheldAmount ?? 0)}` : "";
    push(`${res.paidCount ?? 0} danışman ödemesi yapıldı · net ${fmt.format(res.netAmount ?? res.paidAmount ?? 0)}${tail}`, "ok");
    if (res.info) push(res.info, "err");
    onClose?.();
    router.refresh();
    return { ok: true };
  }

  return (
    <div className="grid w-full min-w-[260px] max-w-[360px] gap-2 rounded-[var(--radius-card)] border border-line bg-canvas p-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-text">Danışman ödemesi</p>
        {onClose ? (
          <Button type="button" variant="ghost" size="icon" icon={X} onClick={onClose} aria-label="Kapat" />
        ) : null}
      </div>
      <FinanceAccountPicker value={accountId} onChange={setAccountId} direction="out" required onAccountsLoaded={setAccountCount} className="w-full" />
      {accountCount === 0 ? (
        <p className="text-xs text-[color:var(--pm-warn-text)]">
          Danışman ödemesi bir ofis hesabından yapılır. Önce Finans &gt; Kasa ve banka sekmesinden hesap açın.
        </p>
      ) : null}
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <label className="grid gap-1 text-xs font-semibold text-text-muted" htmlFor={`${uid}-rate`}>
          Stopaj (%)
          <Input
            id={`${uid}-rate`}
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            aria-invalid={!rateOk}
            className="text-xs"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-text-muted" htmlFor={`${uid}-ref`}>
          Açıklama / dekont no
          <Input id={`${uid}-ref`} value={ref} maxLength={200} onChange={(e) => setRef(e.target.value)} placeholder="ör. EFT-123" className="text-xs" />
        </label>
      </div>
      <dl className="grid grid-cols-3 gap-1 text-xs">
        <div>
          <dt className="text-text-faint">Brüt</dt>
          <dd className="numeric font-bold text-text">{fmt.format(total)}</dd>
        </div>
        <div>
          <dt className="text-text-faint">Stopaj</dt>
          <dd className="numeric font-bold text-text">{fmt.format(preview.withheld)}</dd>
        </div>
        <div>
          <dt className="text-text-faint">Danışmana net</dt>
          <dd className="numeric font-bold text-success-strong">{fmt.format(preview.net)}</dd>
        </div>
      </dl>
      {commissionIds.length > 1 ? (
        <p className="text-xs text-text-faint">Stopaj her ödemede ayrı hesaplanır; toplamlar kuruş farkı gösterebilir.</p>
      ) : null}
      <ConfirmDialog
        trigger={
          <Button type="button" size="sm" icon={HandCoins} loading={busy} disabled={!ready}>
            Öde
          </Button>
        }
        title="Danışmana öde"
        description={`${commissionIds.length} komisyondaki danışman payları ödenir: seçilen hesaptan ${fmt.format(preview.net)} çıkış yazılır${
          preview.withheld > 0 ? `, ${fmt.format(preview.withheld)} stopaj vergi dairesine borç olarak kaydedilir` : ""
        }. Danışmanlara bildirim gider. Yapılmış ödeme geri alınamaz.`}
        confirmLabel="Öde"
        tone="default"
        onConfirm={pay}
      />
    </div>
  );
}
