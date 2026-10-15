import Link from "@/components/ui/smart-link";
import { ArrowDownRight, ArrowUpRight, Grid3x3, Repeat } from "lucide-react";
import { ChartCard } from "@/components/ui/chart-frame";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTry } from "@/lib/format";
import { cn } from "@/lib/utils";
import { monthShortOfKey } from "@/lib/admin/platform-metrics";
import { loadRevenueAnalytics } from "@/lib/billing-analytics/load";
import {
  MOVEMENT_KINDS,
  MOVEMENT_LABEL,
  cohortHeat,
  firstCoveredMonth,
  monthDiff,
  mrrMovements,
  revenueRetention,
  signupCohorts,
  type MovementKind,
} from "@/lib/billing-analytics/mrr-movements";

/**
 * PA-3 rapor bölümleri (sunucu; /admin/raporlar, yalnız `billing` modülü): MRR hareketleri (yeni / genişleme / geri dönen /
 * daralma / kayıp), net ve brüt gelir tutma (NRR/GRR) ve kayıt kohortu ızgarası. Kaynak `platform_mrr_daily` ay sonu
 * değerleri (`loadRevenueAnalytics`); anlık görüntüsü olmayan ay "veri yok" kalır, oran UYDURULMAZ.
 * Çizim saf HTML/CSS (istemci JS yok); renk tek başına anlam taşımaz (her değer metin olarak da yazılır).
 */

const KIND_TONE: Record<MovementKind, string> = {
  new: "success",
  expansion: "brand",
  reactivation: "gold",
  contraction: "warn",
  churn: "danger",
};
const POSITIVE: readonly MovementKind[] = ["new", "expansion", "reactivation"];
const NEGATIVE: readonly MovementKind[] = ["contraction", "churn"];
const CHART_PX = 168;

