import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@/components/ui/smart-link";
import { CalendarRange, ClipboardList, Coins, Plus, Receipt, Wallet } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { cn } from "@/lib/utils";
import {
  BUDGET_ROW_STATUS_LABELS,
  BUDGET_STATUS_LABELS,
  advanceCollection,
  budgetPeriodLabel,
  budgetPeriods,
  budgetVsActual,
  isBudgetDistribution,
  monthlyAdvance,
  type BudgetVsActualRow,
} from "@/lib/building-management/budget";
import { loadBudgetReport, loadBuildingBudgets } from "@/lib/building-management/budget-load";
import { DISTRIBUTION_LABELS } from "@/lib/building-management/distribution";
import type { BatchRow, BuildingRow, UnitRow } from "@/lib/building-management/load";
import { BudgetActions, BudgetEditor, type PeriodState } from "./butce-panel";

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);

const ROW_TONE: Record<BudgetVsActualRow["status"], "success" | "warning" | "danger" | "info"> = {
  ok: "success",
  watch: "warning",
  over: "danger",
  unplanned: "info",
};

/**
 * "İşletme projesi" bölümü (sunucu): proje seçici, özet, bütçe/gerçekleşen tablosu, taslak düzenleyici ya da onaylı proje işlemleri.
 * `proje`: seçili proje kimliği | "yeni" | boş (en güncel proje).
 */
