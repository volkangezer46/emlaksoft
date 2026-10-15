"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Undo2 } from "lucide-react";
import { recordCashEntry, updateCashEntry, voidCashEntry } from "@/app/actions/finance-accounts";
import { adoptLegacyExpenses, updateEntryV2 } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";
import { cashCategoryLabel, categoriesFor, isCashCategory, type CashDirection } from "@/lib/finance/cash/categories";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { editBaseline, entryV2Patch, validateEntryEdit, type EntryEditForm, type EntryEditSource } from "@/lib/finance/ledger/entry-edit";
import { LEDGER_VAT_RATES, entryAmounts } from "@/lib/finance/ledger/vat";
import { parseMoneyInput } from "@/lib/money-input";
import { cn } from "@/lib/utils";

export type EditableEntry = {
  id: string;
  direction: CashDirection;
  /** Satırdaki NAKİT tutar (cash_entries.amount). */
  amount: number;
  date: string;
  category: string | null;
  title: string;
  counterparty: string | null;
  note: string | null;
  /**
   * Muhasebe defteri (ofis hesabı) satırı: KDV/stopaj bilgisi. Verilirse pencere defter v2 ile kaydeder (`updateEntryV2`:
   * belge tutarı + KDV dahil/hariç + KDV ve stopaj oranı). Verilmezse (kişisel Kasam) eski yol (`updateCashEntry`).
   */
  ledger?: Omit<EntryEditSource, "amount"> | null;
  /** Ofisin kendi kategorileri dahil seçenekler; verilmezse sistem kategorileri. */
  categoryOptions?: readonly { value: string; label: string }[];
  currency?: string;
};

/**
 * İptal sonrası "Geri al" için gereken bilgi (yalnız elle girilen gelir/gider). İptal kaydı silmez; geri alma aynı bilgilerle
 * yeni bir hareket yazar. `hadExpense`: hareket ofis giderini KENDİSİ üretmişti (created_expense; iptal o gideri sildi), geri
 * alınca yeniden üretilir. `adoptExpenseId`: hareket "Hesaba taşı" ile benimsenmiş eski gidere bağlıydı (gider iptalde
 * silinmez, yeniden "Hesapsız" olur); geri al yeni gider YAZMAZ, aynı gideri aynı hesaba yeniden taşır (çift sayım olmaz).
 */
export type UndoInfo = { accountId: string; hadExpense: boolean; adoptExpenseId?: string | null };

/** Hareket satırı eylemleri: düzenle (yalnız elle girilen gelir/gider) ve iptal (neden zorunlu; silinmez). */
export function EntryRowActions({
  entry,
  today,
  canEdit,
  canVoid,
  canSalary,
  isTransfer,
  undo,
  disabledReason,
}: {
  entry: EditableEntry;
  today: string;
  canEdit: boolean;
  canVoid: boolean;
  canSalary: boolean;
  isTransfer: boolean;
  /** Verilirse iptal bildiriminde "Geri al" çıkar. */
  undo?: UndoInfo | null;
  /** Kilitli dönem vb.: düğmeler pasif, neden ipucu olarak gösterilir. */
  disabledReason?: string | null;
}) {
  const [mode, setMode] = useState<"edit" | "void" | null>(null);
  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit ? (
        <Button
          variant="ghost"
          size="xs"
          icon={Pencil}
          onClick={() => setMode("edit")}
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? undefined}
          data-row-primary=""
          aria-label={`${entry.title} hareketini düzenle`}
        >
          Düzenle
        </Button>
      ) : null}
      {canVoid ? (
        <Button
          variant="ghost"
          size="xs"
          icon={Undo2}
          onClick={() => setMode("void")}
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? undefined}
          aria-label={`${entry.title} hareketini iptal et`}
        >
          İptal
        </Button>
      ) : null}
      {mode === "edit" ? <EditDialog entry={entry} today={today} canSalary={canSalary} onClose={() => setMode(null)} /> : null}
      {mode === "void" ? <VoidDialog entry={entry} isTransfer={isTransfer} undo={undo ?? null} onClose={() => setMode(null)} /> : null}
    </div>
  );
}