const monthLong = (key: string) => `${monthShortOfKey(key)} ${key.slice(2, 4)}`;
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatTry(Math.abs(v))}`;

function MissingState({ status }: { status: "missing" | "error" }) {
  return status === "missing" ? (
    <EmptyState
      variant="compact"
      illustration="rapor"
      title="Kurulum bekliyor"
      description="Ay sonu gelir okuyucusu veritabanı güncellemesiyle (20261019070000) gelir; o zamana kadar sayı gösterilmez."
      action={{ href: "/admin/billing", label: "Faturalamayı aç" }}
    />
  ) : (
    <EmptyState
      variant="compact"
      illustration="hata"
      title="Gelir anlık görüntüleri okunamadı"
      description="Sorgu yanıt vermedi; sayfayı birazdan yenileyin."
      action={{ href: "/admin/billing", label: "Faturalamayı aç" }}
    />
  );
}

/** Aylık MRR hareketleri: yukarı yığılmış kazanç, aşağı kayıp, sütun altında net değişim. Mobilde son 6 ay. */
export async function MrrMovementsSection() {
  const data = await loadRevenueAnalytics();
  const body = (() => {
    if (data.status !== "ok") return <MissingState status={data.status} />;
    const moves = mrrMovements(data.rows, data.months, data.internal);
    const covered = moves.filter((m) => m.covered);
    if (covered.length === 0) {
      const first = firstCoveredMonth(data.rows, data.months);
      return (
        <EmptyState
          variant="compact"
          illustration="rapor"
          title="Hareketler için veri birikiyor"
          description={
            first
              ? `İlk ay sonu anlık görüntüsü ${monthLong(first)}. Bir sonraki ay sonunda yeni, genişleme, daralma ve kayıp burada ayrışır.`
              : "Gelir anlık görüntüsü her gece alınır; iki ay sonu oluşunca hareketler burada ayrışır."
          }
          action={{ href: "/admin/billing", label: "Faturalamayı aç" }}
        />
      );
    }
    const posMax = Math.max(1, ...moves.map((m) => POSITIVE.reduce((s, k) => s + m.amounts[k], 0)));
    const negMax = Math.max(0, ...moves.map((m) => NEGATIVE.reduce((s, k) => s + m.amounts[k], 0)));
    const scale = Math.max(posMax, negMax, 1);
    const topPx = Math.round((CHART_PX * posMax) / (posMax + negMax));
    const bottomPx = CHART_PX - topPx;
    const last = covered[covered.length - 1]!;
    return (
      <>
        <ol className="flex items-stretch gap-1.5 sm:gap-2" aria-label="Aylık MRR hareketleri">
          {moves.map((m, i) => {
            const hideOnMobile = i < moves.length - 6;
            const summary = m.covered
              ? `${monthLong(m.month)}: ${MOVEMENT_KINDS.map((k) => `${MOVEMENT_LABEL[k]} ${formatTry(m.amounts[k])}`).join(", ")}; net ${signed(m.net)}`
              : `${monthLong(m.month)}: anlık görüntü yok`;
            return (
              <li key={m.month} className={cn("min-w-0 flex-1 flex-col items-center", hideOnMobile ? "hidden sm:flex" : "flex")} title={summary}>
                <span className="sr-only">{summary}</span>
                <span aria-hidden className="flex w-full max-w-10 flex-col-reverse justify-start" style={{ height: topPx }}>
                  {m.covered
                    ? POSITIVE.map((k) =>
                        m.amounts[k] > 0 ? (
                          <span key={k} className={`pm-t-${KIND_TONE[k]} block w-full last:rounded-t-[4px]`} style={{ height: `${(m.amounts[k] / scale) * CHART_PX}px`, background: "var(--t)" }} />
                        ) : null,
                      )
                    : null}
                </span>
                <span aria-hidden className="block h-px w-full bg-[var(--line-strong)]" />
                <span aria-hidden className="flex w-full max-w-10 flex-col" style={{ height: bottomPx }}>
                  {m.covered
                    ? NEGATIVE.map((k) =>
                        m.amounts[k] > 0 ? (
                          <span key={k} className={`pm-t-${KIND_TONE[k]} block w-full last:rounded-b-[4px]`} style={{ height: `${(m.amounts[k] / scale) * CHART_PX}px`, background: "var(--t)", opacity: 0.85 }} />
                        ) : null,
                      )
                    : null}
                </span>
                <span aria-hidden className="mt-1.5 text-xs text-text-muted">{monthShortOfKey(m.month)}</span>
                <span aria-hidden className={cn("text-[0.6875rem] font-semibold tabular-nums", !m.covered ? "text-text-faint" : m.net >= 0 ? "text-[color:var(--pm-success-text)]" : "text-[color:var(--pm-danger-text)]")}>
                  {m.covered ? (m.net === 0 ? "0" : `${m.net > 0 ? "+" : "−"}${compact(Math.abs(m.net))}`) : "—"}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 border-t border-hairline pt-3">
          <p className="ds-eyebrow">{monthLong(last.month)} · net yeni MRR {signed(last.net)}</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 xl:grid-cols-5">
            {MOVEMENT_KINDS.map((k) => (
              <li key={k} className="flex min-w-0 items-center gap-2 text-sm">
                <span className={`pm-t-${KIND_TONE[k]} h-2.5 w-2.5 shrink-0 rounded-sm`} style={{ background: "var(--t)" }} aria-hidden />
                <span className="min-w-0 truncate text-text-muted">{MOVEMENT_LABEL[k]}</span>
                <span className="ml-auto shrink-0 tabular-nums font-semibold text-text">
                  {NEGATIVE.includes(k) && last.amounts[k] > 0 ? "−" : ""}
                  {formatTry(last.amounts[k])}
                  <span className="ml-1 text-xs font-normal text-text-faint">{last.counts[k]} ofis</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-faint">Son sütun bu ayın bugüne kadarki son anlık görüntüsüdür; iç ve test ofisleri hariç.</p>
        </div>
      </>
    );
  })();
  return (
    <ChartCard
      as="h2"
      title="MRR hareketleri"
      subtitle="Yeni, genişleme, geri dönen, daralma ve kayıp · 12 ay"
      icon={Repeat}
      tone="gold"
      href="/admin/billing"
      hrefLabel="Gelir ayrıntısı"
      height={0}
      className="h-full"
    >
      {body}
    </ChartCard>
  );
}

/** ₺ kısaltması (sütun altı net etiketi dar alana sığsın): 12.500 → 12,5 B. */
function compact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} Mn`;
  if (v >= 1_000) return `${(v / 1_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} B`;
  return String(Math.round(v));
}

/** NRR / GRR şeridi (Birim ekonomisi kartının altı): son ay ve pencere boyu. Veri < 2 ay ise "birikiyor". */
export async function RetentionStrip() {
  const data = await loadRevenueAnalytics();
  if (data.status !== "ok") {
    return (
      <p className="rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2 text-xs leading-5 text-text-muted">
        <span className="font-semibold text-text">Net gelir tutma (NRR): </span>
        {data.status === "missing" ? "ay sonu gelir okuyucusu kurulum bekliyor; tahmini sayı gösterilmez." : "anlık görüntüler okunamadı."}
      </p>
    );
  }
  const n = data.months.length;
  const monthly = revenueRetention(data.rows, data.months[n - 2]!, data.months[n - 1]!, data.internal);
  const first = firstCoveredMonth(data.rows, data.months);
  const span = first ? monthDiff(first, data.months[n - 1]!) : 0;
  const trailing = first && span >= 2 ? revenueRetention(data.rows, first, data.months[n - 1]!, data.internal) : null;
  if (!monthly && !trailing) {
    return (
      <p className="rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2 text-xs leading-5 text-text-muted">
        <span className="font-semibold text-text">Net gelir tutma (NRR): veri birikiyor.</span> Hesap için en az iki ay sonu anlık görüntüsü gerekir
        {first ? ` (ilk görüntü ${monthLong(first)})` : ""}. Tahmini sayı gösterilmez.
      </p>
    );
  }
  const tiles = [
    monthly ? { key: "m-nrr", label: "NRR · son ay", value: monthly.nrr, hint: `${monthly.startTenants} ofis, ${formatTry(monthly.startMrr)} taban` } : null,
    monthly ? { key: "m-grr", label: "GRR · son ay", value: monthly.grr, hint: "Genişleme hariç" } : null,
    trailing ? { key: "t-nrr", label: `NRR · ${span} ay`, value: trailing.nrr, hint: `${monthLong(trailing.from)} tabanı` } : null,
    trailing ? { key: "t-grr", label: `GRR · ${span} ay`, value: trailing.grr, hint: "Genişleme hariç" } : null,
  ].filter((t): t is NonNullable<typeof t> => t !== null);
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {tiles.map((t) => (
        <Link key={t.key} href="/admin/billing" className="ds-tile ds-lift focus-ring min-w-0">
          <span className="truncate text-xs text-text-muted">{t.label}</span>
          <span className={cn("ds-num flex items-center gap-1 text-lg", t.value >= 100 ? "text-[color:var(--pm-success-text)]" : t.value < 90 ? "text-[color:var(--pm-danger-text)]" : "")}>
            %{t.value.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
            {t.value >= 100 ? <ArrowUpRight className="h-4 w-4" aria-hidden /> : <ArrowDownRight className="h-4 w-4" aria-hidden />}
          </span>
          <span className="truncate text-xs text-text-faint">{t.hint}</span>
        </Link>
      ))}
    </div>
  );
}

