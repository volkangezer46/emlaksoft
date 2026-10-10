"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pause, Pencil, Play, Plus, Repeat, SkipForward, Trash2 } from "lucide-react";
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

export type EditableRule = {
  id: string;
  title: string;
  amount: number;
  accountId: string;
  payDay: number;
  endDate: string | null;
  mode: "auto" | "approve";
};

const FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;

/** "Düzenli ödeme ekle" (yeni) veya kural düzenle. Tek form: ne için · tutar · hangi hesap · her ay hangi gün · otomatik/bana sor. */
export function RuleFormButton({
  accounts,
  canSalary,
  today,
  rule,
  label = "Düzenli ödeme ekle",
}: {
  accounts: readonly AccountOption[];
  canSalary: boolean;
  /** Bugün (YYYY-MM-DD, İstanbul); sunucudan gelir. */
  today: string;
  rule?: EditableRule;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {rule ? (
        <Button variant="ghost" size="xs" icon={Pencil} onClick={() => setOpen(true)} aria-label={`${rule.title} düzenle`}>
          Düzenle
        </Button>
      ) : (
        <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
          {label}
        </Button>
      )}
      {open ? <RuleDialog accounts={accounts} canSalary={canSalary} today={today} rule={rule} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RuleDialog({
  accounts,
  canSalary,
  today,
  rule,
  onClose,
}: {
  accounts: readonly AccountOption[];
  canSalary: boolean;
  today: string;
  rule?: EditableRule;
  onClose: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const editing = Boolean(rule);
  const [direction, setDirection] = useState<CashDirection>("out");
  const [category, setCategory] = useState("");
  const [accountId, setAccountId] = useState(rule?.accountId ?? (accounts.find((a) => a.scope === "office")?.id ?? accounts[0]?.id ?? ""));
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>("monthly");
  const [mode, setMode] = useState<"auto" | "approve">(rule?.mode ?? "auto");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = accounts.find((a) => a.id === accountId);
  const categories = categoriesFor(direction).filter((c) => (canSalary && chosen?.scope === "office") || c.value !== "maas");
  const office = accounts.filter((a) => a.scope === "office");
  const personal = accounts.filter((a) => a.scope === "user");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const common = { amount: String(fd.get("amount") ?? ""), accountId, payDay: String(fd.get("payDay") ?? ""), mode, title: String(fd.get("title") ?? "") };
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
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader
          title={editing ? "Düzenli ödemeyi düzenle" : "Düzenli ödeme ekle"}
          description="Bir kez tanımlayın; her ay kendiliğinden işlensin ya da size sorulsun. Geçmişe dönük kayıt açılmaz."
          icon={<Repeat />}
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
                <FormField label="Tutar" htmlFor="rl-amount" required>
                  <FormInput id="rl-amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="0,00" defaultValue={rule ? String(rule.amount).replace(".", ",") : ""} required autoFocus />
                </FormField>
                <FormField label="Her ay hangi gün?" htmlFor="rl-day" required hint="31 yazarsanız ayın son günü">
                  <FormInput id="rl-day" name="payDay" type="number" min={1} max={31} defaultValue={rule?.payDay ?? 1} required />
                </FormField>
              </div>

              <FormField label="Hangi hesap?" htmlFor="rl-account" required hint={chosen?.scope === "user" ? "Kişisel hesap: yalnız siz görürsünüz, ofis kâr-zararına girmez." : undefined}>
                <FormSelect id="rl-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                  {office.length > 0 ? (
                    <optgroup label="Ofis hesapları">{office.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</optgroup>
                  ) : null}
                  {personal.length > 0 ? (
                    <optgroup label="Kişisel hesaplarım">{personal.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</optgroup>
                  ) : null}
                </FormSelect>
              </FormField>

              <FormField label="Nasıl işlensin?" htmlFor="rl-mode" hint={mode === "approve" ? "Vade gelince taslak oluşur ve bildirim alırsınız; onaylayınca kaydedilir." : "Vade gününde hesaba kendiliğinden işlenir."}>
                <FormSelect id="rl-mode" value={mode} onChange={(e) => setMode(e.target.value as "auto" | "approve")}>
                  <option value="auto">Otomatik kaydet</option>
                  <option value="approve">Bana sor</option>
                </FormSelect>
              </FormField>

              <FormField label="Açıklama" htmlFor="rl-title" hint="Boş bırakırsanız ne için seçtiğiniz yazılır.">
                <FormInput id="rl-title" name="title" maxLength={160} defaultValue={rule?.title ?? ""} placeholder="ör. Kadıköy ofis kirası" />
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
                  <FormSelect id="cs-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    {officeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                  </FormSelect>
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
