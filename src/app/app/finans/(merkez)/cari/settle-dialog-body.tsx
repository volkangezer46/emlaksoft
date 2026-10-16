"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, HandCoins } from "lucide-react";
import { createOpenItem, settleOpenItem } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { parseSettleAmount, statusAfter, toKurus, fromKurus, type PartyKindKey } from "@/lib/finance/party/aging";
import { parseMoneyInput } from "@/lib/money-input";
import { PartyPicker } from "./party-picker";
import type { SettleAccount, SettleItem } from "./settle-dialog";

/**
 * Cari eylem pencereleri (yalnız düğmeye basılınca yüklenir; bkz. `settle-dialog.tsx`):
 *  - SettleDialog: elle açılmış kalemin kısmi ya da tam kapatılması (`settleOpenItem`; hesaba hareket yazılır, kaleme bağlanır)
 *  - OpenItemDialog: vadeli açık kalem (`createOpenItem`)
 * Kural ve kilit (dönem kapanışı) RPC'dedir; burada yalnız erken geri bildirim yapılır.
 */

export function SettleDialog({ item, accounts, today, onClose }: { item: SettleItem; accounts: readonly SettleAccount[]; today: string; onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [amountRaw, setAmountRaw] = useState(String(item.remaining).replace(".", ","));
  const receivable = item.direction === "receivable";
  const usable = accounts.filter((a) => a.currency === item.currency);

  const parsed = parseMoneyInput(amountRaw, { max: 9_999_999_999.99 });
  const preview = parsed.ok && parsed.value != null && parsed.value > 0 && toKurus(parsed.value) <= toKurus(item.remaining)
    ? { status: statusAfter(item.amount, fromKurus(toKurus(item.amount) - toKurus(item.remaining) + toKurus(parsed.value))), left: fromKurus(toKurus(item.remaining) - toKurus(parsed.value)) }
    : null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amount = parseSettleAmount(String(fd.get("amount") ?? ""), item.remaining);
    if (!amount.ok) return setError(amount.error);
    const accountId = String(fd.get("accountId") ?? "");
    if (!accountId) return setError("Hangi hesaptan olduğunu seçin.");
    setBusy(true);
    setError(null);
    const res = await settleOpenItem({
      itemId: item.id,
      accountId,
      amount: amount.value,
      date: String(fd.get("date") ?? "") || today,
      note: String(fd.get("note") ?? "").trim() || null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    push(receivable ? "Tahsilat kaydedildi" : "Ödeme kaydedildi", "ok");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader
          title={receivable ? "Tahsil et" : "Öde"}
          description={`${item.title} · kalan ${formatAccountMoney(item.remaining, item.currency)}. Kısmi tutar girilirse kalem "Kısmi" olur.`}
          icon={<HandCoins />}
        />
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Tutar" htmlFor="sd-amount" required>
                <FormInput id="sd-amount" name="amount" inputMode="decimal" value={amountRaw} onChange={(e) => setAmountRaw(e.target.value)} required autoFocus />
              </FormField>
              <FormField label="Tarih" htmlFor="sd-date">
                <FormInput id="sd-date" name="date" type="date" defaultValue={today} max={today} min="2000-01-01" />
              </FormField>
            </div>
            <FormField label={receivable ? "Hangi hesaba girdi?" : "Hangi hesaptan çıktı?"} htmlFor="sd-account" required hint={usable.length === 0 ? `${item.currency} para biriminde açık hesap yok; önce Kasa ve banka sekmesinden hesap açın.` : undefined}>
              <FormSelect id="sd-account" name="accountId" defaultValue={usable[0]?.id ?? ""} required>
                {usable.length === 0 ? <option value="">Hesap yok</option> : null}
                {usable.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </FormSelect>
            </FormField>
            <FormField label="Not" htmlFor="sd-note">
              <FormTextarea id="sd-note" name="note" rows={2} maxLength={500} />
            </FormField>
            {preview ? (
              <p className="rounded-[var(--radius-control)] bg-surface-sunken px-3 py-2 text-xs text-text-muted" aria-live="polite">
                Kayıttan sonra: <strong className="text-text">{preview.status === "paid" ? "Kapandı" : "Kısmi"}</strong>
                {preview.status === "paid" ? null : <> · kalan <span className="numeric font-semibold text-text">{formatAccountMoney(preview.left, item.currency)}</span></>}
              </p>
            ) : null}
            <FormError error={error} nextStep={null} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={usable.length === 0}>{receivable ? "Tahsilatı kaydet" : "Ödemeyi kaydet"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OpenItemDialog({
  party,
  today,
  defaultDirection,
  advisorOwnerId,
  onClose,
}: {
  party: { id: string; name: string; kind: PartyKindKey | null } | null;
  today: string;
  defaultDirection: "receivable" | "payable";
  advisorOwnerId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState(defaultDirection);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const partyId = party?.id ?? String(fd.get("partyId") ?? "");
    if (!partyId) return setError("Kişi ya da firma seçin.");
    const amount = parseMoneyInput(String(fd.get("amount") ?? ""), { max: 9_999_999_999.99 });
    if (!amount.ok || amount.value == null || amount.value <= 0) return setError("Geçerli, en çok iki ondalık haneli bir tutar girin.");
    const issueDate = String(fd.get("issueDate") ?? "") || today;
    const dueDate = String(fd.get("dueDate") ?? "") || issueDate;
    if (dueDate < issueDate) return setError("Vade tarihi belge tarihinden önce olamaz.");
    setBusy(true);
    setError(null);
    const res = await createOpenItem({
      direction,
      partyId,
      title: String(fd.get("title") ?? "").trim(),
      amount: amount.value,
      issueDate,
      dueDate,
      note: String(fd.get("note") ?? "").trim() || null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    push(direction === "receivable" ? "Alacak eklendi" : "Borç eklendi", "ok");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader
          title="Yeni alacak / borç"
          description="Vadeli kalem: henüz para hareketi yoktur. Tahsil edildiğinde ya da ödendiğinde 'Tahsil et / Öde' ile kapatılır."
          icon={<FilePlus2 />}
        />
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            <div role="radiogroup" aria-label="Kalem yönü" className="grid grid-cols-2 gap-2">
              {(["receivable", "payable"] as const).map((d) => (
                <Button
                  key={d}
                  variant="ghost"
                  size="lg"
                  role="radio"
                  aria-checked={direction === d}
                  onClick={() => setDirection(d)}
                  className={`h-auto min-h-10 border px-3 text-center touch:h-auto touch:min-h-11 ${direction === d ? (d === "receivable" ? "tone-success border-current" : "tone-danger border-current") : "border-line bg-surface text-text-muted hover:text-text-muted"}`}
                >
                  {d === "receivable" ? "Alacak (bize ödenecek)" : "Borç (biz ödeyeceğiz)"}
                </Button>
              ))}
            </div>
            {party ? (
              <p className="text-sm text-text-muted">Kişi / firma: <strong className="text-text">{party.name}</strong></p>
            ) : (
              <FormField label="Kişi / firma" htmlFor="oi-party" required inject={false}>
                <PartyPicker id="oi-party" name="partyId" allowCreate kindHint={direction === "payable" ? "tedarikci" : "musteri"} advisorOwnerId={advisorOwnerId} />
              </FormField>
            )}
            <FormField label="Açıklama" htmlFor="oi-title" required>
              <FormInput id="oi-title" name="title" maxLength={160} placeholder={direction === "receivable" ? "ör. Ekspertiz hizmet bedeli" : "ör. Tabela yapımı"} required autoFocus={Boolean(party)} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Tutar (KDV dahil)" htmlFor="oi-amount" required>
                <FormInput id="oi-amount" name="amount" inputMode="decimal" required />
              </FormField>
              <FormField label="Belge tarihi" htmlFor="oi-issue">
                <FormInput id="oi-issue" name="issueDate" type="date" defaultValue={today} min="2000-01-01" />
              </FormField>
              <FormField label="Vade" htmlFor="oi-due">
                <FormInput id="oi-due" name="dueDate" type="date" defaultValue={today} min="2000-01-01" />
              </FormField>
            </div>
            <FormField label="Not" htmlFor="oi-note">
              <FormTextarea id="oi-note" name="note" rows={2} maxLength={1000} />
            </FormField>
            <FormError error={error} nextStep={null} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="primary" loading={busy}>Kaydet</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