/** Kayıt kohortu ızgarası: kayıt ayı × kayıttan sonraki ay, hücre = ödeyen ofis oranı. Mobilde son 6 kohort × 6 ay. */
export async function CohortSection() {
  const data = await loadRevenueAnalytics();
  const MAX_OFFSET = 12;
  const body = (() => {
    if (data.status !== "ok") return <MissingState status={data.status} />;
    const grid = signupCohorts(data.rows, data.signups, data.months, { maxOffset: MAX_OFFSET, excluded: data.internal }).slice(0, 12);
    const hasCells = grid.some((g) => g.cells.some((c) => c !== null));
    if (!hasCells) {
      return (
        <EmptyState
          variant="compact"
          illustration="rapor"
          title="Kohort ızgarası için veri birikiyor"
          description="Ay sonu gelir anlık görüntüleri biriktikçe her kayıt ayının ödeyen ofis oranı burada ay ay görünür."
          action={{ href: "/admin/tenants?yeni=90", label: "Son kayıtlar" }}
        />
      );
    }
    return (
      <>
        <div className="-mx-1.5 overflow-x-auto sm:mx-0">
          <table className="w-full border-separate border-spacing-0.5 text-xs">
            <caption className="sr-only">Kayıt ayına göre, kayıttan sonraki her ay sonunda ödeyen ofis oranı</caption>
            <thead>
              <tr>
                <th scope="col" className="px-1.5 py-1 text-left font-semibold text-text-muted">Kayıt</th>
                {Array.from({ length: MAX_OFFSET + 1 }, (_, k) => (
                  <th key={k} scope="col" className={cn("px-1 py-1 text-center font-semibold text-text-muted", k > 5 && "hidden sm:table-cell")}>
                    {k === 0 ? "0. ay" : `+${k}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, ri) => (
                <tr key={row.cohort} className={ri >= 6 ? "hidden sm:table-row" : undefined}>
                  <th scope="row" className="whitespace-nowrap px-1.5 py-1 text-left font-semibold text-text">
                    {monthLong(row.cohort)}
                    <span className="block text-[0.6875rem] font-normal text-text-faint">{row.size} ofis</span>
                  </th>
                  {row.cells.map((c, k) => (
                    <td key={k} className={cn("h-10 min-w-10 rounded-[6px] text-center tabular-nums", k > 5 && "hidden sm:table-cell")}>
                      {c ? (
                        <span
                          className="pm-t-success grid h-full place-items-center rounded-[6px] font-semibold text-text"
                          style={{ background: `color-mix(in srgb, var(--t) ${8 + cohortHeat(c.pct) * 18}%, transparent)` }}
                          title={`${monthLong(row.cohort)} kohortu · ${monthLong(c.month)}: ${c.paying}/${row.size} ofis ödüyor (%${c.pct}) · MRR ${formatTry(c.mrr)}`}
                        >
                          %{c.pct}
                        </span>
                      ) : (
                        <span className="text-text-faint" aria-label="veri yok">·</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-text-faint">
          Hücre: kayıttan o kadar ay sonra ay sonunda aboneliği ödeyen ofis oranı (deneme dahil kayıt tabanı). Nokta: o ayın anlık görüntüsü yok ya da ay henüz gelmedi.
        </p>
      </>
    );
  })();
  return (
    <ChartCard
      as="h2"
      title="Kayıt kohortları"
      subtitle="Kayıt ayına göre ödeyen ofis oranı"
      icon={Grid3x3}
      tone="success"
      href="/admin/tenants?yeni=90"
      hrefLabel="Son kayıtlar"
      height={0}
      className="h-full"
    >
      {body}
    </ChartCard>
  );
}
