"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownCircle, ArrowUpCircle, ChevronDown } from "lucide-react";
import { recordCashEntry } from "@/app/actions/finance-accounts";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormField, FormInput, FormSelect, FormError, FormTextarea } from "@/components/ui/form-controls";
import Link from "@/components/ui/smart-link";
import { Switch } from "@/components/ui/switch";
import { categoriesFor, type CashDirection } from "@/lib/finance/cash/categories";
import { cn } from "@/lib/utils";

export type AccountOption = { id: string; name: string; kind: string; currency: string; scope: "office" | "user" };

const LAST_ACCOUNT_KEY = "emlaksoft:finance:last-account";

function initialAccount(accounts: readonly AccountOption[]): string {
  let saved = "";
  try {
    saved = window.localStorage.getItem(LAST_ACCOUNT_KEY) ?? "";
  } catch {
    saved = "";
  }
  if (accounts.some((a) => a.id === saved)) return saved;
  return (accounts.find((a) => a.scope === "office" && a.kind === "cash") ?? accounts[0])?.id ?? "";
}

/** Sayfa üstündeki iki birincil düğme: "Gelir ekle" ve "Gider ekle" (her sekmede). Tek form, 3 zorunlu alan. */
export function QuickEntryButtons({
  accounts,
  defaultDate,
  canSalary,
}: {
  accounts: readonly AccountOption[];
  /** Bugün (YYYY-MM-DD, İstanbul); sunucudan gelir — istemci saati kullanılmaz. */
  defaultDate: string;
  canSalary: boolean;
}) {
  const [open, setOpen] = useState<CashDirection | null>(null);
  return (
    <>
      <Button variant="primary" icon={ArrowDownCircle} onClick={() => setOpen("in")}>
        Gelir ekle
      </Button>
      <Button variant="outline" icon={ArrowUpCircle} onClick={() => setOpen("out")}>
        Gider ekle
      </Button>
      {open ? (
        <EntryDialog direction={open} accounts={accounts} defaultDate={defaultDate} canSalary={canSalary} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

function EntryDialog({
  direction,
  accounts,
  defaultDate,
  canSalary,
  onClose,
}: {
  direction: CashDirection;
  accounts: readonly AccountOption[];
  defaultDate: string;
  canSalary: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const income = direction === "in";
  const categories = categoriesFor(direction).filter((c) => canSalary || c.value !== "maas");
  const [category, setCategory] = useState("");
  const [accountId, setAccountId] = useState(() => initialAccount(accounts));
  const [showDate, setShowDate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"auto" | "approve">("auto");
  const office = accounts.filter((a) => a.scope === "office");
  const personal = accounts.filter((a) => a.scope === "user");
  const chosen = accounts.find((a) => a.id === accountId);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await recordCashEntry(direction, {
      accountId,
      amount: String(fd.get("amount") ?? ""),
      category,
      title: String(fd.get("title") ?? ""),
      date: String(fd.get("date") ?? ""),
      counterparty: String(fd.get("counterparty") ?? ""),
      documentUrl: String(fd.get("documentUrl") ?? ""),
      note: String(fd.get("note") ?? ""),
      repeatMonthly: repeat,
      repeatDay: String(fd.get("repeatDay") ?? ""),
      repeatMode,
    });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    try {
      window.localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
    } catch {
      /* tercih saklanamadı: sorun değil */
    }
    push(income ? "Gelir kaydedildi" : "Gider kaydedildi", "ok");
    if (res.info) push(res.info, "err");
    else if (repeat) push("Gelecek aydan itibaren her ay tekrarlanacak", "ok");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader
          title={income ? "Gelir ekle" : "Gider ekle"}
          description="Tutar, ne için ve hangi hesap — gerisi isteğe bağlı."
          icon={income ? <ArrowDownCircle /> : <ArrowUpCircle />}
        />
        {accounts.length === 0 ? (
          <DialogBody>
            <p className="text-sm text-text-muted">Önce bir hesap açın (örneğin ofis kasası); hareketler hesaba yazılır.</p>
            <Link href="/app/giderler?sekme=kasa-banka" className="mt-3 inline-block text-sm font-semibold text-accent-text hover:underline" onClick={onClose}>
              Kasa ve banka sekmesine git
            </Link>
          </DialogBody>
        ) : (
          <form onSubmit={submit}>
            <DialogBody className="grid gap-4">
              <FormField label="Tutar" htmlFor="qe-amount" required>
                <FormInput id="qe-amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="0,00" autoFocus required />
              </FormField>

              <div>
                <p className="mb-1.5 text-sm font-medium text-ink-950">
                  Ne için? <span aria-hidden="true" className="text-danger-500">*</span>
                </p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ne için">
                  {categories.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={category === c.value}
                      onClick={() => setCategory(c.value)}
                      className={cn(
                        "focus-ring press rounded-full border px-3 py-1 text-xs font-semibold transition touch:min-h-11",
                        category === c.value
                          ? "border-brand-400/60 bg-surface-accent-soft text-accent-text"
                          : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-accent-text",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <FormInput name="title" maxLength={160} placeholder="Açıklama (isteğe bağlı)" aria-label="Açıklama" className="mt-2" />
              </div>

              <FormField label="Hangi hesap?" htmlFor="qe-account" required hint={chosen?.scope === "user" ? "Kişisel hesap: yalnız siz görürsünüz, ofis kâr-zararına girmez." : undefined}>
                <FormSelect id="qe-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                  {office.length > 0 ? (
                    <optgroup label="Ofis hesapları">
                      {office.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                    </optgroup>
                  ) : null}
                  {personal.length > 0 ? (
                    <optgroup label="Kişisel hesaplarım">
                      {personal.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                    </optgroup>
                  ) : null}
                </FormSelect>
              </FormField>

              {showDate ? (
                <FormField label="Tarih" htmlFor="qe-date">
                  <FormInput id="qe-date" name="date" type="date" defaultValue={defaultDate} max={defaultDate} min="2000-01-01" />
                </FormField>
              ) : (
                <p className="text-xs text-text-muted">
                  Tarih: bugün.{" "}
                  <button type="button" onClick={() => setShowDate(true)} className="focus-ring font-semibold text-accent-text hover:underline">
                    Tarihi değiştir
                  </button>
                </p>
              )}

              <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="qe-repeat" className="text-sm font-semibold text-text">
                    Her ay tekrarla
                    <span className="block text-xs font-normal text-text-muted">Gelecek aydan itibaren aynı tutar kendiliğinden işlenir.</span>
                  </label>
                  <Switch id="qe-repeat" checked={repeat} onCheckedChange={setRepeat} aria-label="Her ay tekrarla" />
                </div>
                {repeat ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <FormField label="Ayın kaçıncı günü?" htmlFor="qe-repeat-day" hint="31 = ayın son günü">
                      <FormInput id="qe-repeat-day" name="repeatDay" type="number" min={1} max={31} defaultValue={Number(defaultDate.slice(8, 10))} />
                    </FormField>
                    <FormField label="Nasıl işlensin?" htmlFor="qe-repeat-mode">
                      <FormSelect id="qe-repeat-mode" value={repeatMode} onChange={(e) => setRepeatMode(e.target.value as "auto" | "approve")}>
                        <option value="auto">Otomatik kaydet</option>
                        <option value="approve">Bana sor</option>
                      </FormSelect>
                    </FormField>
                  </div>
                ) : null}
              </div>

              <details className="group rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-text-muted [&::-webkit-details-marker]:hidden">
                  Ayrıntı ekle
                  <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="mt-3 grid gap-3">
                  <FormField label={income ? "Kimden?" : "Kime?"} htmlFor="qe-counterparty">
                    <FormInput id="qe-counterparty" name="counterparty" maxLength={120} placeholder={income ? "Müşteri / kurum" : "Firma / kişi"} />
                  </FormField>
                  <FormField label="Belge bağlantısı" htmlFor="qe-doc" hint="Fiş, makbuz veya fatura (https://…)">
                    <FormInput id="qe-doc" name="documentUrl" type="url" inputMode="url" maxLength={500} placeholder="https://" />
                  </FormField>
                  <FormField label="Not" htmlFor="qe-note">
                    <FormTextarea id="qe-note" name="note" rows={2} maxLength={1000} />
                  </FormField>
                </div>
              </details>

              <FormError error={error} nextStep={null} />
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={!category || !accountId}>
                {income ? "Geliri kaydet" : "Gideri kaydet"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
