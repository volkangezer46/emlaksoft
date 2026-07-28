"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ChevronDown, Info, TrendingUp } from "lucide-react";
import { formatTry } from "@/lib/purchase-costs";
import {
  INVESTMENT_DEFAULTS,
  INVESTMENT_DISCLAIMER,
  computeCashFlow,
  computeRentalYield,
  estimateMonthlyRent,
  formatPct,
  formatYears,
} from "@/lib/investment";

/**
 * Vitrin ilan detayı — "Bu daireyi yatırım için alsam ne kazanırım?" bölümü.
 *
 * TAMAMEN İSTEMCİ: sayfa ISR ile önbellekli; bu bileşenin sunucuya inen hiçbir
 * parçası yok (saf fonksiyonlar + useState), böylece önbellek bozulmaz ve
 * ziyaretçi kaydırıcıyı oynattığında sonuç anında değişir.
 *
 * KİRA VARSAYIMI: ilanın kendi kira verisi yoksa (satılık ilanda genelde yoktur)
 * fiyatın binde 4'ü başlangıç değeri olarak alınır ve ekranda "tahmini" etiketi
 * gösterilir — ziyaretçi kaydırıcıyla kendi beklentisini girer.
 *
 * Çıktı bilgilendirme amaçlıdır; sonunda ziyaretçiyi talep formuna yönlendirir.
 */