/** KDV/stopaj seçim çipi: gizli yerel radyo + etiket (klavye/ekran okuyucu yerel davranış; dokunma hedefi 44 px). */
function Chip({ name, checked, onSelect, children }: { name: string; checked: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <label
      className={cn(
        "press inline-flex min-h-9 touch:min-h-11 cursor-pointer items-center gap-1 rounded-full border px-3 text-xs font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 has-[:focus-visible]:ring-offset-1",
        checked ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-ink-950",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
    </label>
  );
}

const WITHHOLDING_CHOICES = [null, 15, 20] as const;

function EditDialog({ entry, today, canSalary, onClose }: { entry: EditableEntry; today: string; canSalary: boolean; onClose: () => void }) {
  const { push } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currency = entry.currency ?? "TRY";
  // Defter (ofis) satırı: belge tutarı nakitten geri kurulur; nakdi birebir veremiyorsa tutar alanları kilitlenir.
  const baseline = useMemo(() => (entry.ledger ? editBaseline({ amount: entry.amount, ...entry.ledger }) : null), [entry]);
  const v2 = Boolean(baseline);
  const monetaryLocked = Boolean(baseline && !baseline.monetaryEditable);
  const [amount, setAmount] = useState(String(baseline ? baseline.document : entry.amount).replace(".", ","));
  const [vatRate, setVatRate] = useState<number | null>(baseline?.vatRate ?? null);
  const [vatIncluded, setVatIncluded] = useState<boolean>(baseline?.vatIncluded ?? true);
  const [whRate, setWhRate] = useState<number | null>(baseline?.withholdingRate ?? null);
  const base = entry.categoryOptions ?? categoriesFor(entry.direction).filter((c) => canSalary || c.value !== "maas" || entry.category === "maas");
  // Seçenekte olmayan mevcut kategori (ör. arşivlenmiş) sessizce değişmesin diye listede tutulur.
  const categories = entry.category && !base.some((c) => c.value === entry.category) ? [...base, { value: entry.category, label: entry.category }] : base;
  const parsedAmount = parseMoneyInput(amount);
  const preview = v2 && !monetaryLocked && parsedAmount.ok && parsedAmount.value ? entryAmounts(parsedAmount.value, vatRate, vatRate === null ? true : vatIncluded, whRate) : null;
  const whChoices = whRate !== null && !WITHHOLDING_CHOICES.includes(whRate as 15 | 20) ? [...WITHHOLDING_CHOICES, whRate] : WITHHOLDING_CHOICES;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const form: EntryEditForm = {
      amount: monetaryLocked ? String(baseline!.document) : amount,
      date: String(fd.get("date") ?? ""),
      category: String(fd.get("category") ?? ""),
      title: String(fd.get("title") ?? ""),
      counterparty: String(fd.get("counterparty") ?? ""),
      note: String(fd.get("note") ?? ""),
      vatRate: v2 ? vatRate : null,
      vatIncluded: v2 ? vatIncluded : true,
      withholdingRate: v2 ? whRate : null,
    };
    // İstemci doğrulaması tek karede (sunucuya gitmeden); hatalı alana odak.
    const checked = validateEntryEdit(form, today, cashCategoryLabel(form.category) || "Hareket");
    if (!checked.ok) {
      setError(checked.error);
      (formRef.current?.querySelector(`[name="${checked.field}"]`) as HTMLElement | null)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const v = checked.value;
    // Defter v2: belge tutarı + KDV dahil/hariç + oranlar birlikte (B101). Kilitli/kişisel kayıt: eski yol, nakit aynen kalır.
    const res =
      v2 && !monetaryLocked
        ? await updateEntryV2(entry.id, entryV2Patch(v))
        : await updateCashEntry(entry.id, {
            direction: entry.direction,
            amount: monetaryLocked ? String(entry.amount) : String(v.amount),
            category: v.category,
            title: v.title,
            date: v.date,
            counterparty: v.counterparty,
            note: v.note,
          });
    setBusy(false);
    const failure = "error" in res && res.error ? res.error : null;
    if (failure) return setError(failure);
    // Eylem revalidatePath yapar; sayfa aynı yanıtla tazelenir (ayrıca router.refresh yok: çift tazeleme, B037).
    push("Hareket güncellendi", "ok");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader title="Hareketi düzenle" description="Tahsilata veya transfere bağlı hareketler düzenlenemez." icon={<Pencil />} />
        <form ref={formRef} onSubmit={submit} noValidate>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={v2 ? "Belge tutarı" : "Tutar"}
                htmlFor="ee-amount"
                required
                hint={v2 ? (vatRate !== null && !vatIncluded ? "KDV hariç tutar (faturadaki matrah)" : "Faturadaki toplam (stopaj dahil)") : undefined}
              >
                <FormInput
                  id="ee-amount"
                  name="amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(ev) => setAmount(ev.target.value)}
                  readOnly={monetaryLocked}
                  required
                  autoFocus={!monetaryLocked}
                />
              </FormField>
              <FormField label="Tarih" htmlFor="ee-date">
                <FormInput id="ee-date" name="date" type="date" defaultValue={entry.date} max={today} min="2000-01-01" />
              </FormField>
            </div>
            {v2 ? (
              <div className="rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5">
                {monetaryLocked ? (
                  <p className="text-xs text-text-muted">
                    Bu hareketin stopaj/KDV bilgisi tutardan geri kurulamıyor; tutar alanları kilitli (nakit değişmez). Tutarı değiştirmek için hareketi iptal edip yeniden girin.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="KDV oranı">
                      <span className="mr-1 text-xs font-semibold text-text-muted">KDV</span>
                      <Chip name="ee-vat" checked={vatRate === null} onSelect={() => setVatRate(null)}>Bilinmiyor</Chip>
                      {LEDGER_VAT_RATES.map((r) => (
                        <Chip key={r} name="ee-vat" checked={vatRate === r} onSelect={() => setVatRate(r)}>%{r}</Chip>
                      ))}
                      {vatRate !== null && vatRate > 0 ? (
                        <span className="ml-auto inline-flex items-center gap-2 text-xs">
                          <label htmlFor="ee-vat-incl" className="font-semibold text-text-muted">{vatIncluded ? "Tutara dahil" : "Tutara hariç"}</label>
                          <Switch id="ee-vat-incl" checked={vatIncluded} onCheckedChange={setVatIncluded} aria-label="KDV tutara dahil" />
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Stopaj oranı">
                      <span className="mr-1 text-xs font-semibold text-text-muted">Stopaj</span>
                      {whChoices.map((r) => (
                        <Chip key={String(r)} name="ee-wh" checked={whRate === r} onSelect={() => setWhRate(r)}>{r === null ? "Yok" : `%${r}`}</Chip>
                      ))}
                    </div>
                    {preview ? (
                      <p className="numeric mt-2 text-xs text-text-muted" aria-live="polite">
                        Net {formatAccountMoney(preview.net, currency)}
                        {preview.vat !== null ? <> · KDV {formatAccountMoney(preview.vat, currency)}</> : null}
                        {preview.withheld ? <> · Stopaj {formatAccountMoney(preview.withheld, currency)}</> : null}
                        {" · "}Hesaba yansıyan <strong className="text-text">{formatAccountMoney(preview.cash, currency)}</strong>
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
            <FormField label="Ne için?" htmlFor="ee-category" required>
              <FormSelect id="ee-category" name="category" defaultValue={entry.category ?? ""} required>
                {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </FormSelect>
            </FormField>
            <FormField label="Açıklama" htmlFor="ee-title">
              <FormInput id="ee-title" name="title" maxLength={160} defaultValue={entry.title} />
            </FormField>
            <FormField label={entry.direction === "in" ? "Kimden?" : "Kime?"} htmlFor="ee-counterparty">
              <FormInput id="ee-counterparty" name="counterparty" maxLength={120} defaultValue={entry.counterparty ?? ""} />
            </FormField>
            <FormField label="Not" htmlFor="ee-note">
              <FormTextarea id="ee-note" name="note" rows={2} maxLength={1000} defaultValue={entry.note ?? ""} />
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

function VoidDialog({ entry, isTransfer, undo, onClose }: { entry: EditableEntry; isTransfer: boolean; undo: UndoInfo | null; onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await voidCashEntry(entry.id, String(fd.get("reason") ?? ""));
    setBusy(false);
    if (res.error) return setError(res.error);
    // Geri al: iptal edilen elle girilmiş hareket aynı bilgilerle yeniden yazılır (sistem kategorisi + transfer değil).
    const restorable = undo && !isTransfer && entry.category && isCashCategory(entry.category, entry.direction) ? undo : null;
    push("Hareket iptal edildi", "ok", restorable ? { action: { label: "Geri al", onClick: () => void restore(restorable) } } : undefined);
    // Eylem revalidatePath yapar: sayfa aynı yanıtla tazelenir (router.refresh ikinci tur olurdu, B037).
    onClose();
  }

  async function restore(info: UndoInfo) {
    if (info.adoptExpenseId) {
      const adopted = await adoptLegacyExpenses(info.accountId, [info.adoptExpenseId]);
      if (!adopted.ok) return push(adopted.error, "err");
      if ((adopted.count ?? 0) === 0) return push("Gider yeniden hesaba taşınamadı; Hesapsız listesinden elle taşıyın.", "err");
      push("Hareket geri alındı (gider yeniden hesaba taşındı)", "ok");
      router.refresh();
      return;
    }
    const res = await recordCashEntry(entry.direction, {
      accountId: info.accountId,
      amount: String(entry.amount),
      date: entry.date,
      category: entry.category ?? "",
      title: entry.title,
      counterparty: entry.counterparty ?? "",
      note: entry.note ?? "",
      alsoExpense: info.hadExpense,
    });
    if (res.error) return push(res.error, "err");
    push("Hareket geri alındı", "ok");
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader
          title="Hareketi iptal et"
          description={isTransfer ? "Transferin iki bacağı birlikte iptal edilir." : "Kayıt silinmez; bakiyeden düşer ve iptal nedeniyle saklanır."}
          icon={<Undo2 />}
          tone="danger"
        />
        <form onSubmit={submit}>
          <DialogBody className="grid gap-4">
            <FormField label="İptal nedeni" htmlFor="ve-reason" required>
              <FormInput id="ve-reason" name="reason" maxLength={300} placeholder="ör. yanlış tutar girildi" required autoFocus />
            </FormField>
            <FormError error={error} nextStep={null} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
            <Button type="submit" variant="danger" loading={busy}>Hareketi iptal et</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
