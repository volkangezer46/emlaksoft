"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Landmark, Pause, Pencil, Play, Plus, Repeat, SkipForward, Trash2 } from "lucide-react";
import { parseBudgetAmount, rentWithholdingBreakdown, vatBreakdown } from "@/lib/finance/expense-budget";
import {
  approveRecurringOccurrence,
  convertExpenseSeriesToRule,
  createRecurringRule,
  deleteRecurringRule,
  setRecurringRuleActive,
  skipRecurringOccurrence,
  updateRecurringRule,
} from "@/app/actions/recurring-rules";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { categoriesFor, type CashDirection } from "@/lib/finance/cash/categories";
import { PORTAL_KEYS, PORTAL_LABEL } from "@/lib/finance/portal-roi";
import { FREQUENCY_LABEL } from "@/lib/finance/recurring/rules";
import { cn } from "@/lib/utils";
import type { AccountOption } from "./quick-entry";
import { Combobox } from "@/components/ui/combobox";

export type EditableRule = {
  id: string;
  title: string;
  amount: number;
  accountId: string;
  payDay: number;
  endDate: string | null;
  mode: "auto" | "approve";
  /** Muhasebe v2: ofis kuralının carisi ve oranları (yoksa null). */
  partyId?: string | null;
  vatRate?: number | null;
  withholdingRate?: number | null;
};

/** Ofis carisi (finance_parties) — kural formunda seçilir. */
export type RulePartyOption = { id: string; name: string; kindLabel: string };

/** Hazır kural şablonları. "stopajli_kira": kira gideri, %20 stopaj; brüt, stopaj ve net ayrı gösterilir. */
export type RuleTemplate = "stopajli_kira";

const FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
const VAT_OPTIONS = [
  { value: "", label: "KDV yok / bilinmiyor" },
  { value: "1", label: "%1" },
  { value: "10", label: "%10" },
  { value: "20", label: "%20" },
] as const;
const WITHHOLDING_OPTIONS = [
  { value: "", label: "Stopaj yok" },
  { value: "20", label: "%20 (kira, serbest meslek)" },
  { value: "15", label: "%15" },
  { value: "10", label: "%10" },
] as const;

const tl = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);