export function InvestmentPanel({
  price,
  /** İlanın bilinen aylık kirası (₺). Yoksa fiyattan tahmin edilir. */
  knownMonthlyRent,
  /** "Bize ulaşın" düğmesinin kaydıracağı talep formu id'si. */
  leadAnchorId,
}: {
  price: number;
  knownMonthlyRent?: number | null;
  leadAnchorId: string;
}) {
  const isEstimate = !(knownMonthlyRent && knownMonthlyRent > 0);
  const [open, setOpen] = useState(false);
  const [monthlyRent, setMonthlyRent] = useState(
    isEstimate ? estimateMonthlyRent(price) : Math.round(knownMonthlyRent as number),
  );
  const [downPct, setDownPct] = useState(100); // varsayılan: peşin — kredisiz getiri
  const [rentTouched, setRentTouched] = useState(false);

  const downPayment = Math.round((price * downPct) / 100);

  const cashFlow = useMemo(
    () =>
      computeCashFlow({
        price,
        downPayment,
        // Peşinat %100 ise kredi yok; değilse yasal azami vade ve makul faiz.
        loanMonths: downPct >= 100 ? 0 : 120,
        monthlyRatePct: 2.79,
        monthlyRent,
      }),
    [price, downPayment, downPct, monthlyRent],
  );

  const yieldRes = useMemo(
    () => computeRentalYield({ price, monthlyRent, annualCostsTry: cashFlow.annualOperatingCosts }),
    [price, monthlyRent, cashFlow.annualOperatingCosts],
  );

  const positive = cashFlow.monthlyCashFlow >= 0;
  // Kira kaydırıcısı: fiyatın binde 1'i ile binde 10'u arasında gezinir.
  const rentMin = Math.max(1000, Math.round(price / 1000));
  const rentMax = Math.max(rentMin + 1000, Math.round(price / 100));
  const rentStep = Math.max(250, Math.round(price / 20000));

  return (
    <section className="mt-5 overflow-hidden rounded-[18px] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-ring flex w-full items-center justify-between gap-3 p-5 text-left transition hover:bg-mint-500/[0.04]"
      >
        <span className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-mint-500/10 text-mint-600">
            <TrendingUp className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-display text-base font-extrabold text-ink-950">Yatırım getirisi</span>
            <span className="mt-0.5 block text-xs text-text-muted">
              Kira getirisi, amorti süresi ve aylık cebe kalan — kaydırıcıyla kendi senaryonuzu kurun
            </span>
          </span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-text-muted transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="border-t border-line p-5">
          {/* --- Kaydırıcılar --------------------------------------------- */}
          <div className="space-y-4">
            <SliderRow
              id="ip-kira"
              label="Aylık kira beklentiniz"
              value={`${formatTry(monthlyRent)}${isEstimate && !rentTouched ? " · tahmini" : ""}`}
              min={rentMin}
              max={rentMax}
              step={rentStep}
              current={monthlyRent}
              onChange={(n) => {
                setRentTouched(true);
                setMonthlyRent(n);
              }}
            />
            <SliderRow
              id="ip-pesinat"
              label="Peşinat"
              value={`%${downPct} · ${formatTry(downPayment)}`}
              min={0}
              max={100}
              step={5}
              current={downPct}
              onChange={setDownPct}
            />
          </div>

          {isEstimate && !rentTouched ? (
            <p className="mt-3 rounded-[10px] border border-line bg-canvas/60 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
              Bu ilan için kira verisi bulunmadığından başlangıç kirası, fiyatın binde{" "}
              {INVESTMENT_DEFAULTS.rentEstimatePerMille}&apos;ü olarak <strong>tahmin</strong> edildi. Bölgeyi biliyorsanız
              kaydırıcıyla kendi rakamınızı girin.
            </p>
          ) : null}

          {/* --- Sonuç ---------------------------------------------------- */}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[14px] border border-brand-600/20 bg-brand-600/6 p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">Brüt kira getirisi</p>
              <p className="numeric mt-1 font-display text-2xl font-extrabold tabular-nums text-ink-950">
                {formatPct(yieldRes.grossYieldPct)}
              </p>
              <p className="mt-0.5 text-[11px] text-text-muted">
                Yıllık {formatTry(yieldRes.annualRent)} kira geliri
              </p>
            </div>
            <div className="rounded-[14px] border border-cyan-400/25 bg-cyan-400/8 p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-cyan-600">Amorti süresi</p>
              <p className="numeric mt-1 font-display text-2xl font-extrabold tabular-nums text-ink-950">
                {formatYears(yieldRes.netPaybackYears)}
              </p>
              <p className="mt-0.5 text-[11px] text-text-muted">Giderler düşülmüş net kirayla</p>
            </div>
            <div
              className={`rounded-[14px] border p-4 ${
                positive ? "border-mint-500/25 bg-mint-500/8" : "border-amber-400/30 bg-amber-400/8"
              }`}
            >
              <p
                className={`text-[11px] font-bold uppercase tracking-[0.08em] ${
                  positive ? "text-mint-600" : "text-amber-600"
                }`}
              >
                Aylık net nakit
              </p>
              <p className="numeric mt-1 font-display text-2xl font-extrabold tabular-nums text-ink-950">
                {formatTry(cashFlow.monthlyCashFlow)}
              </p>
              <p className="mt-0.5 text-[11px] text-text-muted">
                {positive ? "Taksit ve giderler sonrası cebinizde kalan" : "Her ay cebinizden koyacağınız tutar"}
              </p>
            </div>
          </div>

          {/* --- Döküm ---------------------------------------------------- */}
          <ul className="mt-4 divide-y divide-line rounded-[14px] border border-line">
            <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="text-text-muted">Tahsil edilen kira (boşluk sonrası)</span>
              <span className="numeric shrink-0 font-semibold tabular-nums text-ink-950">
                {formatTry(cashFlow.effectiveMonthlyRent)}
              </span>
            </li>
            {cashFlow.expenseLines
              .filter((l) => l.key !== "vacancy")
              .map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="text-text-muted">{l.label}</span>
                  <span className="numeric shrink-0 font-semibold tabular-nums text-ink-950">
                    −{formatTry(l.amount)}
                  </span>
                </li>
              ))}
            {cashFlow.monthlyLoanPayment > 0 ? (
              <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="text-text-muted">Kredi taksiti (120 ay, aylık %2,79)</span>
                <span className="numeric shrink-0 font-semibold tabular-nums text-ink-950">
                  −{formatTry(cashFlow.monthlyLoanPayment)}
                </span>
              </li>
            ) : null}
            <li className="flex items-center justify-between gap-3 bg-canvas/60 px-4 py-2.5 text-sm">
              <span className="text-text-muted">Başabaş kira</span>
              <span className="numeric shrink-0 font-semibold tabular-nums text-ink-950">
                {cashFlow.breakEvenRent > 0 ? formatTry(cashFlow.breakEvenRent) : "—"}
              </span>
            </li>
          </ul>

          <p className="mt-4 flex items-start gap-2 rounded-[12px] border border-amber-400/30 bg-amber-400/8 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {INVESTMENT_DISCLAIMER}
          </p>

          <a
            href={`#${leadAnchorId}`}
            className="btn-shine mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-600/90"
          >
            <ArrowDown className="h-4 w-4" /> Bölge kira verisi için bize ulaşın
          </a>
        </div>
      ) : null}
    </section>
  );
}

function SliderRow({
  id,
  label,
  value,
  min,
  max,
  step,
  current,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label className="text-sm text-text-muted" htmlFor={id}>
          {label}
        </label>
        <span className="numeric text-sm font-bold tabular-nums text-brand-600">{value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-brand-600"
      />
    </div>
  );
}