export async function BudgetSection({
  db,
  tenantId,
  today,
  building,
  units,
  batches,
  proje,
  perms,
}: {
  db: SupabaseClient;
  tenantId: string;
  today: string;
  building: BuildingRow;
  units: UnitRow[];
  batches: BatchRow[];
  proje: string;
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
}) {
  const base = `/app/aidat?sekme=binalar&bina=${building.id}`;
  const { available, budgets } = await loadBuildingBudgets(db, { tenantId, buildingId: building.id });
  if (!available) {
    return <EmptyState icon={ClipboardList} title="İşletme projesi kurulum bekliyor" description="Veritabanı güncellemesi henüz uygulanmamış olabilir; sistem yöneticinize bildirin." />;
  }
  const defaultDistribution = isBudgetDistribution(building.defaultDistribution) ? building.defaultDistribution : "land_share";
  const nextYearStart = `${Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 10 ? 1 : 0)}-01`;
  const wantsNew = proje === "yeni" || budgets.length === 0;
  const selected = wantsNew ? null : (budgets.find((b) => b.id === proje) ?? budgets[0] ?? null);

  const switcher = budgets.length > 0 ? (
    <nav aria-label="İşletme projeleri" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
      <ul className="inline-flex min-w-max items-center gap-2">
        {budgets.map((b) => {
          const on = selected?.id === b.id;
          return (
            <li key={b.id}>
              <Link
                href={`${base}&bolum=butce&proje=${b.id}`}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition",
                  on ? "border-brand-300 bg-surface text-ink-950 shadow-[var(--shadow-xs)]" : "border-line bg-canvas text-text-muted hover:text-ink-950",
                )}
              >
                {budgetPeriodLabel(b.periodStart, b.months)}
                <Badge variant={b.status === "approved" ? "success" : "outline"} size="sm">{BUDGET_STATUS_LABELS[b.status]}</Badge>
              </Link>
            </li>
          );
        })}
        {perms.canCreate ? (
          <li>
            <Link href={`${base}&bolum=butce&proje=yeni`} scroll={false} aria-current={wantsNew ? "page" : undefined} className={cn("focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed px-4 text-sm font-semibold", wantsNew ? "border-brand-300 text-brand-700" : "border-line text-text-muted hover:text-ink-950")}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Yeni proje
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  ) : null;

  if (!selected) {
    return (
      <div className="space-y-4">
        {switcher}
        {budgets.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm text-text-muted shadow-[var(--shadow-xs)]">
            <p className="font-semibold text-ink-950">Yıllık işletme projesi nedir?</p>
            <p className="mt-1">Binanın bir yıllık tahmini giderleri (görevli, temizlik, elektrik, asansör, sigorta, yedek akçe…) kalem kalem yazılır; toplam, aylık avans olarak dairelere arsa payına (ya da eşit / m²) göre dağıtılır. Kat malikleri kurulunda kabul edilen proje, yazdırılabilir karar özetiyle sakinlere duyurulur ve her ay otomatik olarak tahakkuk ettirilebilir. Yıl içinde bütçe ile gerçekleşen giderleri buradan izlersiniz.</p>
          </div>
        ) : null}
        {perms.canCreate ? (
          <BudgetEditor key="yeni" buildingId={building.id} budget={null} units={units} defaultStartMonth={nextYearStart} defaultDistribution={defaultDistribution} />
        ) : (
          <EmptyState variant="compact" icon={ClipboardList} title="Henüz işletme projesi yok" description="İşletme projesi oluşturma yetkiniz yok; ofis yöneticinizden isteyin." />
        )}
      </div>
    );
  }

  const report = await loadBudgetReport(db, { tenantId, budget: selected });
  const bva = budgetVsActual({ lines: selected.lines, periodStart: selected.periodStart, months: selected.months, today, actuals: report.actuals });
  const adv = advanceCollection(report.advanceCharges);
  const monthly = monthlyAdvance(selected.total, selected.months);
  const linked = new Set(report.advanceBatches.map((b) => b.period));
  const manual = new Set(batches.filter((b) => b.kind === "aidat" && !b.voidedAt).map((b) => b.period));
  const periods: PeriodState[] = budgetPeriods(selected.periodStart, selected.months).map((p) => ({
    period: p,
    state: linked.has(p) ? "budget" : manual.has(p) ? "manual" : "open",
  }));

  const kpis: KpiItem[] = [
    { label: "Yıllık bütçe", value: money(selected.total), icon: <ClipboardList />, tone: "info", href: `${base}&bolum=butce&proje=${selected.id}#butce-gerceklesen`, hint: `${selected.lines.length} kalem · ${DISTRIBUTION_LABELS[selected.distribution]}` },
    { label: "Aylık avans", value: money(monthly), icon: <CalendarRange />, tone: "info", href: `${base}&bolum=tahakkuk`, hint: `${report.advanceBatches.length}/${selected.months} ay tahakkuk etti` },
    { label: "Avans tahsilatı", value: money(adv.collected), icon: <Wallet />, tone: "success", href: `${base}&bolum=tahsilat`, hint: adv.charged > 0 ? `%${adv.rate} · kalan ${money(adv.outstanding)}` : "henüz avans yok" },
    { label: "Gerçekleşen gider", value: money(bva.totals.actual), icon: <Receipt />, tone: bva.totals.variance > 0 ? "warning" : "success", attention: bva.rows.some((r) => r.status === "over"), href: `${base}&bolum=gider`, hint: `plan (bugüne) ${money(bva.totals.plannedToDate)}` },
  ];

  return (
    <div className="space-y-4">
      {switcher}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-ink-950">{selected.title}</h3>
        <p className="text-xs text-text-muted">{budgetPeriodLabel(selected.periodStart, selected.months)} · {BUDGET_STATUS_LABELS[selected.status]}{selected.decisionDate ? ` · karar ${selected.decisionDate.split("-").reverse().join(".")}` : ""}</p>
      </div>
      <KpiStrip items={kpis} label="İşletme projesi özeti" />

      <BudgetActions
        key={`${selected.id}-${selected.status}-${report.advanceBatches.length}`}
        budget={selected}
        periods={periods}
        printHref={`/app/aidat/isletme-projesi/${selected.id}`}
        canCreate={perms.canCreate}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
      />

      <section id="butce-gerceklesen" className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]" aria-label="Bütçe ve gerçekleşen">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h4 className="flex items-center gap-2 text-sm font-bold text-ink-950"><Coins className="h-4 w-4 text-brand-600" aria-hidden="true" /> Bütçe / gerçekleşen</h4>
          <p className="text-xs text-text-muted">{bva.elapsed}/{bva.months} ay geçti · gerçekleşen = bu dönemde paylaştırılan ortak giderler</p>
        </div>
        <div className="hidden grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-3 border-b border-line bg-canvas px-4 py-2 text-xs font-semibold text-text-muted sm:grid">
          <span>Kategori</span><span className="text-right">Yıllık plan</span><span className="text-right">Plan (bugüne)</span><span className="text-right">Gerçekleşen</span><span className="text-right">Fark</span>
        </div>
        <ul className="divide-y divide-line">
          {bva.rows.map((r) => (
            <li key={r.category}>
              <Link href={`${base}&bolum=gider`} className="focus-ring grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-sm transition hover:bg-canvas sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr] sm:items-center">
                <span className="col-span-2 flex flex-wrap items-center gap-2 font-semibold text-ink-950 sm:col-span-1">
                  {r.category}
                  {r.status !== "ok" ? <Badge variant={ROW_TONE[r.status]} size="sm">{BUDGET_ROW_STATUS_LABELS[r.status]}</Badge> : null}
                </span>
                <span className="text-xs sm:text-right sm:text-sm"><span className="text-text-muted sm:hidden">Yıllık plan: </span><span className="numeric text-ink-950">{money(r.planned)}</span></span>
                <span className="text-right text-xs sm:text-sm"><span className="text-text-muted sm:hidden">Bugüne: </span><span className="numeric text-ink-950">{money(r.plannedToDate)}</span></span>
                <span className="text-xs sm:text-right sm:text-sm"><span className="text-text-muted sm:hidden">Gerçekleşen: </span><span className="numeric font-bold text-ink-950">{money(r.actual)}</span>{r.usedPct != null ? <span className="ml-1 text-xs text-text-faint">%{r.usedPct}</span> : null}</span>
                <span className={cn("numeric text-right text-xs font-semibold sm:text-sm", r.variance > 0 ? "text-danger-600" : "text-mint-700")}>{r.variance > 0 ? "+" : ""}{money(r.variance)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-x-3 border-t border-line bg-canvas px-4 py-3 text-sm font-bold text-ink-950 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <span className="col-span-2 sm:col-span-1">Toplam</span>
          <span className="numeric sm:text-right">{money(bva.totals.planned)}</span>
          <span className="numeric text-right">{money(bva.totals.plannedToDate)}</span>
          <span className="numeric sm:text-right">{money(bva.totals.actual)}</span>
          <span className={cn("numeric text-right", bva.totals.variance > 0 ? "text-danger-600" : "text-mint-700")}>{bva.totals.variance > 0 ? "+" : ""}{money(bva.totals.variance)}</span>
        </div>
        <p className="px-4 py-2 text-xs text-text-faint">Gider eklemek için “Gider paylaştır” bölümünde kalem kategorisini bütçeyle aynı seçin; fark bugüne kadarki plana göre hesaplanır.</p>
      </section>

      {selected.status === "draft" && perms.canEdit ? (
        <BudgetEditor key={`${selected.id}-${selected.total}-${selected.lines.length}`} buildingId={building.id} budget={selected} units={units} defaultStartMonth={selected.periodStart.slice(0, 7)} defaultDistribution={defaultDistribution} />
      ) : (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-label="Bütçe kalemleri">
          <h4 className="text-sm font-bold text-ink-950">Kalemler</h4>
          <ul className="mt-2 divide-y divide-line text-sm">
            {selected.lines.map((l, i) => (
              <li key={`${l.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0"><span className="block text-ink-950">{l.label}</span><span className="block text-xs text-text-muted">{l.category ?? "Diğer"}</span></span>
                <span className="numeric font-semibold text-ink-950">{money(l.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {selected.status === "approved" && !perms.canEdit ? null : selected.status === "approved" ? (
        <p className="text-xs text-text-faint">Kalemleri değiştirmek için projeyi taslağa alın (avans tahakkuku başladıysa önce o ayların tahakkuklarını iptal edin). Yeni dönem için <ButtonLink href={`${base}&bolum=butce&proje=yeni`} variant="ghost" size="xs">yeni proje açın</ButtonLink>.</p>
      ) : null}
    </div>
  );
}
