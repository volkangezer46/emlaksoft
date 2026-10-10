"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowLeftRight, Pencil, Plus, Wallet } from "lucide-react";
import { archiveFinanceAccount, createFinanceAccount, transferBetweenAccounts, updateFinanceAccount } from "@/app/actions/finance-accounts";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { ACCOUNT_KIND_LABEL } from "@/lib/finance/cash/input";
import type { AccountOption } from "./quick-entry";

export type EditableAccount = {
  id: string;
  name: string;
  kind: "cash" | "bank" | "card";
  currency: string;
  scope: "office" | "user";
  ibanLast4: string | null;
  openingBalance: number;
  openingDate: string;
};

/** Hesap aç (yeni) veya düzenle. Danışman yalnız kişisel hesap açar; ofis hesabı `expenses` yetkisi ister. */
export function AccountFormButton({
  canOffice,
  today,
  account,
}: {
  canOffice: boolean;
  today: string;
  /** Verilirse düzenleme modu. */
  account?: EditableAccount;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {account ? (
        <Button variant="ghost" size="xs" icon={Pencil} onClick={() => setOpen(true)} aria-label={`${account.name} hesabını düzenle`}>
          Düzenle
        </Button>
      ) : (
        <Button variant="outline" icon={Plus} onClick={() => setOpen(true)}>
          Hesap aç
        </Button>
      )}
      {open ? <AccountDialog canOffice={canOffice} today={today} account={account} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AccountDialog({ canOffice, today, account, onClose }: { canOffice: boolean; today: string; account?: EditableAccount; onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [scope, setScope] = useState<"office" | "user">(account?.scope ?? (canOffice ? "office" : "user"));
  const [kind, setKind] = useState(account?.kind ?? "cash");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = Boolean(account);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      scope,
      kind,
      name: String(fd.get("name") ?? ""),
      ibanLast4: String(fd.get("ibanLast4") ?? ""),
      currency: String(fd.get("currency") ?? "TRY"),
      openingBalance: String(fd.get("openingBalance") ?? ""),
      openingIsDebt: fd.get("openingIsDebt") ? "1" : "",
      openingDate: String(fd.get("openingDate") ?? ""),
    };
    setBusy(true);
    setError(null);
    const res = account ? await updateFinanceAccount(account.id, input) : await createFinanceAccount(input);
    setBusy(false);
    if (res.error) return setError(res.error);
    push(editing ? "Hesap güncellendi" : "Hesap açıldı", "ok");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader title={editing ? "Hesabı düzenle" : "Hesap aç"} description="Kasa, banka hesabı veya kredi kartı." icon={<Wallet />} />
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            {!editing && canOffice ? (
              <FormField label="Kimin hesabı?" htmlFor="af-scope" hint={scope === "user" ? "Kişisel hesabı yalnız siz görürsünüz; ofis sahibi dahil kimse göremez ve ofis kâr-zararına girmez." : "Ofis hesabını ofis hesaplarına erişimi olanlar görür."}>
                <FormSelect id="af-scope" value={scope} onChange={(e) => setScope(e.target.value as "office" | "user")}>
                  <option value="office">Ofis hesabı</option>
                  <option value="user">Kişisel hesabım</option>
                </FormSelect>
              </FormField>
            ) : null}
            {!editing ? (
              <FormField label="Hesap türü" htmlFor="af-kind" required>
                <FormSelect id="af-kind" value={kind} onChange={(e) => setKind(e.target.value as "cash" | "bank" | "card")}>
                  {(Object.keys(ACCOUNT_KIND_LABEL) as (keyof typeof ACCOUNT_KIND_LABEL)[]).map((k) => (
                    <option key={k} value={k}>{ACCOUNT_KIND_LABEL[k]}</option>
                  ))}
                </FormSelect>
              </FormField>
            ) : null}
            <FormField label="Hesap adı" htmlFor="af-name" required>
              <FormInput id="af-name" name="name" maxLength={80} defaultValue={account?.name} placeholder={kind === "bank" ? "ör. İş Bankası Kadıköy" : "ör. Ofis kasası"} required autoFocus />
            </FormField>
            {kind === "bank" || kind === "card" ? (
              <FormField label="IBAN / kart son 4 hane" htmlFor="af-iban" hint="Yalnız son 4 hane saklanır.">
                <FormInput id="af-iban" name="ibanLast4" inputMode="numeric" maxLength={4} defaultValue={account?.ibanLast4 ?? ""} placeholder="1234" />
              </FormField>
            ) : null}
            {!editing ? (
              <FormField label="Para birimi" htmlFor="af-currency">
                <FormSelect id="af-currency" name="currency" defaultValue="TRY">
                  <option value="TRY">Türk lirası (₺)</option>
                  <option value="USD">Dolar ($)</option>
                  <option value="EUR">Euro (€)</option>
                </FormSelect>
              </FormField>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Açılış bakiyesi" htmlFor="af-opening">
                <FormInput id="af-opening" name="openingBalance" inputMode="decimal" defaultValue={account ? String(Math.abs(account.openingBalance)).replace(".", ",") : ""} placeholder="0,00" />
              </FormField>
              <FormField label="Açılış tarihi" htmlFor="af-opening-date" hint="Bu tarihten önce hareket girilemez.">
                <FormInput id="af-opening-date" name="openingDate" type="date" defaultValue={account?.openingDate ?? today} max={today} min="2000-01-01" />
              </FormField>
            </div>
            {kind === "card" ? (
              <label className="flex items-center gap-2 text-sm text-text-muted">
                <input type="checkbox" name="openingIsDebt" defaultChecked={Boolean(account && account.openingBalance < 0)} className="h-4 w-4 accent-[var(--accent)]" />
                Açılış tutarı kart borcudur
              </label>
            ) : null}
            <FormError error={error} nextStep={null} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="primary" loading={busy}>{editing ? "Kaydet" : "Hesabı aç"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Hesaplar arası transfer (iki bacak tek işlemde). */
export function TransferButton({ accounts, today }: { accounts: readonly AccountOption[]; today: string }) {
  const [open, setOpen] = useState(false);
  if (accounts.length < 2) return null;
  return (
    <>
      <Button variant="outline" icon={ArrowLeftRight} onClick={() => setOpen(true)}>
        Transfer yap
      </Button>
      {open ? <TransferDialog accounts={accounts} today={today} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TransferDialog({ accounts, today, onClose }: { accounts: readonly AccountOption[]; today: string; onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [from, setFrom] = useState(accounts[0]?.id ?? "");
  const [to, setTo] = useState(accounts[1]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (a: AccountOption) => `${a.name} (${a.currency})${a.scope === "user" ? " · kişisel" : ""}`;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await transferBetweenAccounts({
      fromAccountId: from,
      toAccountId: to,
      amount: String(fd.get("amount") ?? ""),
      date: String(fd.get("date") ?? ""),
      note: String(fd.get("note") ?? ""),
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    push("Transfer yapıldı", "ok");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader title="Hesaplar arası transfer" description="Para bir hesaptan çıkar, diğerine girer; ikisi birlikte kaydedilir." icon={<ArrowLeftRight />} />
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            <FormField label="Nereden?" htmlFor="tf-from" required>
              <FormSelect id="tf-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
              </FormSelect>
            </FormField>
            <FormField label="Nereye?" htmlFor="tf-to" required>
              <FormSelect id="tf-to" value={to} onChange={(e) => setTo(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
              </FormSelect>
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Tutar" htmlFor="tf-amount" required>
                <FormInput id="tf-amount" name="amount" inputMode="decimal" placeholder="0,00" required autoFocus />
              </FormField>
              <FormField label="Tarih" htmlFor="tf-date">
                <FormInput id="tf-date" name="date" type="date" defaultValue={today} max={today} min="2000-01-01" />
              </FormField>
            </div>
            <FormField label="Not" htmlFor="tf-note">
              <FormTextarea id="tf-note" name="note" rows={2} maxLength={1000} />
            </FormField>
            <FormError error={error} nextStep={null} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="primary" loading={busy}>Transfer yap</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Arşivle / arşivden çıkar (hareketler silinmez, hesap yeni hareket almaz). */
export function ArchiveAccountButton({ accountId, name, archived }: { accountId: string; name: string; archived: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  async function run() {
    const res = await archiveFinanceAccount(accountId, !archived);
    if (res.error) push(res.error, "err");
    else {
      push(archived ? "Hesap arşivden çıkarıldı" : "Hesap arşivlendi", "ok");
      router.refresh();
    }
  }
  if (archived) {
    return (
      <Button variant="ghost" size="xs" icon={ArchiveRestore} onClick={run} aria-label={`${name} hesabını arşivden çıkar`}>
        Arşivden çıkar
      </Button>
    );
  }
  return (
    <ConfirmDialog
      trigger={<Button variant="ghost" size="xs" icon={Archive} aria-label={`${name} hesabını arşivle`}>Arşivle</Button>}
      title="Hesabı arşivle"
      description="Hesap listeden kalkar ve yeni hareket almaz; geçmiş hareketler ve raporlar korunur. İstediğiniz zaman geri alabilirsiniz."
      confirmLabel="Arşivle"
      tone="default"
      onConfirm={run}
    />
  );
}
