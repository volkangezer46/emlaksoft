"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Receipt, Scale } from "lucide-react";
import { createAidatBatch, createExpenseShare, voidBuildingBatch } from "@/app/actions/building-management";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { BATCH_KIND_LABELS } from "@/lib/building-management/charges";
import { DISTRIBUTION_LABELS, DISTRIBUTION_METHODS, distributeAmount, type DistributionMethod } from "@/lib/building-management/distribution";
import type { BatchRow, UnitRow } from "@/lib/building-management/load";
import { parseMoneyInput } from "@/lib/money-input";

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);
const monthLabel = (iso: string) => new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));
const dayLabel = (iso: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));

const EXPENSE_CATEGORIES = ["Asansör", "Temizlik", "Elektrik", "Su", "Isıtma / doğalgaz", "Bakım-onarım", "Güvenlik", "Bahçe", "Sigorta", "Diğer"];

/**
 * Toplu tahakkuk formu (aidat dönemi ya da ortak gider paylaştırma). Önizleme, sunucuyla AYNI saf dağıtım fonksiyonunu çalıştırır;
 * kuruş farkı son daireye eklenir ve toplam birebir tutardır.
 */
export function BatchForm({
  mode,
  buildingId,
  units,
  defaultMethod,
  defaultMonth,
  canCreate,
}: {
  mode: "aidat" | "expense_share";
  buildingId: string;
  units: UnitRow[];
  defaultMethod: DistributionMethod;
  defaultMonth: string;
  canCreate: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<DistributionMethod>(defaultMethod);
  const [total, setTotal] = useState("");
  const active = useMemo(() => units.filter((u) => u.active), [units]);

  const preview = useMemo(() => {
    const parsed = parseMoneyInput(total, { max: 1_000_000_000 });
    const totalValue = parsed.ok ? parsed.value : null;
    if (method !== "fixed" && (totalValue == null || totalValue <= 0)) return null;
    return distributeAmount({
      method,
      total: method === "fixed" && totalValue == null ? null : totalValue,
      units: active.map((u) => ({ id: u.id, label: u.label, areaM2: u.areaM2, landShare: u.landShare, fixedAmount: u.fixedAmount })),
    });
  }, [method, total, active]);

  function submit(fd: FormData) {
    setError(null);
    const input = {
      buildingId,
      month: String(fd.get("month") ?? ""),
      title: String(fd.get("title") ?? ""),
      category: String(fd.get("category") ?? ""),
      total: String(fd.get("total") ?? ""),
      method,
      dueDate: String(fd.get("dueDate") ?? ""),
    };
    startTransition(async () => {
      const res = mode === "aidat" ? await createAidatBatch(input) : await createExpenseShare(input);
      if (res.error) {
        setError(res.error);
        return;
      }
      push(res.info ?? "Tahakkuk oluşturuldu", "ok");
      setTotal("");
      router.refresh();
    });
  }

  if (!canCreate) return null;
  const isAidat = mode === "aidat";
  return (
    <form action={submit} className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-label={isAidat ? "Dönem aidat tahakkuku" : "Ortak gider paylaştırma"}>
      <h3 className="flex items-center gap-2 font-display font-bold text-ink-950">
        {isAidat ? <CalendarPlus className="h-4 w-4 text-brand-600" /> : <Scale className="h-4 w-4 text-brand-600" />}
        {isAidat ? "Dönem aidat tahakkuku" : "Bina gideri paylaştır"}
      </h3>
      <p className="text-xs text-text-muted">
        {isAidat
          ? "Seçilen ay için tüm etkin dairelere tek seferde aidat borcu yazılır (bir dönem bir kez)."
          : "Gideri girin; seçilen yönteme göre dairelere borç olarak tahakkuk eder. Gider ofis giderine yazılmaz (apartmana yansıtılır)."}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Dönem (ay)" htmlFor={`${mode}-month`} required>
          <FormInput id={`${mode}-month`} name="month" type="month" required defaultValue={defaultMonth} />
        </FormField>
        <FormField label={isAidat ? "Başlık" : "Gider adı"} htmlFor={`${mode}-title`} required>
          <FormInput id={`${mode}-title`} name="title" required maxLength={160} defaultValue={isAidat ? "Aylık aidat" : ""} placeholder={isAidat ? undefined : "Asansör bakımı"} />
        </FormField>
        {!isAidat ? (
          <FormField label="Kategori" htmlFor="expense_share-category">
            <FormSelect id="expense_share-category" name="category" defaultValue="Bakım-onarım">
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </FormSelect>
          </FormField>
        ) : null}
        <FormField label="Dağıtım yöntemi" htmlFor={`${mode}-method`}>
          <FormSelect id={`${mode}-method`} value={method} onChange={(e) => setMethod(e.target.value as DistributionMethod)}>
            {DISTRIBUTION_METHODS.map((m) => <option key={m} value={m}>{DISTRIBUTION_LABELS[m]}</option>)}
          </FormSelect>
        </FormField>
        <FormField label={method === "fixed" ? "Toplam (isteğe bağlı)" : "Toplam tutar (₺)"} htmlFor={`${mode}-total`} required={method !== "fixed"} hint={method === "fixed" ? "Boş bırakılırsa dairelerin sabit tutarları toplanır." : undefined}>
          <FormInput id={`${mode}-total`} name="total" inputMode="decimal" required={method !== "fixed"} value={total} onChange={(e) => setTotal(e.target.value)} />
        </FormField>
        <FormField label="Son ödeme tarihi" htmlFor={`${mode}-due`} hint="Boş bırakılırsa binanın vade günü kullanılır.">
          <FormInput id={`${mode}-due`} name="dueDate" type="date" />
        </FormField>
      </div>

      {preview ? (
        preview.ok ? (
          <div className="rounded-[var(--radius-control)] border border-line bg-canvas p-3 text-sm">
            <p className="font-semibold text-ink-950">
              Önizleme: {active.length} daire · toplam <span className="numeric">{money(preview.total)}</span>
              {preview.roundingAdjustment !== 0 ? <span className="ml-2 text-xs font-normal text-text-muted">(kuruş farkı {money(preview.roundingAdjustment)} son daireye eklendi)</span> : null}
            </p>
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-text-muted sm:grid-cols-2 lg:grid-cols-3">
              {preview.shares.slice(0, 24).map((s) => {
                const u = active.find((x) => x.id === s.unitId);
                return <li key={s.unitId} className="flex justify-between gap-2"><span>{u?.label}</span><span className="numeric font-semibold text-ink-950">{money(s.amount)}</span></li>;
              })}
            </ul>
            {preview.shares.length > 24 ? <p className="mt-1 text-xs text-text-faint">… ve {preview.shares.length - 24} daire daha</p> : null}
          </div>
        ) : (
          <p className="rounded-[var(--radius-control)] bg-amber-400/15 px-3 py-2 text-sm text-amber-800">{preview.error}</p>
        )
      ) : null}
      {active.length === 0 ? <p className="text-sm text-amber-800">Önce “Daireler” bölümünden en az bir daire ekleyin.</p> : null}

      <FormError error={error} />
      <Button type="submit" size="sm" loading={pending} disabled={active.length === 0}>{isAidat ? "Aidat tahakkuku oluştur" : "Gideri paylaştır"}</Button>
    </form>
  );
}

/** Tahakkuk grupları (aidat dönemleri ve gider paylaştırmaları) + iptal. */
export function BatchList({ batches, canDelete }: { batches: BatchRow[]; canDelete: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [voidFor, setVoidFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submitVoid(batchId: string, fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await voidBuildingBatch({ batchId, reason: String(fd.get("reason") ?? "") });
      if (res.error) {
        setError(res.error);
        return;
      }
      push("Tahakkuk iptal edildi", "ok");
      setVoidFor(null);
      router.refresh();
    });
  }

  if (batches.length === 0) {
    return <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong p-6 text-center text-sm text-text-muted">Henüz tahakkuk yok. Yukarıdan dönem aidatı oluşturun ya da bir bina giderini paylaştırın.</p>;
  }
  return (
    <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface" aria-label="Tahakkuk geçmişi">
      {batches.map((b) => (
        <li key={b.id} className="space-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={`min-w-0 ${b.voidedAt ? "text-text-faint line-through" : "text-ink-950"}`}>
              <p className="font-semibold">{b.title}</p>
              <p className="text-xs text-text-muted no-underline">{monthLabel(b.period)} · {DISTRIBUTION_LABELS[b.distribution]} · vade {dayLabel(b.dueDate)}{b.category ? ` · ${b.category}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={b.kind === "aidat" ? "info" : "warning"} size="sm">{BATCH_KIND_LABELS[b.kind]}</Badge>
              <span className="numeric font-bold text-ink-950">{money(b.totalAmount)}</span>
              {b.voidedAt ? <Badge variant="outline" size="sm">İptal edildi</Badge> : canDelete ? <Button size="sm" variant="ghost" onClick={() => { setVoidFor(voidFor === b.id ? null : b.id); setError(null); }}>İptal et</Button> : null}
            </div>
          </div>
          {b.voidedAt && b.voidReason ? <p className="text-xs text-text-muted">İptal nedeni: {b.voidReason}</p> : null}
          {voidFor === b.id ? (
            <form action={(fd) => submitVoid(b.id, fd)} className="space-y-2 rounded-[var(--radius-control)] bg-canvas p-2.5">
              <FormField label="İptal nedeni" htmlFor={`void-${b.id}`} required hint="Tahsilat varken iptal edilemez; önce tahsilatları iptal edin.">
                <FormInput id={`void-${b.id}`} name="reason" required minLength={3} maxLength={300} />
              </FormField>
              <FormError error={error} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="danger" loading={pending} icon={Receipt}>Tahakkuku iptal et</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setVoidFor(null)}>Vazgeç</Button>
              </div>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
