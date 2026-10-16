"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Wallet } from "lucide-react";
import { adoptLegacyExpenses } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import { FormError, FormField } from "@/components/ui/form-controls";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { adoptOutcomeText, adoptSelectionSummary } from "./ledger-filters";

/**
 * "Hesapsız" eski giderleri bir ofis hesabına taşıma (finance_adopt_legacy_expenses). Taşınan gider hesaba hareket olarak
 * yazılır; hesap bakiyesi yalnız taşınan tutar kadar değişir, gider kaydının kendisi (kâr-zarar) aynı kalır.
 * Yalnız TL ofis hesapları seçilebilir; TL olmayan eski giderler (USD/EUR) toplama girmez, seçimde ayrıca belirtilir ve
 * RPC tarafından atlanır. Taşınan adet RPC'den gelir (kilitli ay / açılış öncesi / ileri tarih atlanır).
 */

export type AdoptAccount = { id: string; name: string; balance: number };
export type AdoptItem = { id: string; amount: number; currency: string };

export function AdoptLegacyButton({ items, accounts, label = "Hesaba taşı", size = "xs", onDone }: {
  items: readonly AdoptItem[];
  accounts: readonly AdoptAccount[];
  label?: string;
  size?: "xs" | "sm";
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={size === "sm" ? "outline" : "ghost"} size={size} icon={ArrowRightLeft} onClick={() => setOpen(true)} disabled={items.length === 0}>
        {label}
      </Button>
      {open ? <AdoptDialog items={items} accounts={accounts} onClose={() => setOpen(false)} onDone={onDone} /> : null}
    </>
  );
}

function AdoptDialog({ items, accounts, onClose, onDone }: { items: readonly AdoptItem[]; accounts: readonly AdoptAccount[]; onClose: () => void; onDone?: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const ids = items.map((i) => i.id);
  // Seçilebilir hesaplar TL'dir: TL olmayan giderler toplama girmez, RPC onları atlar.
  const { eligible, foreign, total } = adoptSelectionSummary(items, "TRY");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!accountId) return setError("Taşınacak hesabı seçin.");
    setBusy(true);
    setError(null);
    const res = await adoptLegacyExpenses(accountId, ids);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const moved = res.count ?? 0;
    const outcome = adoptOutcomeText(moved, ids.length, account?.name ?? "seçilen");
    if (moved === 0) return setError(outcome.text);
    push(outcome.text, outcome.tone);
    onDone?.();
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader
          title={items.length === 1 ? "Gideri hesaba taşı" : `${items.length} gideri hesaba taşı`}
          description="Gider kaydı aynı kalır; seçtiğiniz hesaba ödeme hareketi olarak işlenir ve bakiyeden düşer."
          icon={<Wallet />}
        />
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            {accounts.length === 0 ? (
              <p className="text-sm text-text-muted">Taşımak için önce Kasa ve banka sekmesinden bir TL ofis hesabı açın.</p>
            ) : (
              <FormField label="Hangi hesaptan ödendi?" htmlFor="adopt-account" required>
                <Combobox
                  id="adopt-account"
                  value={accountId}
                  onValueChange={setAccountId}
                  clearable={false}
                  options={accounts.map((a) => ({ value: a.id, label: a.name, hint: `bakiye ${formatAccountMoney(a.balance, "TRY")}` }))}
                  placeholder="Hesap seçin"
                  searchPlaceholder="Hesap ara…"
                  emptyText="Eşleşen hesap yok"
                />
              </FormField>
            )}
            {foreign > 0 ? (
              <p className="rounded-[var(--radius-control)] bg-surface-warning-soft p-2.5 text-xs text-text">
                Seçimdeki <strong className="numeric">{foreign}</strong> gider TL değil; TL hesaba taşınamaz ve atlanır.
                {eligible === 0 ? " Taşınabilecek TL gider yok." : ""}
              </p>
            ) : null}
            {account ? (
              <dl className="grid grid-cols-2 gap-2 rounded-[var(--radius-control)] bg-canvas p-3 text-xs">
                <div>
                  <dt className="text-text-muted">Taşınan tutar</dt>
                  <dd className="numeric font-semibold text-text">{formatAccountMoney(total, "TRY")}</dd>
                </div>
                <div>
                  <dt className="text-text-muted">Taşıma sonrası bakiye</dt>
                  <dd className={`numeric font-semibold ${account.balance - total < 0 ? "text-danger-strong" : "text-text"}`}>{formatAccountMoney(account.balance - total, "TRY")}</dd>
                </div>
              </dl>
            ) : null}
            <FormError error={error} nextStep={null} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={accounts.length === 0 || eligible === 0}>Hesaba taşı</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
