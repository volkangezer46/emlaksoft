"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, LineChart, Table2, TrendingDown } from "lucide-react";
import { AreaTrend } from "@/app/app/_ui/lazy-chart";
import { getPropertyPriceHistory } from "@/app/actions/property-price-history";
import {
  CURRENCY_LABEL,
  PRICE_FIELD_LABEL,
  formatPrice,
  historyAuthorName,
  priceIn,
  summarizePriceHistory,
  toChartSeries,
  type PriceCurrency,
  type PriceField,
  type PriceHistoryRow,
} from "@/lib/price-history";

const FIELD_TABS: PriceField[] = ["list_price", "min_price", "hidden_price"];

const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" });

function relDays(days: number) {
  if (days <= 0) return "bugün";
  if (days === 1) return "dün";
  return `${days} gün önce`;
}

export function PropertyPriceHistory({
  propertyId,
  initialHistory,
  isRent,
}: {
  propertyId: string;
  initialHistory: PriceHistoryRow[];
  isRent?: boolean;
}) {
  const [field, setField] = useState<PriceField>("list_price");
  const [rows, setRows] = useState<PriceHistoryRow[]>(initialHistory);
  const [view, setView] = useState<"table" | "chart">("table");
  const [currency, setCurrency] = useState<PriceCurrency>("TRY");
  const [pending, start] = useTransition();

  const summary = useMemo(() => summarizePriceHistory(rows), [rows]);
  const chartData = useMemo(() => toChartSeries(rows, currency), [rows, currency]);
  const suffix = isRent ? "/ay" : "";

  // Döviz görünümünde kur verisi olmayan kayıt sayısı — dürüst uyarı için
  const fxMissing = useMemo(
    () => (currency === "TRY" ? 0 : rows.filter((r) => priceIn(r, currency) === null).length),
    [rows, currency],
  );

  // Seçili para biriminde ilk/son/değişim. TL'de summary'nin değerleri;
  // dövizde her kaydın O GÜNKÜ kuruyla çevrilmiş hali — bu sayede
  // "₺'de +%12 ama $'da −%3" gerçeği görünür.
  const display = useMemo(() => {
    if (!summary || rows.length === 0) return null;
    const first = priceIn(rows[0], currency);
    const last = priceIn(rows[rows.length - 1], currency);
    if (first === null || last === null) return null;
    const change = last - first;
    return {
      first,
      last,
      change,
      changePct: first > 0 ? Math.round((change / first) * 1000) / 10 : 0,
    };
  }, [summary, rows, currency]);

  function switchField(next: PriceField) {
    if (next === field) return;
    setField(next);
    start(async () => {
      setRows(await getPropertyPriceHistory(propertyId, next));
    });
  }

  const trendClass =
    !display || display.change === 0
      ? "text-text-muted"
      : display.change < 0
        ? "text-danger-600"
        : "text-mint-700";

  return (
    <section className="surface-card overflow-hidden rounded-[20px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <TrendingDown className="h-4 w-4 text-brand-600" /> Fiyat geçmişi
            {summary && summary.changeCount > 0 ? (
              <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-bold text-brand-600">
                {summary.changeCount} değişim
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {summary
              ? `${relDays(summary.daysOnMarket)} kayıtta · son güncelleme ${relDays(summary.daysSinceLastChange)}`
              : "Fiyat değişimi kaydedildikçe burada birikir"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Para birimi — o günkü TCMB resmî kuruyla. "₺'de arttı ama $'da
              düştü" içgörüsü Türkiye piyasasında fiyat konuşmasının kalbi. */}
          <div className="flex rounded-[10px] border border-line p-0.5">
            {(Object.keys(CURRENCY_LABEL) as PriceCurrency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                className={`focus-ring rounded-[8px] px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  currency === c ? "bg-brand-600 text-white" : "text-text-muted hover:text-ink-950"
                }`}
              >
                {CURRENCY_LABEL[c]}
              </button>
            ))}
          </div>
          <div className="flex rounded-[10px] border border-line p-0.5">
            {FIELD_TABS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => switchField(f)}
                className={`rounded-[8px] px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  field === f ? "bg-ink-950 text-white" : "text-text-muted hover:text-ink-950"
                }`}
              >
                {PRICE_FIELD_LABEL[f]}
              </button>
            ))}
          </div>
          {rows.length >= 2 ? (
            <div className="flex rounded-[10px] border border-line p-0.5">
              <button
                type="button"
                onClick={() => setView("table")}
                aria-label="Tablo görünümü"
                className={`rounded-[8px] px-2.5 py-1.5 transition ${view === "table" ? "bg-ink-950 text-white" : "text-text-muted hover:text-ink-950"}`}
              >
                <Table2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setView("chart")}
                aria-label="Grafik görünümü"
                className={`rounded-[8px] px-2.5 py-1.5 transition ${view === "chart" ? "bg-ink-950 text-white" : "text-text-muted hover:text-ink-950"}`}
              >
                <LineChart className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {pending ? (
        <p className="px-5 py-10 text-center text-sm text-text-muted">Yükleniyor…</p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-text-muted">
          Bu portföy için {PRICE_FIELD_LABEL[field].toLowerCase()} kaydı yok. Fiyat güncellendiğinde
          otomatik olarak buraya düşer.
        </p>
      ) : (
        <>
          {summary && display ? (
            <div className="hairline-b px-5 py-4">
              {fxMissing > 0 ? (
                <p className="mb-3 rounded-[10px] bg-amber-400/10 px-3 py-2 text-[11px] font-medium text-amber-700">
                  {fxMissing} kayıt için o güne ait kur verisi yok; bu kayıtlar döviz görünümünde gizlendi.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">İlk fiyat</p>
                  <p className="numeric font-display text-lg font-extrabold text-ink-950">
                    {formatPrice(display.first, currency)}{suffix}
                  </p>
                  <p className="text-[11px] text-text-faint">{dateFmt.format(new Date(summary.firstDate))}</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-text-faint" />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">Güncel</p>
                  <p className="numeric font-display text-lg font-extrabold text-ink-950">
                    {formatPrice(display.last, currency)}{suffix}
                  </p>
                  <p className="text-[11px] text-text-faint">{dateFmt.format(new Date(summary.lastDate))}</p>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                <div className="surface-sunken rounded-[12px] px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">Toplam değişim</p>
                  <p className={`numeric mt-0.5 font-display text-sm font-extrabold ${trendClass}`}>
                    {display.change > 0 ? "+" : display.change < 0 ? "−" : ""}
                    {formatPrice(Math.abs(display.change), currency)}
                  </p>
                </div>
                <div className="surface-sunken rounded-[12px] px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">Yüzde</p>
                  <p className={`numeric mt-0.5 font-display text-sm font-extrabold ${trendClass}`}>
                    {display.changePct > 0 ? "+" : ""}
                    %{display.changePct}
                  </p>
                </div>
                <div className="surface-sunken rounded-[12px] px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">İndirim / zam</p>
                  <p className="numeric mt-0.5 font-display text-sm font-extrabold text-ink-950">
                    {summary.cutCount} / {summary.raiseCount}
                  </p>
                </div>
                <div className="surface-sunken rounded-[12px] px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">Ort. aralık</p>
                  <p className="numeric mt-0.5 font-display text-sm font-extrabold text-ink-950">
                    {summary.avgDaysBetween > 0 ? `${summary.avgDaysBetween} gün` : "—"}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {view === "chart" && chartData.length >= 2 ? (
            <div className="px-5 py-4" style={{ height: 260 }}>
              <AreaTrend
                data={chartData}
                xKey="tarih"
                series={[{ key: "fiyat", label: PRICE_FIELD_LABEL[field] }]}
                format="money"
              />
            </div>
          ) : (
            <div className="divide-y divide-line">
              {[...rows].reverse().map((row) => {
                // Yön TL üzerinden belirlenir (kaydın gerçeği), gösterim
                // seçili para biriminde. Döviz karşılığı yoksa satır atlanmaz,
                // tutar "—" görünür — veri kaybı yerine dürüst boşluk.
                const down = row.old_price != null && row.new_price < row.old_price;
                const up = row.old_price != null && row.new_price > row.old_price;
                const shown = priceIn(row, currency);
                const shownOld = priceIn(row, currency, "old");
                const diff = shown !== null && shownOld !== null ? Math.abs(shown - shownOld) : null;
                return (
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="numeric text-sm font-semibold text-ink-950">
                        {formatPrice(shown, currency)}{shown !== null ? suffix : ""}
                      </p>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        {dateFmt.format(new Date(row.created_at))} · {historyAuthorName(row.changed_by)}
                        {row.reason ? ` · ${row.reason}` : ""}
                      </p>
                    </div>
                    {row.old_price != null ? (
                      <span
                        className={`numeric inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${
                          down
                            ? "bg-danger-500/10 text-danger-600 ring-danger-500/25"
                            : up
                              ? "bg-mint-500/12 text-mint-700 ring-mint-500/25"
                              : "bg-ink-950/6 text-text-muted ring-ink-950/10"
                        }`}
                      >
                        {down ? <ArrowDownRight className="h-3 w-3" /> : up ? <ArrowUpRight className="h-3 w-3" /> : null}
                        {diff !== null ? formatPrice(diff, currency) : "—"}
                        {row.change_pct != null ? ` (%${Math.abs(row.change_pct)})` : ""}
                      </span>
                    ) : (
                      <span className="rounded-full bg-ink-950/6 px-2.5 py-1 text-[11px] font-semibold text-text-muted">
                        Başlangıç
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
