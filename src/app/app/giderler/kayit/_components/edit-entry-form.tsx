"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, FileText, Lock, Paperclip, Percent, Tag, Users, Wallet } from "lucide-react";
import { updateCashEntry } from "@/app/actions/finance-accounts";
import { linkAttachment, updateEntryV2 } from "@/app/actions/finance-ledger";
import { searchProperties } from "@/app/actions/lookup";
import { useToast } from "@/components/app/toast-provider";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormActionBar, useFormDirty } from "@/components/ui/form-action-bar";
import { FormError, FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import Link from "@/components/ui/smart-link";
import { Switch } from "@/components/ui/switch";
import { BUDGET_GROUP_LABEL, SALARY_CATEGORY, budgetCategoryFor, cashCategoryLabel } from "@/lib/finance/cash/categories";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { budgetImpact, entryEditHref, findDuplicates, similarEntries } from "@/lib/finance/entry-workspace";
import { editBaseline, entryV2Patch, validateEntryEdit, type EntryEditForm, type EntryEditSource } from "@/lib/finance/ledger/entry-edit";
import { LEDGER_VAT_RATES, entryAmounts } from "@/lib/finance/ledger/vat";
import { parseMoneyInput } from "@/lib/money-input";
import { PartyPicker } from "../../cari/party-picker";
import type { EntryFormContext } from "./entry-form";
import { AttachmentField, EntrySummary, RadioChip, Section, type UploadState } from "./entry-ui";

/**
 * Kaydı düzenle (tam sayfa; eski "Hareketi düzenle" penceresinin yerine). Defter v2'de `amount` BELGE tutarıdır: pencere
 * değil sayfa da belge tutarını nakitten geri kurar (`editBaseline`); geri kurulamayan kayıtta tutar/KDV/stopaj kilitlenir ve
 * yalnız açıklama alanları eski yolla güncellenir (nakit kendiliğinden değişmez). Ofis satırında cari ve portföy de
 * değiştirilebilir; yeni belge eklenip kayda bağlanabilir. Sağda canlı özet (bakiye farkı, bütçe, mükerrer, benzer).
 */

export type EditEntry = {
  id: string;
  accountId: string;
  direction: "in" | "out";
  /** Satırdaki NAKİT tutar (cash_entries.amount). */
  amount: number;
  currency: string;
  date: string;
  category: string | null;
  title: string;
  counterparty: string | null;
  documentUrl: string | null;
  note: string | null;
  partyId: string | null;
  partyName: string | null;
  propertyId: string | null;
  propertyLabel: string | null;
  attachmentCount: number;
  /** Ofis defteri satırı: KDV/stopaj bilgisi (verilirse defter v2 ile kaydedilir); kişisel hesapta null. */
  ledger: Omit<EntryEditSource, "amount"> | null;
};

const WITHHOLDING_CHOICES = [null, 15, 20] as const;

export function EditEntryForm({
  entry,
  account,
  readonlyReason,
  ctx,
}: {
  entry: EditEntry;
  account: { id: string; name: string; currency: string; balance: number; scope: "office" | "user" } | null;
  readonlyReason: string | null;
  ctx: EntryFormContext;
}) {
  const router = useRouter();
  const { push } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currency = entry.currency;
  const personal = account?.scope === "user";
  const v2 = Boolean(entry.ledger) && !personal && ctx.office;
  const baseline = useMemo(() => (entry.ledger ? editBaseline({ amount: entry.amount, ...entry.ledger }) : null), [entry]);
  const monetaryLocked = v2 && Boolean(baseline && !baseline.monetaryEditable);
  const [amount, setAmount] = useState(String(v2 && baseline ? baseline.document : entry.amount).replace(".", ","));
  const [date, setDate] = useState(entry.date);
  const [category, setCategory] = useState(entry.category ?? "");
  const [title, setTitle] = useState(entry.title);
  const [counterparty, setCounterparty] = useState(entry.counterparty ?? "");
  const [note, setNote] = useState(entry.note ?? "");
  const [documentUrl, setDocumentUrl] = useState(entry.documentUrl ?? "");
  const [vatRate, setVatRate] = useState<number | null>(baseline?.vatRate ?? null);
  const [vatIncluded, setVatIncluded] = useState<boolean>(baseline?.vatIncluded ?? true);
  const [whRate, setWhRate] = useState<number | null>(baseline?.withholdingRate ?? null);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(entry.partyId ? { id: entry.partyId, name: entry.partyName ?? "Seçili cari" } : null);
  const [propertyId, setPropertyId] = useState(entry.propertyId ?? "");
  const [upload, setUpload] = useState<UploadState>({ status: "idle" });
  const readonly = Boolean(readonlyReason);
  const dirty = useFormDirty(formRef, busy || readonly);

  const base = ctx.categories.filter((c) => c.direction === entry.direction && (ctx.canSalary || c.value !== SALARY_CATEGORY || entry.category === SALARY_CATEGORY));
  // Seçenekte olmayan mevcut kategori (ör. arşivlenmiş) sessizce değişmesin diye listede tutulur.
  const categories = entry.category && !base.some((c) => c.value === entry.category) ? [...base, { value: entry.category, label: cashCategoryLabel(entry.category) || entry.category, direction: entry.direction }] : base;
  const catLabelOf = (v: string | null) => ctx.categories.find((c) => c.value === v)?.label ?? (v ? (BUDGET_GROUP_LABEL[v] ?? cashCategoryLabel(v) ?? v) : "—");

  const parsed = parseMoneyInput(amount);
  const amounts =
    parsed.ok && parsed.value
      ? v2 && !monetaryLocked
        ? entryAmounts(parsed.value, vatRate, vatRate === null ? true : vatIncluded, whRate)
        : entryAmounts(monetaryLocked ? entry.amount : parsed.value, null, true, null)
      : null;
  const totals = amounts ? { ...amounts, signedCash: entry.direction === "in" ? amounts.cash : -amounts.cash } : null;
  const oldSigned = entry.direction === "in" ? entry.amount : -entry.amount;
  const whChoices = whRate !== null && !WITHHOLDING_CHOICES.includes(whRate as 15 | 20) ? [...WITHHOLDING_CHOICES, whRate] : WITHHOLDING_CHOICES;
  const partyLabel = v2 ? (picked?.name ?? counterparty) : counterparty;

  const candidate = { id: entry.id, direction: entry.direction, cash: totals?.cash ?? null, date, counterparty: partyLabel || null, category: category || null, title };
  const duplicates = findDuplicates(candidate, ctx.recent);
  const similar = similarEntries(candidate, ctx.recent, 4, new Set(duplicates.map((d) => d.entry.id)));
  const budgetKey = category ? budgetCategoryFor(category, entry.direction) : "";
  const budgetRow = v2 && budgetKey ? ctx.budgets.find((b) => b.direction === entry.direction && b.category === budgetKey) : undefined;
  // Kayıt bu ayın bütçesinde zaten sayılıyor: etki = yeni nakit − eski nakit (yalnız bu ayın kaydı).
  const sameMonth = date.slice(0, 7) === ctx.today.slice(0, 7) && entry.date.slice(0, 7) === ctx.today.slice(0, 7);
  const budget =
    budgetRow && currency === "TRY" && sameMonth && entry.category === category
      ? budgetImpact(budgetRow.budget, budgetRow.actual - entry.amount, totals?.cash ?? 0)
      : budgetRow && currency === "TRY" && date.slice(0, 7) === ctx.today.slice(0, 7)
        ? budgetImpact(budgetRow.budget, budgetRow.actual, totals?.cash ?? 0)
        : null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || readonly) return;
    const form: EntryEditForm = {
      amount: monetaryLocked && baseline ? String(baseline.document) : amount,
      date,
      category,
      title,
      counterparty: v2 && picked ? "" : counterparty,
      note,
      vatRate: v2 ? vatRate : null,
      vatIncluded: v2 ? vatIncluded : true,
      withholdingRate: v2 ? whRate : null,
    };
    // İstemci doğrulaması tek karede (sunucuya gitmeden); hatalı alana odak.
    const checked = validateEntryEdit(form, ctx.today, catLabelOf(form.category) || "Hareket");
    if (!checked.ok) {
      setError(checked.error);
      formRef.current?.querySelector<HTMLElement>(`[name="${checked.field}"]`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const v = checked.value;
    // Cari ve portföy yalnız değiştiyse gönderilir (gereksiz cari güncellemesi yok).
    const links: { partyId?: string | null; propertyId?: string | null } = {};
    if (v2 && (picked?.id ?? null) !== entry.partyId) links.partyId = picked?.id ?? null;
    if (v2 && (propertyId || null) !== entry.propertyId) links.propertyId = propertyId || null;
    // Defter v2: belge tutarı + KDV dahil/hariç + oranlar birlikte (B101). Kilitli/kişisel kayıt: eski yol, nakit aynen kalır.
    const res =
      v2 && !monetaryLocked
        ? await updateEntryV2(entry.id, { ...entryV2Patch(v), ...links })
        : await updateCashEntry(entry.id, {
            direction: entry.direction,
            amount: monetaryLocked ? String(entry.amount) : String(v.amount),
            category: v.category,
            title: v.title,
            date: v.date,
            counterparty: v.counterparty,
            documentUrl: v2 ? (entry.documentUrl ?? "") : documentUrl,
            note: v.note,
          });
    const failure = "error" in res && res.error ? res.error : null;
    if (failure) {
      setBusy(false);
      return setError(failure);
    }
    if (v2 && monetaryLocked && (links.partyId !== undefined || links.propertyId !== undefined)) {
      const linkRes = await updateEntryV2(entry.id, links);
      if (!linkRes.ok) push(`Kayıt güncellendi ama cari/portföy bağlanamadı: ${linkRes.error}`, "err");
    }
    if (upload.status === "done") {
      const linked = await linkAttachment(upload.id, { entryId: entry.id });
      if (!linked.ok) push(`Kayıt güncellendi ama belge bağlanamadı: ${linked.error}`, "err");
    }
    setBusy(false);
    push("Kayıt güncellendi", "ok");
    router.push(ctx.returnHref);
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-label="Kaydı düzenle"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          formRef.current?.requestSubmit();
        }
      }}
      className="grid gap-4"
    >
      {readonlyReason ? (
        <Alert tone="warning" title="Bu kayıt düzenlenemez" action={<ButtonLink href={ctx.returnHref} variant="secondary" size="sm">Listeye dön</ButtonLink>}>
          {readonlyReason}
        </Alert>
      ) : null}
      <fieldset disabled={readonly} className="contents">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid min-w-0 gap-4">
            <Section title="Tutar ve tarih" icon={Wallet} description={account ? `${account.name} · ${entry.direction === "in" ? "Gelir" : "Gider"} (hesap ve tür değiştirilemez)` : undefined}>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <FormField
                  label={v2 ? "Belge tutarı" : "Tutar"}
                  htmlFor="ee-amount"
                  required
                  hint={v2 ? (vatRate !== null && !vatIncluded ? "KDV hariç tutar (faturadaki matrah)" : "Faturadaki toplam (stopaj dahil)") : undefined}
                >
                  <FormInput id="ee-amount" name="amount" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} readOnly={monetaryLocked} autoFocus={!monetaryLocked && !readonly} className="numeric h-12 text-xl font-bold" />
                </FormField>
                <FormField label="Tarih" htmlFor="ee-date">
                  <FormInput id="ee-date" name="date" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} max={ctx.today} min="2000-01-01" />
                </FormField>
              </div>
            </Section>

            {v2 ? (
              <Section title="KDV ve stopaj" icon={Percent}>
                {monetaryLocked ? (
                  <p className="flex items-start gap-1.5 text-xs text-text-muted">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Bu kaydın stopaj/KDV bilgisi tutardan geri kurulamıyor; tutar alanları kilitli (nakit değişmez). Tutarı değiştirmek için kaydı iptal edip yeniden girin.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="KDV oranı">
                      <span className="mr-1 text-xs font-semibold text-text-muted">KDV</span>
                      <RadioChip name="ee-vat" checked={vatRate === null} onSelect={() => setVatRate(null)}>
                        Bilinmiyor
                      </RadioChip>
                      {LEDGER_VAT_RATES.map((r) => (
                        <RadioChip key={r} name="ee-vat" checked={vatRate === r} onSelect={() => setVatRate(r)}>
                          %{r}
                        </RadioChip>
                      ))}
                      {vatRate !== null && vatRate > 0 ? (
                        <span className="ml-auto inline-flex items-center gap-2 text-xs">
                          <label htmlFor="ee-vat-incl" className="font-semibold text-text-muted">
                            {vatIncluded ? "Tutara dahil" : "Tutara hariç"}
                          </label>
                          <Switch id="ee-vat-incl" checked={vatIncluded} onCheckedChange={setVatIncluded} aria-label="KDV tutara dahil" />
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Stopaj oranı">
                      <span className="mr-1 text-xs font-semibold text-text-muted">Stopaj</span>
                      {whChoices.map((r) => (
                        <RadioChip key={String(r)} name="ee-wh" checked={whRate === r} onSelect={() => setWhRate(r)}>
                          {r === null ? "Yok" : `%${r}`}
                        </RadioChip>
                      ))}
                    </div>
                  </>
                )}
              </Section>
            ) : null}

            <Section title="Kategori ve açıklama" icon={Tag}>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kategori" aria-required="true">
                {categories.map((c) => (
                  <RadioChip key={c.value} name="category" checked={category === c.value} onSelect={() => setCategory(c.value)}>
                    {c.label}
                  </RadioChip>
                ))}
              </div>
              <FormField label="Açıklama" htmlFor="ee-title">
                <FormInput id="ee-title" name="title" maxLength={160} value={title} onChange={(ev) => setTitle(ev.target.value)} />
              </FormField>
            </Section>

            <Section title={entry.direction === "in" ? "Kimden?" : "Kime?"} icon={Users}>
              {v2 ? (
                <FormField label="Cari" htmlFor="ee-party" hint={!picked && counterparty ? `Serbest metin: ${counterparty}` : undefined}>
                  <PartyPicker
                    id="ee-party"
                    name="party"
                    defaultValue={entry.partyId}
                    defaultLabel={entry.partyName}
                    kindHint={entry.direction === "in" ? "musteri" : "tedarikci"}
                    allowCreate
                    disabled={readonly}
                    onValueChange={(p) => setPicked(p ? { id: p.id, name: p.name } : null)}
                  />
                </FormField>
              ) : null}
              {!v2 || !picked ? (
                <FormField label={v2 ? "Karşı taraf (serbest metin)" : entry.direction === "in" ? "Kimden?" : "Kime?"} htmlFor="ee-counterparty">
                  <FormInput id="ee-counterparty" name="counterparty" maxLength={120} value={counterparty} onChange={(ev) => setCounterparty(ev.target.value)} />
                </FormField>
              ) : null}
            </Section>

            {v2 ? (
              <Section title="Bağlantılar" icon={Building2}>
                <Combobox
                  name="property_id"
                  aria-label="İlgili portföy"
                  placeholder="Bağlı portföy yok"
                  searchPlaceholder="Portföy kodu veya başlığı…"
                  emptyText="Eşleşen portföy yok"
                  onSearch={searchProperties}
                  options={entry.propertyId ? [{ value: entry.propertyId, label: entry.propertyLabel ?? "Bağlı portföy" }] : []}
                  value={propertyId}
                  onValueChange={setPropertyId}
                  selectedLabel={entry.propertyLabel ?? undefined}
                  disabled={readonly}
                />
              </Section>
            ) : null}

            <Section title="Not ve belge" icon={FileText}>
              {v2 ? (
                <>
                  {entry.attachmentCount > 0 ? (
                    <Link href={`/app/giderler?sekme=belgeler&hareket=${entry.id}`} className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-accent-text hover:underline touch:min-h-11">
                      <Paperclip className="h-3.5 w-3.5" aria-hidden="true" /> {entry.attachmentCount} ekli belgeyi gör
                    </Link>
                  ) : null}
                  {!readonly ? <AttachmentField id="ee-file" value={upload} onChange={setUpload} label="Yeni belge ekle (PDF, görsel)" /> : null}
                </>
              ) : (
                <FormField label="Belge bağlantısı" htmlFor="ee-doc" hint="Fiş, makbuz veya fatura (https://…)">
                  <FormInput id="ee-doc" name="documentUrl" type="url" inputMode="url" maxLength={500} placeholder="https://" value={documentUrl} onChange={(ev) => setDocumentUrl(ev.target.value)} />
                </FormField>
              )}
              <FormField label="Not" htmlFor="ee-note">
                <FormTextarea id="ee-note" name="note" rows={2} maxLength={1000} value={note} onChange={(ev) => setNote(ev.target.value)} />
              </FormField>
            </Section>
          </div>

          <aside className="min-w-0 lg:sticky lg:top-20" aria-label="Canlı özet">
            <EntrySummary
              direction={entry.direction}
              currency={currency}
              totals={totals}
              showTax={v2 && !monetaryLocked}
              categoryLabel={category ? catLabelOf(category) : null}
              account={
                account
                  ? {
                      name: account.name,
                      currency: account.currency,
                      before: account.balance,
                      after: Math.round((account.balance - oldSigned + (totals?.signedCash ?? oldSigned)) * 100) / 100,
                    }
                  : null
              }
              budget={budget}
              duplicates={duplicates}
              similar={similar}
              categoryLabelOf={catLabelOf}
              hrefOf={(id) => entryEditHref(id, { personal: ctx.personal })}
            />
            {account ? <p className="mt-2 text-xs text-text-muted">Kayıtlı tutar: {formatAccountMoney(entry.amount, currency)} (hesaba yansıyan).</p> : null}
          </aside>
        </div>
      </fieldset>

      <FormError error={error} nextStep={null} />
      {!readonly ? (
        <FormActionBar formRef={formRef} pending={busy} error={error} dirty={dirty} submitLabel="Değişiklikleri kaydet" submitDisabled={upload.status === "uploading"} cancelHref={ctx.returnHref} cancelLabel="Vazgeç" />
      ) : null}
    </form>
  );
}
