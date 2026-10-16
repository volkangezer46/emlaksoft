"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck2, CheckCircle2, ListPlus, Lock, Plus, Printer, RotateCcw, Trash2, Wand2 } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormError, FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import {
  approveBuildingBudget,
  accrueBuildingBudget,
  deleteBuildingBudget,
  reopenBuildingBudget,
  saveBuildingBudget,
} from "@/app/actions/building-budget";
import {
  BUDGET_DISTRIBUTIONS,
  BUILDING_EXPENSE_CATEGORIES,
  advanceRoundingGap,
  budgetPeriodLabel,
  monthLabelTr,
  monthlyAdvance,
  parseBudgetLines,
  type BudgetDistribution,
} from "@/lib/building-management/budget";
import { DISTRIBUTION_LABELS, distributeAmount } from "@/lib/building-management/distribution";
import type { BudgetRow } from "@/lib/building-management/budget-load";
import type { UnitRow } from "@/lib/building-management/load";

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);

type LineDraft = { key: number; category: string; label: string; amount: string };

/** Türk apartman/site işletme projelerinde en sık görülen kalemler (tutarlar boş gelir; ofis girer). */
const STARTER_LINES: { category: string; label: string }[] = [
  { category: "Personel", label: "Kapıcı / görevli maaşı ve SGK" },
  { category: "Temizlik", label: "Ortak alan temizliği" },
  { category: "Elektrik", label: "Ortak alan elektriği" },
  { category: "Su", label: "Ortak su" },
  { category: "Isıtma / doğalgaz", label: "Merkezi ısıtma / yakıt" },
  { category: "Asansör", label: "Asansör bakım sözleşmesi ve periyodik kontrol" },
  { category: "Sigorta", label: "Bina sigortası (DASK hariç)" },
  { category: "Bakım-onarım", label: "Küçük bakım-onarım" },
  { category: "Yönetim ücreti", label: "Profesyonel yönetim hizmeti" },
  { category: "Yedek akçe", label: "Yedek akçe" },
];

let keySeq = 0;
const nextKey = () => (keySeq += 1);

/**
 * İşletme projesi düzenleyici (taslak). Kalemler, dönem, dağıtım ve genel kurul karar bilgisi; canlı yıllık toplam, aylık avans ve
 * daire başı aylık avans önizlemesi (sunucuyla AYNI saf dağıtım fonksiyonu).
 */