/** "Düzenli ödeme ekle" (yeni) veya kural düzenle. Tek form: ne için · tutar · hangi hesap · her ay hangi gün · otomatik/bana sor. */
export function RuleFormButton({
  accounts,
  canSalary,
  today,
  rule,
  label = "Düzenli ödeme ekle",
  parties,
  template,
  variant,
}: {
  accounts: readonly AccountOption[];
  canSalary: boolean;
  /** Bugün (YYYY-MM-DD, İstanbul); sunucudan gelir. */
  today: string;
  rule?: EditableRule;
  label?: string;
  /** Verilirse (ofis sekmesi) cari, KDV ve stopaj alanları görünür. Kasam'da verilmez. */
  parties?: readonly RulePartyOption[];
  template?: RuleTemplate;
  variant?: "primary" | "outline";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {rule ? (
        <Button variant="ghost" size="xs" icon={Pencil} onClick={() => setOpen(true)} aria-label={`${rule.title} düzenle`}>
          Düzenle
        </Button>
      ) : (
        <Button variant={variant ?? (template ? "outline" : "primary")} icon={template ? Landmark : Plus} onClick={() => setOpen(true)}>
          {label}
        </Button>
      )}
      {open ? <RuleDialog accounts={accounts} canSalary={canSalary} today={today} rule={rule} parties={parties} template={template} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RuleDialog({
  accounts,
  canSalary,
  today,
  rule,
  parties,
  template,
  onClose,
}: {
  accounts: readonly AccountOption[];
  canSalary: boolean;
  today: string;
  rule?: EditableRule;
  parties?: readonly RulePartyOption[];
  template?: RuleTemplate;
  onClose: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const editing = Boolean(rule);
  const rentTemplate = template === "stopajli_kira";
  const [direction, setDirection] = useState<CashDirection>("out");
  const [category, setCategory] = useState(rentTemplate ? "kira" : "");
  const [accountId, setAccountId] = useState(rule?.accountId ?? (accounts.find((a) => a.scope === "office")?.id ?? accounts[0]?.id ?? ""));
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>("monthly");
  const [mode, setMode] = useState<"auto" | "approve">(rule?.mode ?? "auto");
  const [amountText, setAmountText] = useState(rule ? String(rule.amount).replace(".", ",") : "");
  const [partyId, setPartyId] = useState(rule?.partyId ?? "");
  const [vatRate, setVatRate] = useState(rule?.vatRate != null && rule.vatRate > 0 ? String(rule.vatRate) : "");
  const [withholdingRate, setWithholdingRate] = useState(rentTemplate ? "20" : rule?.withholdingRate != null && rule.withholdingRate > 0 ? String(rule.withholdingRate) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = accounts.find((a) => a.id === accountId);
  const categories = categoriesFor(direction).filter((c) => (canSalary && chosen?.scope === "office") || c.value !== "maas");
  const office = accounts.filter((a) => a.scope === "office");
  const personal = accounts.filter((a) => a.scope === "user");
  // Cari/KDV/stopaj yalnız ofis hesabına yazılan kuralda (kişisel kural ofis carisine bağlanmaz).
  const showTerms = parties !== undefined && chosen?.scope !== "user";
  const amountValue = parseBudgetAmount(amountText) ?? 0;
  const wh = rentWithholdingBreakdown(amountValue, Number(withholdingRate) || 0);
  const vat = vatBreakdown(amountValue, Number(vatRate) || 0, true);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const terms = showTerms ? { partyId, vatRate, withholdingRate } : {};
    const common = { amount: amountText, accountId, payDay: String(fd.get("payDay") ?? ""), mode, title: String(fd.get("title") ?? ""), ...terms };
    const res = rule
      ? await updateRecurringRule(rule.id, { ...common, endDate: String(fd.get("endDate") ?? "") })
      : await createRecurringRule({
          ...common,
          direction,
          category,
          frequency,
          startMonth: String(fd.get("startMonth") ?? ""),
          portalKey: String(fd.get("portalKey") ?? ""),
          endDate: String(fd.get("endDate") ?? ""),
        });
    setBusy(false);
    if (res.error) return setError(res.error);
    push(editing ? "Düzenli ödeme güncellendi" : "Düzenli ödeme kaydedildi", "ok");
    if (res.warning) push(res.warning, "info");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader
          title={editing ? "Düzenli ödemeyi düzenle" : rentTemplate ? "Stopajlı ofis kirası" : "Düzenli ödeme ekle"}
          description={
            rentTemplate
              ? "Brüt kirayı yazın: %20 stopaj kesilip vergi dairesine, kalan net tutar mal sahibine ödenir. Üçü ayrı gösterilir."
              : "Bir kez tanımlayın; her ay kendiliğinden işlensin ya da size sorulsun. Geçmişe dönük kayıt açılmaz."
          }
          icon={rentTemplate ? <Landmark /> : <Repeat />}
        />
        {accounts.length === 0 ? (
          <DialogBody>
            <p className="text-sm text-text-muted">Önce bir hesap açın (örneğin ofis kasası veya banka); düzenli ödemeler bir hesaba yazılır.</p>
          </DialogBody>
        ) : (
          <form onSubmit={submit}>
            <DialogBody className="grid gap-4">
              {!editing ? (
                <>
                  <div role="radiogroup" aria-label="Tür" className="inline-flex w-fit rounded-[var(--radius-control)] border border-line bg-canvas p-0.5">
                    {(["out", "in"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        role="radio"
                        aria-checked={direction === d}
                        onClick={() => {
                          setDirection(d);
                          setCategory("");
                        }}
                        className={cn("focus-ring rounded-[var(--radius-control)] px-3 py-1 text-sm font-semibold transition", direction === d ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "text-text-muted")}
                      >
                        {d === "out" ? "Gider" : "Gelir"}
                      </button>
                    ))}
                  </div>
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
                            category === c.value ? "border-brand-400/60 bg-surface-accent-soft text-accent-text" : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-accent-text",
                          )}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={withholdingRate ? "Brüt tutar" : "Tutar"} htmlFor="rl-amount" required hint={withholdingRate ? "Stopaj kesilmeden önceki tutar" : undefined}>
                  <FormInput
                    id="rl-amount"
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0,00"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    required
                    autoFocus
                  />
                </FormField>
                <FormField label="Her ay hangi gün?" htmlFor="rl-day" required hint="31 yazarsanız ayın son günü">
                  <FormInput id="rl-day" name="payDay" type="number" min={1} max={31} defaultValue={rule?.payDay ?? 1} required />
                </FormField>
              </div>

              <FormField label="Hangi hesap?" htmlFor="rl-account" required hint={chosen?.scope === "user" ? "Kişisel hesap: yalnız siz görürsünüz, ofis kâr-zararına girmez." : undefined}>
                <Combobox
                id="rl-account"
                value={accountId}
                onValueChange={setAccountId}
                required
                options={[
                  ...office.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, hint: "Ofis hesabı" })),
                  ...personal.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, hint: "Kişisel hesabım" })),
                ]}
                placeholder="Hesap seçin"
                searchPlaceholder="Hesap ara…"
                emptyText="Eşleşen hesap yok"
              />
              </FormField>

              {showTerms ? (
                <div className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
                  <FormField label="Cari (kime / kimden)" htmlFor="rl-party" hint={parties.length === 0 ? "Henüz cari yok; Cari sekmesinden ekleyebilirsiniz." : "İsteğe bağlı; cari ekstresinde görünür."}>
                    <Combobox
                      id="rl-party"
                      value={partyId}
                      onValueChange={setPartyId}
                      options={parties.map((p) => ({ value: p.id, label: p.name, hint: p.kindLabel }))}
                      placeholder="Cari seçin"
                      searchPlaceholder="Cari ara…"
                      emptyText="Eşleşen cari yok"
                    />
                  </FormField>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="KDV (tutara dahil)" htmlFor="rl-vat">
                      <FormSelect id="rl-vat" value={vatRate} onChange={(e) => setVatRate(e.target.value)}>
                        {VAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </FormSelect>
                    </FormField>
                    <FormField label="Stopaj" htmlFor="rl-wh" hint={category === "kira" && !withholdingRate ? "Şahıstan kiralanan ofiste %20 stopaj kesilir." : undefined}>
                      <FormSelect id="rl-wh" value={withholdingRate} onChange={(e) => setWithholdingRate(e.target.value)}>
                        {WITHHOLDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </FormSelect>
                    </FormField>
                  </div>
                  {amountValue > 0 && (wh.withheld > 0 || vat.vat > 0) ? (
                    <dl className="grid grid-cols-3 gap-2 text-center" aria-live="polite">
                      {wh.withheld > 0 ? (
                        <>
                          <BreakdownCell label="Brüt" value={tl(wh.gross)} />
                          <BreakdownCell label={`Stopaj %${withholdingRate}`} value={`− ${tl(wh.withheld)}`} hint="vergi dairesine" tone="warn" />
                          <BreakdownCell label="Net ödenecek" value={tl(wh.net)} hint={direction === "out" ? "mal sahibine" : "hesabınıza"} tone="strong" />
                        </>
                      ) : (
                        <>
                          <BreakdownCell label="KDV hariç" value={tl(vat.net)} />
                          <BreakdownCell label={`KDV %${vatRate}`} value={tl(vat.vat)} tone="warn" />
                          <BreakdownCell label="Toplam" value={tl(vat.gross)} tone="strong" />
                        </>
                      )}
                    </dl>
                  ) : null}
                </div>
              ) : null}

              <FormField label="Nasıl işlensin?" htmlFor="rl-mode" hint={mode === "approve" ? "Vade gelince taslak oluşur ve bildirim alırsınız; onaylayınca kaydedilir." : "Vade gününde hesaba kendiliğinden işlenir."}>
                <FormSelect id="rl-mode" value={mode} onChange={(e) => setMode(e.target.value as "auto" | "approve")}>
                  <option value="auto">Otomatik kaydet</option>
                  <option value="approve">Bana sor</option>
                </FormSelect>
              </FormField>

              <FormField label="Açıklama" htmlFor="rl-title" hint="Boş bırakırsanız ne için seçtiğiniz yazılır.">
                <FormInput id="rl-title" name="title" maxLength={160} defaultValue={rule?.title ?? (rentTemplate ? "Ofis kirası (stopajlı)" : "")} placeholder="ör. Kadıköy ofis kirası" />
              </FormField>

              {!editing ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Sıklık" htmlFor="rl-freq">
                    <FormSelect id="rl-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as (typeof FREQUENCIES)[number])}>
                      {FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
                    </FormSelect>
                  </FormField>
                  {frequency !== "monthly" ? (
                    <FormField label="İlk ödeme ayı" htmlFor="rl-start-month">
                      <FormInput id="rl-start-month" name="startMonth" type="month" defaultValue={today.slice(0, 7)} min={today.slice(0, 7)} />
                    </FormField>
                  ) : null}
                  {category === "portal" ? (
                    <FormField label="Hangi portal?" htmlFor="rl-portal" hint="Portal getirisi hesabına bağlanır.">
                      <FormSelect id="rl-portal" name="portalKey" defaultValue="">
                        <option value="">Seçmeyin</option>
                        {PORTAL_KEYS.map((k) => <option key={k} value={k}>{PORTAL_LABEL[k]}</option>)}
                      </FormSelect>
                    </FormField>
                  ) : null}
                </div>
              ) : null}

              <FormField label="Bitiş tarihi" htmlFor="rl-end" hint="İsteğe bağlı; boşsa süresiz sürer.">
                <FormInput id="rl-end" name="endDate" type="date" min={today} defaultValue={rule?.endDate ?? ""} />
              </FormField>

              <FormError error={error} nextStep={null} />
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={(!editing && !category) || !accountId}>
                {editing ? "Kaydet" : "Düzenli ödemeyi kaydet"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BreakdownCell({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" | "strong" }) {
  return (
    <div className="rounded-[var(--radius-control)] bg-surface px-2 py-1.5">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={cn("numeric text-sm font-bold", tone === "warn" ? "text-warning-strong" : tone === "strong" ? "text-text" : "text-text-muted")}>{value}</dd>
      {hint ? <dd className="text-xs text-text-faint">{hint}</dd> : null}
    </div>
  );
}

/** Satır eylemleri: durdur/sürdür, sil (yalnız hiç hareket üretmemişse). */
export function RuleRowActions({ ruleId, title, active, canEdit, canDelete }: { ruleId: string; title: string; active: boolean; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  async function toggle() {
    const res = await setRecurringRuleActive(ruleId, !active);
    if (res.error) push(res.error, "err");
    else {
      push(active ? "Düzenli ödeme durduruldu" : "Düzenli ödeme sürdürülüyor", "ok");
      router.refresh();
    }
  }
  async function remove() {
    const res = await deleteRecurringRule(ruleId);
    if (res.error) push(res.error, "err");
    else {
      push("Düzenli ödeme silindi", "ok");
      router.refresh();
    }
  }
  return (
    <span className="inline-flex items-center gap-1">
      {canEdit ? (
        <Button variant="ghost" size="xs" icon={active ? Pause : Play} onClick={toggle} aria-label={`${title} ${active ? "durdur" : "sürdür"}`}>
          {active ? "Durdur" : "Sürdür"}
        </Button>
      ) : null}
      {canDelete ? (
        <ConfirmDialog
          trigger={<Button variant="ghost" size="xs" icon={Trash2} aria-label={`${title} sil`}>Sil</Button>}
          title="Düzenli ödemeyi sil"
          description="Hiç hareket üretmemiş ödeme silinir. Hareket üretmişse silinemez; durdurabilirsiniz."
          confirmLabel="Sil"
          tone="danger"
          onConfirm={remove}
        />
      ) : null}
    </span>
  );
}

/** Onay bekleyen ödeme: onayla (tutar değiştirilebilir) veya bu ay atla. */
export function PendingActions({ occurrenceId, title, amount }: { occurrenceId: string; title: string; amount: number }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function approve(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await approveRecurringOccurrence(occurrenceId, String(fd.get("amount") ?? ""));
    setBusy(false);
    if (res.error) return setError(res.error);
    push("Ödeme onaylandı ve kaydedildi", "ok");
    setOpen(false);
    router.refresh();
  }
  async function skip() {
    const res = await skipRecurringOccurrence(occurrenceId);
    if (res.error) push(res.error, "err");
    else {
      push("Bu ayın ödemesi atlandı", "ok");
      router.refresh();
    }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="primary" size="xs" icon={Check} onClick={() => setOpen(true)} aria-label={`${title} onayla`}>Onayla</Button>
      <ConfirmDialog
        trigger={<Button variant="ghost" size="xs" icon={SkipForward} aria-label={`${title} bu ay atla`}>Atla</Button>}
        title="Bu ayı atla"
        description="Bu ayın ödemesi kaydedilmez; düzenli ödeme gelecek aydan devam eder."
        confirmLabel="Atla"
        tone="default"
        onConfirm={skip}
      />
      {open ? (
        <Dialog open onOpenChange={(v) => (v ? undefined : setOpen(false))}>
          <DialogContent size="sm">
            <DialogHeader title="Ödemeyi onayla" description={`${title} hesabınıza işlenir. Bu ay farklıysa tutarı değiştirin.`} icon={<Check />} />
            <form onSubmit={approve}>
              <DialogBody className="grid gap-4">
                <FormField label="Tutar" htmlFor="pa-amount" required>
                  <FormInput id="pa-amount" name="amount" inputMode="decimal" defaultValue={String(amount).replace(".", ",")} required autoFocus />
                </FormField>
                <FormError error={error} nextStep={null} />
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
                <Button type="submit" variant="primary" loading={busy}>Onayla ve kaydet</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </span>
  );
}

/** Tekrarlayan gider serisini kurala çevir (seri hatırlatmadan çıkar; çift kayıt olmaz). */
export function ConvertSeriesButton({ expenseId, title, officeAccounts }: { expenseId: string; title: string; officeAccounts: readonly AccountOption[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(officeAccounts[0]?.id ?? "");
  const [mode, setMode] = useState<"auto" | "approve">("auto");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (officeAccounts.length === 0) return null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await convertExpenseSeriesToRule(expenseId, { accountId, mode });
    setBusy(false);
    if (res.error) return setError(res.error);
    push("Düzenli ödemeye çevrildi", "ok");
    setOpen(false);
    router.refresh();
  }
  return (
    <>
      <Button variant="ghost" size="xs" icon={Repeat} onClick={() => setOpen(true)} aria-label={`${title} serisini düzenli ödemeye çevir`}>
        Kurala çevir
      </Button>
      {open ? (
        <Dialog open onOpenChange={(v) => (v ? undefined : setOpen(false))}>
          <DialogContent size="sm">
            <DialogHeader title="Düzenli ödemeye çevir" description={`${title} artık her ay otomatik işlenir; eski hatırlatma kalkar. Geçmiş aylar için kayıt açılmaz.`} icon={<Repeat />} />
            <form onSubmit={submit}>
              <DialogBody className="grid gap-4">
                <FormField label="Hangi hesaptan?" htmlFor="cs-account" required>
                  <Combobox
                    id="cs-account"
                    value={accountId}
                    onValueChange={setAccountId}
                    clearable={false}
                    options={officeAccounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
                    placeholder="Hesap seçin"
                    searchPlaceholder="Hesap ara…"
                    emptyText="Eşleşen hesap yok"
                  />
                </FormField>
                <FormField label="Nasıl işlensin?" htmlFor="cs-mode">
                  <FormSelect id="cs-mode" value={mode} onChange={(e) => setMode(e.target.value as "auto" | "approve")}>
                    <option value="auto">Otomatik kaydet</option>
                    <option value="approve">Bana sor</option>
                  </FormSelect>
                </FormField>
                <FormError error={error} nextStep={null} />
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Vazgeç</Button>
                <Button type="submit" variant="primary" loading={busy}>Kurala çevir</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
