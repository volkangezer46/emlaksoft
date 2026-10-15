"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WalletCards } from "lucide-react";
import { recordPayoutToPersonal } from "@/app/actions/commission-payouts";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);

/**
 * "Kasama işle" (isteğe bağlı): ödenmiş hakedişi danışmanın KİŞİSEL hesabına (Kasam) giriş olarak yazar
 * (`payout:{id}:personal`; ofis kâr/zararı dışında). Tutar varsayılan brüt hakediştir; stopaj kesildiyse net tutar girilir.
 * Kişisel hesap yoksa sayfa bu düğmeyi çizmez.
 */
export function PayoutPersonalButton({
  payoutId,
  amount,
  accounts,
}: {
  payoutId: string;
  amount: number;
  accounts: { id: string; name: string }[];
}) {
  const { push } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(accounts.length === 1 ? accounts[0]!.id : "");
  const [value, setValue] = useState(String(amount));
  const [busy, setBusy] = useState(false);

  async function save() {
    const raw = value.trim();
    const n = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
    if (!accountId) {
      push("Kişisel hesabınızı seçin", "err");
      return;
    }
    setBusy(true);
    const res = await recordPayoutToPersonal(payoutId, { accountId, amount: n });
    setBusy(false);
    if (res.error) {
      push(res.error, "err");
      return;
    }
    push(res.info ?? "Hakediş Kasam'a işlendi", "ok");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" icon={WalletCards} onClick={() => setOpen(true)} className="relative z-10">
        Kasama işle
      </Button>
    );
  }
  return (
    <div className="relative z-10 flex w-full flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-line bg-canvas p-2">
      <Combobox
        aria-label="Hangi kişisel hesaba girdi"
        value={accountId}
        onValueChange={setAccountId}
        options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        placeholder="Kişisel hesap"
        searchPlaceholder="Hesap ara…"
        emptyText="Eşleşen hesap yok"
        className="w-auto min-w-[10rem] text-xs"
      />
      <label className="grid gap-1 text-xs font-semibold text-text-muted">
        Size ulaşan tutar
        <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="w-32 text-xs" />
      </label>
      <Button type="button" size="sm" onClick={save} loading={busy} disabled={busy || !accountId}>
        Kaydet
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
        Vazgeç
      </Button>
      <p className="w-full text-xs text-text-faint">Hakediş {money(amount)}; stopaj kesildiyse hesabınıza geçen net tutarı yazın.</p>
    </div>
  );
}
