import { financeHref, financePath } from "@/lib/finance/routes";
import { Suspense, type CSSProperties, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@/components/ui/smart-link";
import { AlertTriangle, ChevronLeft, ChevronRight, PiggyBank, Target, TrendingDown, Wallet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterChip } from "@/components/ui/filter-chip";
import { KpiStrip, StatusPill, type KpiItem } from "@/components/ui/list-kit";
import { SkeletonCard } from "@/components/ui/viz";
import { createClient } from "@/lib/supabase/server";
import { now, trMonthKey } from "@/lib/clock";
import { formatTry } from "@/lib/format";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import type { EffectivePermissions } from "@/lib/permissions-merge";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import { CASH_CATEGORIES, OWNER_PAYOUT_CATEGORY, TRANSFER_CATEGORY } from "@/lib/finance/cash/categories";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import {
  BUDGET_WARN_RATIO,
  budgetCategoryOptions,
  addMonths,
  budgetTotals,
  budgetVsActualRows,
  monthBounds,
  parseMonthKey,
  type BudgetVsActualRaw,
  type BudgetVsActualRow,
} from "@/lib/finance/expense-budget";
import { FinanceBudgetForm, FinanceBudgetRemove } from "../_lazy";
import { PortalRoiCard, RecurringSeriesCard } from "./butce-cards";

/* ================================================================================================
 * FN6 ortak sekme sözleşmesi (paketler arası sözleşme §0). FN1'in `src/lib/finance/ledger/types.ts` dosyasındaki
 * `FinanceTabProps` ile yapısal olarak AYNI; FN2'nin page.tsx'i her sekmeye bu nesneyi verir.
 * ============================================================================================== */
export type FinanceTabProps = {
  params: Record<string, string | undefined>;
  perms: EffectivePermissions;
  tenantId: string;
  userId: string;
  role: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSalary: boolean;
  isOwnerGm: boolean;
};

export const PARTY_KIND_LABEL: Record<string, string> = {
  musteri: "Müşteri",
  malik: "Mülk sahibi",
  kiraci: "Kiracı",
  tedarikci: "Tedarikçi",
  danisman: "Danışman",
  diger: "Diğer",
};

/** Ofisin kendi kategorisi (finance_categories). */
export type CustomCategory = {
  id: string;
  direction: "in" | "out";
  key: string;
  label: string;
  icon: string | null;
  default_vat_rate: number | null;
  default_withholding_rate: number | null;
  expense_category: string | null;
  sort: number;
  archived_at: string | null;
};

/** Ofis kategorileri (arşivliler dahil: eski satırda etiket korunur). Şema yoksa `available:false`. */
export async function loadCustomCategories(supabase: SupabaseClient): Promise<{ available: boolean; rows: CustomCategory[] }> {
  const { data, error } = await supabase
    .from("finance_categories")
    .select("id, direction, key, label, icon, default_vat_rate, default_withholding_rate, expense_category, sort, archived_at")
    .order("sort", { ascending: true })
    .order("label", { ascending: true });
  if (error) return { available: false, rows: [] };
  return {
    available: true,
    rows: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      direction: r.direction === "in" ? "in" : "out",
      key: String(r.key ?? ""),
      label: String(r.label ?? r.key ?? ""),
      icon: (r.icon as string | null) ?? null,
      default_vat_rate: r.default_vat_rate == null ? null : Number(r.default_vat_rate),
      default_withholding_rate: r.default_withholding_rate == null ? null : Number(r.default_withholding_rate),
      expense_category: (r.expense_category as string | null) ?? null,
      sort: Number(r.sort ?? 0) || 0,
      archived_at: (r.archived_at as string | null) ?? null,
    })),
  };
}

/** Bütçe/rapor etiketleri: sistem hareket kategorileri + gider tanımları + ofis kategorileri (arşivli dahil). */
export function categoryLabelMap(defs: readonly { value: string; label: string }[], custom: readonly CustomCategory[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of defs) map.set(d.value, d.label);
  for (const c of CASH_CATEGORIES) map.set(c.value, c.label);
  map.set(TRANSFER_CATEGORY, "Transfer");
  map.set(OWNER_PAYOUT_CATEGORY, "Mülk sahibi ödemesi");
  for (const c of custom) map.set(c.key, c.archived_at ? `${c.label} (arşiv)` : c.label);
  return map;
}