export function BudgetEditor({
  buildingId,
  budget,
  units,
  defaultStartMonth,
  defaultDistribution,
}: {
  buildingId: string;
  budget: BudgetRow | null;
  units: UnitRow[];
  defaultStartMonth: string;
  defaultDistribution: BudgetDistribution;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(budget?.title ?? `${defaultStartMonth.slice(0, 4)} yılı işletme projesi`);
  const [startMonth, setStartMonth] = useState(budget ? budget.periodStart.slice(0, 7) : defaultStartMonth);
  const [months, setMonths] = useState(String(budget?.months ?? 12));
  const [distribution, setDistribution] = useState<BudgetDistribution>(budget?.distribution ?? defaultDistribution);
  const [lines, setLines] = useState<LineDraft[]>(() =>
    budget && budget.lines.length > 0
      ? budget.lines.map((l) => ({ key: nextKey(), category: l.category ?? "Diğer", label: l.label, amount: String(l.amount).replace(".", ",") }))
      : [{ key: nextKey(), category: "Bakım-onarım", label: "", amount: "" }],
  );
  const active = useMemo(() => units.filter((u) => u.active), [units]);

  const parsed = useMemo(() => parseBudgetLines(lines.map((l) => ({ category: l.category, label: l.label, amount: l.amount }))), [lines]);
  const monthsN = Math.min(Math.max(Math.trunc(Number(months)) || 12, 1), 24);
  const total = parsed.ok ? parsed.total : 0;
  const monthly = total > 0 ? monthlyAdvance(total, monthsN) : 0;
  const gap = total > 0 ? advanceRoundingGap(total, monthsN) : 0;
  const preview = useMemo(() => {
    if (!(monthly > 0) || active.length === 0) return null;
    return distributeAmount({
      method: distribution,
      total: monthly,
      units: active.map((u) => ({ id: u.id, label: u.label, areaM2: u.areaM2, landShare: u.landShare })),
    });
  }, [monthly, distribution, active]);

  const setLine = (key: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  const addLine = () => setLines((ls) => [...ls, { key: nextKey(), category: "Diğer", label: "", amount: "" }]);
  const starter = () =>
    setLines((ls) => {
      const kept = ls.filter((l) => l.label.trim() || l.amount.trim());
      const have = new Set(kept.map((l) => l.label.trim()));
      return [...kept, ...STARTER_LINES.filter((s) => !have.has(s.label)).map((s) => ({ key: nextKey(), category: s.category, label: s.label, amount: "" }))];
    });

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await saveBuildingBudget({
        id: budget?.id ?? null,
        buildingId,
        title,
        startMonth,
        months: monthsN,
        distribution,
        lines: lines.map((l) => ({ category: l.category, label: l.label, amount: l.amount })),
        decisionDate: String(fd.get("decisionDate") ?? ""),
        decisionNo: String(fd.get("decisionNo") ?? ""),
        decisionNote: String(fd.get("decisionNote") ?? ""),
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      push(res.info ?? "İşletme projesi kaydedildi", "ok");
      if (!budget && res.id) router.replace(`/app/aidat?sekme=binalar&bina=${buildingId}&bolum=butce&proje=${res.id}`, { scroll: false });
      else router.refresh();
    });
  }

  const showEmptyLineHint = !parsed.ok && lines.every((l) => !l.label.trim() && !l.amount.trim());
  return (
    <form action={submit} className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-label="İşletme projesi">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <ListPlus className="h-4 w-4 text-brand-600" aria-hidden="true" /> {budget ? "İşletme projesini düzenle" : "Yeni işletme projesi"}
          </h3>
          <p className="mt-0.5 text-xs text-text-muted">Yıllık gider kalemlerini girin; aylık avans her daireye seçtiğiniz yönteme göre dağıtılır. Onaydan sonra kalemler kilitlenir.</p>
        </div>
        <Button type="button" size="sm" variant="outline" icon={Wand2} onClick={starter}>Örnek kalemleri ekle</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Proje adı" htmlFor="budget-title" required className="sm:col-span-2">
          <FormInput id="budget-title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <FormField label="Başlangıç ayı" htmlFor="budget-start" required>
          <FormInput id="budget-start" type="month" required value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
        </FormField>
        <FormField label="Süre (ay)" htmlFor="budget-months" required hint={budgetPeriodLabel(`${startMonth || defaultStartMonth}-01`, monthsN)}>
          <FormInput id="budget-months" type="number" inputMode="numeric" min={1} max={24} required value={months} onChange={(e) => setMonths(e.target.value)} />
        </FormField>
        <FormField label="Avans dağıtımı" htmlFor="budget-dist" className="sm:col-span-2" hint={distribution === "land_share" ? "Kat Mülkiyeti Kanunu'nda aksi kararlaştırılmadıkça ortak giderler arsa payına göre paylaşılır." : undefined}>
          <FormSelect id="budget-dist" value={distribution} onChange={(e) => setDistribution(e.target.value as BudgetDistribution)}>
            {BUDGET_DISTRIBUTIONS.map((m) => <option key={m} value={m}>{DISTRIBUTION_LABELS[m]}</option>)}
          </FormSelect>
        </FormField>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink-950">Gider kalemleri (yıllık tutar)</legend>
        <ul className="space-y-2" aria-label="Bütçe kalemleri">
          {lines.map((l, i) => (
            <li key={l.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-[var(--radius-control)] border border-line bg-canvas p-2 sm:grid-cols-[11rem_1fr_9rem_auto] sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
              <FormSelect aria-label={`${i + 1}. kalem kategorisi`} value={l.category} onChange={(e) => setLine(l.key, { category: e.target.value })} className="col-span-2 sm:col-span-1">
                {BUILDING_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </FormSelect>
              <FormInput aria-label={`${i + 1}. kalem adı`} placeholder="Kalem adı (ör. Asansör bakımı)" maxLength={120} value={l.label} onChange={(e) => setLine(l.key, { label: e.target.value })} className="col-span-2 sm:col-span-1" />
              <FormInput aria-label={`${i + 1}. kalem yıllık tutarı (₺)`} placeholder="Yıllık ₺" inputMode="decimal" value={l.amount} onChange={(e) => setLine(l.key, { amount: e.target.value })} className="numeric text-right" />
              <Button type="button" size="icon" variant="ghost" icon={Trash2} aria-label={`${i + 1}. kalemi sil`} disabled={lines.length <= 1} onClick={() => removeLine(l.key)} />
            </li>
          ))}
        </ul>
        <Button type="button" size="sm" variant="secondary" icon={Plus} onClick={addLine} disabled={lines.length >= 60}>Kalem ekle</Button>
      </fieldset>

      <div className="grid gap-3 rounded-[var(--radius-control)] border border-line bg-canvas p-3 text-sm sm:grid-cols-3" aria-live="polite">
        <p><span className="block text-xs text-text-muted">Yıllık toplam</span><span className="numeric text-lg font-extrabold text-ink-950">{money(total)}</span></p>
        <p><span className="block text-xs text-text-muted">Aylık avans (bina toplamı)</span><span className="numeric text-lg font-extrabold text-ink-950">{money(monthly)}</span>
          {gap !== 0 ? <span className="block text-xs text-text-faint">Kuruş yuvarlaması: dönem sonunda {money(Math.abs(gap))} {gap > 0 ? "fazla" : "eksik"} toplanır.</span> : null}</p>
        <p><span className="block text-xs text-text-muted">Daire başı ortalama</span><span className="numeric text-lg font-extrabold text-ink-950">{active.length > 0 ? money(monthly / active.length) : "—"}</span><span className="block text-xs text-text-faint">{active.length} etkin daire</span></p>
      </div>
      {!parsed.ok && !showEmptyLineHint ? <p className="rounded-[var(--radius-control)] bg-amber-400/15 px-3 py-2 text-sm text-amber-800">{parsed.error}</p> : null}

      {preview ? (
        preview.ok ? (
          <details className="rounded-[var(--radius-control)] border border-line p-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink-950">Daire başı aylık avans önizlemesi ({active.length} daire)</summary>
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-text-muted sm:grid-cols-2 lg:grid-cols-3">
              {preview.shares.map((s) => {
                const u = active.find((x) => x.id === s.unitId);
                return <li key={s.unitId} className="flex justify-between gap-2"><span>{u?.label}</span><span className="numeric font-semibold text-ink-950">{money(s.amount)}</span></li>;
              })}
            </ul>
          </details>
        ) : (
          <p className="rounded-[var(--radius-control)] bg-amber-400/15 px-3 py-2 text-sm text-amber-800">{preview.error} Daireler bölümünden tamamlayın ya da başka dağıtım seçin.</p>
        )
      ) : null}
      {active.length === 0 ? <p className="text-sm text-amber-800">Önce “Daireler” bölümünden daireleri ekleyin; avans önizlemesi daireler üzerinden hesaplanır.</p> : null}

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink-950">Kat malikleri kurulu kararı (isteğe bağlı)</legend>
        <FormField label="Karar tarihi" htmlFor="budget-decision-date">
          <FormInput id="budget-decision-date" name="decisionDate" type="date" defaultValue={budget?.decisionDate ?? ""} />
        </FormField>
        <FormField label="Karar no" htmlFor="budget-decision-no">
          <FormInput id="budget-decision-no" name="decisionNo" maxLength={40} defaultValue={budget?.decisionNo ?? ""} />
        </FormField>
        <FormField label="Not" htmlFor="budget-decision-note" className="sm:col-span-3">
          <FormTextarea id="budget-decision-note" name="decisionNote" rows={2} maxLength={1000} defaultValue={budget?.decisionNote ?? ""} placeholder="Ör. Olağan genel kurulda oy çokluğuyla kabul edildi." />
        </FormField>
      </fieldset>

      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending} disabled={!parsed.ok}>{budget ? "Değişiklikleri kaydet" : "Taslağı kaydet"}</Button>
      </div>
    </form>
  );
}

export type PeriodState = { period: string; state: "budget" | "manual" | "open" };

/**
 * Onay / taslağa alma / silme + aylık avans tahakkuku (ay seçimli, idempotent). Yazdırma bağlantısı karar özetini açar.
 */
export function BudgetActions({
  budget,
  periods,
  printHref,
  canCreate,
  canEdit,
  canDelete,
}: {
  budget: BudgetRow;
  periods: PeriodState[];
  printHref: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const openPeriods = periods.filter((p) => p.state === "open").map((p) => p.period);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(openPeriods));
  const approved = budget.status === "approved";
  const monthly = monthlyAdvance(budget.total, budget.months);
  const pickedOpen = openPeriods.filter((p) => picked.has(p));

  const run = async (fn: () => Promise<{ error?: string; info?: string }>, okMsg: string) => {
    const res = await fn();
    if (res.error) return res;
    push(res.info ?? okMsg, "ok");
    router.refresh();
    return res;
  };

  function accrue() {
    setError(null);
    startTransition(async () => {
      const res = await accrueBuildingBudget({ budgetId: budget.id, months: pickedOpen.map((p) => p.slice(0, 7)) });
      if (res.error) {
        setError(res.error);
        return;
      }
      push(res.info ?? "Avans tahakkuku oluşturuldu", "ok");
      router.refresh();
    });
  }

  const toggle = (p: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return n;
  });

  return (
    <section className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-label="İşletme projesi işlemleri">
      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={printHref} variant="outline" size="sm" icon={Printer}>Karar özeti / yazdır</ButtonLink>
        {!approved && canEdit ? (
          <ConfirmDialog
            tone="default"
            title="İşletme projesi onaylansın mı?"
            description={`Yıllık ${money(budget.total)} · aylık avans ${money(monthly)}. Onaydan sonra kalemler kilitlenir ve aylık avans tahakkuku açılır. Genel kurul kabulünü karar alanlarına yazmanız önerilir.`}
            confirmLabel="Onayla"
            onConfirm={() => run(() => approveBuildingBudget(budget.id), "İşletme projesi onaylandı")}
            trigger={<Button size="sm" icon={CheckCircle2}>Onayla</Button>}
          />
        ) : null}
        {approved && canEdit ? (
          <ConfirmDialog
            tone="default"
            title="Taslağa alınsın mı?"
            description="Kalemler yeniden düzenlenebilir olur. Bu projeden tahakkuk etmiş (iptal edilmemiş) avans varsa işlem reddedilir."
            confirmLabel="Taslağa al"
            onConfirm={() => run(() => reopenBuildingBudget(budget.id), "Proje taslağa alındı")}
            trigger={<Button size="sm" variant="ghost" icon={RotateCcw}>Taslağa al</Button>}
          />
        ) : null}
        {!approved && canDelete ? (
          <ConfirmDialog
            title="Taslak silinsin mi?"
            description="Taslak işletme projesi kalıcı olarak silinir. Tahakkuklar etkilenmez."
            confirmLabel="Sil"
            onConfirm={() => run(async () => {
              const r = await deleteBuildingBudget(budget.id);
              if (!r.error) router.replace(`/app/aidat?sekme=binalar&bina=${budget.buildingId}&bolum=butce`, { scroll: false });
              return r;
            }, "Taslak silindi")}
            trigger={<Button size="sm" variant="ghost" icon={Trash2}>Taslağı sil</Button>}
          />
        ) : null}
        {approved ? <span className="inline-flex items-center gap-1 text-xs text-text-muted"><Lock className="h-3.5 w-3.5" aria-hidden="true" /> Onaylı: kalemler kilitli</span> : null}
      </div>

      {approved && canCreate ? (
        <div className="space-y-2 border-t border-line pt-3">
          <h4 className="flex items-center gap-2 text-sm font-bold text-ink-950"><CalendarCheck2 className="h-4 w-4 text-brand-600" aria-hidden="true" /> Aylık avans tahakkuku</h4>
          <p className="text-xs text-text-muted">Seçilen her ay için tüm etkin dairelere {money(monthly)} avans, dağıtım yöntemine göre borç olarak yazılır. Zaten tahakkuk etmiş aylar atlanır; aynı işlemi tekrar yapmak güvenlidir.</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label="Avans ayları">
            {periods.map((p) => {
              const open = p.state === "open";
              const id = `acc-${p.period}`;
              return (
                <li key={p.period}>
                  <label htmlFor={id} className={`flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm ${open ? "cursor-pointer border-line bg-surface" : "border-transparent bg-canvas text-text-muted"}`}>
                    <input id={id} type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={open ? picked.has(p.period) : true} disabled={!open} onChange={() => toggle(p.period)} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{monthLabelTr(p.period)}</span>
                      {!open ? <span className="block text-xs">{p.state === "budget" ? "Tahakkuk etti" : "Elle aidat var"}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <FormError error={error} />
          <Button type="button" icon={CalendarCheck2} loading={pending} disabled={pickedOpen.length === 0} onClick={accrue}>
            {pickedOpen.length > 0 ? `${pickedOpen.length} ayı tahakkuk et` : "Tahakkuk edilecek ay yok"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