const MONTH_FMT = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" });
export const monthLabelOf = (key: string) => MONTH_FMT.format(new Date(`${key}-01T00:00:00Z`));

/**
 * Bütçe sekmesi (?sekme=butce&ay=YYYY-MM): aylık gelir hedefi ve gider bütçesi ↔ gerçekleşen (finance_budget_vs_actual),
 * %80 uyarı / %100 aşım (bütçe sonraki aylara kendiliğinden taşınır: finance_budget_vs_actual son tanımlı ayı okur); altında tekrarlayan gider özeti ve portal getirisi.
 * Her sayı filtreli Hareketler'e gider. Veri yoksa uydurma yok.
 */
export async function ButceTab({ params, perms, tenantId, userId, canEdit, canSalary }: FinanceTabProps) {
  const supabase = await createClient();
  const current = trMonthKey(now());
  const month = parseMonthKey(params.ay, current);
  const prev = addMonths(month, -1);
  const { from, to } = monthBounds(month);

  const [vsRes, defs, custom] = await Promise.all([
    supabase.rpc("finance_budget_vs_actual", { p_month: `${month}-01` }),
    getDefinitionsOrDefault("expense_category"),
    loadCustomCategories(supabase),
  ]);
  const schemaMissing = Boolean(vsRes.error && isMissingCashSchema(vsRes.error));
  const rows = vsRes.error ? [] : budgetVsActualRows((vsRes.data ?? []) as BudgetVsActualRaw[]);
  const labels = categoryLabelMap(defs, custom.rows);
  const labelOf = (k: string) => labels.get(k) ?? k;
  const monthLabel = monthLabelOf(month);

  const income = rows.filter((r) => r.direction === "in");
  const expense = rows.filter((r) => r.direction === "out");
  const inT = budgetTotals(rows, "in");
  const outT = budgetTotals(rows, "out");
  const budgetedOut = expense.filter((r) => r.budget > 0);
  const budgetedIn = income.filter((r) => r.budget > 0);
  const unbudgetedOut = expense.filter((r) => r.budget <= 0 && r.actual > 0);
  const overRows = budgetedOut.filter((r) => r.status === "over");

  const tabHref = (m: string, hash = "") => financeHref("butce", { ay: m === current ? null : m }, hash);
  const entriesHref = (dir: "in" | "out", category?: string) =>
    `${financePath("hareketler")}?tur=${dir === "in" ? "gelir" : "gider"}${category ? `&kategori=${encodeURIComponent(category)}` : ""}&from=${from}&to=${to}`;
  const pct = (a: number, b: number) => (b > 0 ? `%${Math.round((a / b) * 100)}` : "—");

  const kpis: KpiItem[] = [
    { label: "Gelir hedefi", value: inT.budget > 0 ? pct(inT.budgetedActual, inT.budget) : formatTry(inT.actual), icon: <Target />, tone: "success", href: tabHref(month, "#gelir"), hint: inT.budget > 0 ? `${formatTry(inT.budgetedActual)} / ${formatTry(inT.budget)}` : "hedef tanımlı değil" },
    { label: "Gider bütçesi", value: outT.budget > 0 ? pct(outT.budgetedActual, outT.budget) : formatTry(outT.actual), icon: <Wallet />, tone: "warning", href: tabHref(month, "#gider"), hint: outT.budget > 0 ? `${formatTry(outT.budgetedActual)} / ${formatTry(outT.budget)}` : "bütçe tanımlı değil" },
    { label: "Aşan kategori", value: overRows.length, icon: <AlertTriangle />, tone: overRows.length > 0 ? "danger" : "neutral", href: tabHref(month, "#gider"), hint: monthLabel, attention: overRows.length > 0 },
    { label: "Kalan bütçe", value: formatTry(Math.max(0, outT.budget - outT.budgetedActual)), icon: <TrendingDown />, tone: "info", href: entriesHref("out"), hint: "bütçeli kategorilerde" },
  ];

  return (
    <div className="grid gap-5">
      <nav aria-label="Bütçe ayı" className="flex flex-wrap items-center gap-2">
        <Link href={tabHref(prev)} aria-label="Önceki ay" className="focus-ring press inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-text-muted hover:text-ink-950 touch:h-11 touch:w-11">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <h2 className="min-w-[9rem] text-center font-display text-base font-bold capitalize text-text">{monthLabel}</h2>
        <Link href={tabHref(addMonths(month, 1))} aria-label="Sonraki ay" className="focus-ring press inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-text-muted hover:text-ink-950 touch:h-11 touch:w-11">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <FilterChip href={tabHref(current)} active={month === current}>Bu ay</FilterChip>
        <FilterChip href={tabHref(addMonths(current, 1))} active={month === addMonths(current, 1)}>Gelecek ay</FilterChip>
        <p className="ml-auto text-xs text-text-faint">Bütçe sonraki aylara kendiliğinden taşınır; yalnız değişen ayda düzenleyin.</p>
      </nav>

      {schemaMissing ? (
        <Alert tone="info" title="Aylık bütçe kurulum bekliyor">
          Gelir hedefi ve aylık gider bütçesi muhasebe güncellemesi uygulanınca açılır. Tekrarlayan giderler ve portal getirisi aşağıda çalışmaya devam eder.
        </Alert>
      ) : vsRes.error ? (
        <Alert tone="warning">Bütçe verisi şu an yüklenemedi; sayfayı yenileyin.</Alert>
      ) : (
        <>
          <KpiStrip items={kpis} label="Bütçe özeti" />
          {overRows.length > 0 ? (
            <Alert tone="danger" title={`${overRows.length} kategoride bütçe aşıldı`}>
              {overRows.map((r, i) => (
                <span key={r.category}>
                  {i > 0 ? ", " : ""}
                  <Link href={entriesHref("out", r.category)} className="font-semibold underline">{labelOf(r.category)}</Link> ({formatTry(Math.abs(r.remaining))} fazla)
                </span>
              ))}
              . Harcamaları gözden geçirin ya da bütçeyi güncelleyin.
            </Alert>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <BudgetCard
              id="gelir"
              title="Gelir hedefleri"
              description={`${monthLabel} · kategori bazlı hedef ↔ gerçekleşen gelir`}
              icon={<Target className="h-4 w-4 text-success-strong" aria-hidden />}
              rows={budgetedIn}
              empty="Henüz gelir hedefi yok. Komisyon, hizmet bedeli gibi kategorilere aylık hedef girin; ilerleme burada izlenir."
              labelOf={labelOf}
              hrefOf={(c) => entriesHref("in", c)}
              month={month}
              canEdit={canEdit}
            />
            <BudgetCard
              id="gider"
              title="Gider bütçesi"
              description={`${monthLabel} · %${Math.round(BUDGET_WARN_RATIO * 100)} dolunca uyarı, %100'de aşım`}
              icon={<PiggyBank className="h-4 w-4 text-brand-600" aria-hidden />}
              rows={budgetedOut}
              empty="Henüz gider bütçesi yok. Kira, reklam, portal gibi kalemlere aylık üst sınır koyun; aşım burada ve bildirimde görünür."
              labelOf={labelOf}
              hrefOf={(c) => entriesHref("out", c)}
              month={month}
              canEdit={canEdit}
            />
          </div>

          {unbudgetedOut.length > 0 ? (
            <section aria-label="Bütçesi olmayan giderler" className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface p-4">
              <h3 className="text-sm font-semibold text-text">Bütçesi olmayan giderler</h3>
              <p className="mb-2 text-xs text-text-muted">Bu ay harcama yapılan ama bütçe tanımlanmamış kategoriler.</p>
              <ul className="flex flex-wrap gap-2">
                {unbudgetedOut.map((r) => (
                  <li key={r.category}>
                    <Link href={entriesHref("out", r.category)} className="focus-ring press inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-canvas px-3 text-xs font-semibold text-text hover:border-brand-300 touch:min-h-11">
                      {labelOf(r.category)} <span className="numeric text-text-muted">{formatTry(r.actual)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {canEdit ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Bütçe ya da hedef belirle</CardTitle>
                  <CardDescription>{monthLabel} için. Tutarı boş bırakıp kaydederseniz o kategorinin bütçesi kalkar.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <FinanceBudgetForm
                  month={month}
                  inOptions={budgetCategoryOptions("in", defs, custom.rows, canSalary)}
                  outOptions={budgetCategoryOptions("out", defs, custom.rows, canSalary)}
                  existing={Object.fromEntries(rows.filter((r) => r.budget > 0).map((r) => [`${r.direction}:${r.category}`, r.budget]))}
                />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <Suspense fallback={<SkeletonCard height={220} label="Tekrarlayan giderler yükleniyor" />}>
        <RecurringSeriesCard tenantId={tenantId} canConvert={canEdit} />
      </Suspense>
      <Suspense fallback={<SkeletonCard height={260} label="Portal getirisi yükleniyor" />}>
        <PortalRoiCard tenantId={tenantId} userId={userId} showEarnings={canSeeAllEarnings(perms)} />
      </Suspense>
    </div>
  );
}

function BudgetCard({
  id,
  title,
  description,
  icon,
  rows,
  empty,
  labelOf,
  hrefOf,
  month,
  canEdit,
}: {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  rows: readonly BudgetVsActualRow[];
  empty: string;
  labelOf: (k: string) => string;
  hrefOf: (category: string) => string;
  month: string;
  canEdit: boolean;
}) {
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">{icon} {title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-text-muted">{empty}</p>
        ) : (
          <ul className="grid gap-3">
            {rows.map((r, i) => (
              <BudgetBar key={`${r.direction}:${r.category}`} row={r} index={i} label={labelOf(r.category)} href={hrefOf(r.category)} month={month} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Bütçe ↔ gerçekleşen çubuğu: iz bütçeyi, dolgu gerçekleşeni gösterir; aşımda dolgu kırmızı ve taşan kısım işaretli. */
function BudgetBar({ row: r, index, label, href, month, canEdit }: { row: BudgetVsActualRow; index: number; label: string; href: string; month: string; canEdit: boolean }) {
  const income = r.direction === "in";
  const fill = Math.min(100, Math.round(r.ratio * 100));
  const color = income ? (r.status === "under" ? "bg-amber-500" : "bg-mint-500") : r.status === "over" ? "bg-danger-500" : r.status === "warn" ? "bg-amber-500" : "bg-accent";
  const pill = income
    ? r.status === "under"
      ? { tone: "warning" as const, text: `%${Math.round(r.ratio * 100)}` }
      : { tone: "success" as const, text: r.ratio >= 1 ? "Hedefte" : `%${Math.round(r.ratio * 100)}` }
    : r.status === "over"
      ? { tone: "danger" as const, text: "Aşıldı" }
      : { tone: r.status === "warn" ? ("warning" as const) : ("success" as const), text: `%${Math.round(r.ratio * 100)}` };
  return (
    <li className="rounded-[var(--radius-card)] border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={href} className="focus-ring rounded text-sm font-semibold text-text hover:underline">{label}</Link>
        <span className="flex items-center gap-2 text-xs">
          <Link href={href} className="numeric text-text-muted hover:underline">
            {formatTry(r.actual)} / {formatTry(r.budget)}
          </Link>
          <StatusPill tone={pill.tone} dot={false}>{pill.text}</StatusPill>
          {canEdit ? <FinanceBudgetRemove month={month} direction={r.direction} category={r.category} label={label} /> : null}
        </span>
      </div>
      <div
        className="relative mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
        role="progressbar"
        aria-label={`${label} ${income ? "hedef" : "bütçe"} kullanımı`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fill}
      >
        <span className={`viz-grow-x absolute inset-y-0 left-0 block rounded-full ${color}`} style={{ width: `${fill}%`, "--viz-delay": `${index * 40}ms` } as CSSProperties} />
      </div>
      <p className="mt-1 text-xs text-text-muted">
        {income
          ? r.remaining > 0
            ? `Hedefe ${formatTry(r.remaining)} kaldı`
            : `Hedef ${formatTry(Math.abs(r.remaining))} aşıldı`
          : r.remaining >= 0
            ? `${formatTry(r.remaining)} kaldı`
            : `${formatTry(Math.abs(r.remaining))} aşıldı`}
      </p>
    </li>
  );
}
