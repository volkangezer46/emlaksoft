"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ChevronDown, Info, Wallet } from "lucide-react";
import {
  APPROX_DISCLAIMER,
  DEFAULT_DOWN_PAYMENT_PCT,
  DEFAULT_LOAN_MONTHS,
  DEFAULT_MONTHLY_RATE_PCT,
  MAX_LOAN_MONTHS,
  MIN_LOAN_MONTHS,
  computeLoanPlan,
  computePurchaseCosts,
  formatTry,
} from "@/lib/purchase-costs";

/**
 * Vitrin ilan detayı — "Bu evi alırsam ne öderim?" hesaplayıcısı.
 *
 * TAMAMEN İSTEMCİ: Sayfa ISR ile 120 sn önbellekli; hesabın sunucuya inen
 * hiçbir parçası yok (saf fonksiyonlar + useState), böylece önbellek bozulmaz
 * ve ziyaretçi kaydırıcıyı oynattığında sonuç anında değişir.
 *
 * Çıktı bilgilendirme amaçlıdır — sonunda ziyaretçiyi talep formuna yönlendirir.
 */
export function PurchaseCalculator({
  price,
  sqm,
  leadAnchorId,
}: {
  price: number;
  sqm?: number | null;
  /** "Bize ulaşın" düğmesinin kaydıracağı talep formu id'si. */
  leadAnchorId: string;
}) {
  const [open, setOpen] = useState(false);
  const [downPct, setDownPct] = useState(DEFAULT_DOWN_PAYMENT_PCT);
  const [months, setMonths] = useState(DEFAULT_LOAN_MONTHS);
  const [monthlyRatePct, setMonthlyRatePct] = useState(DEFAULT_MONTHLY_RATE_PCT);

  const downPayment = Math.round((price * downPct) / 100);

  const costs = useMemo(
    () => computePurchaseCosts({ price, downPayment, sqm: sqm ?? null }),
    [price, downPayment, sqm],
  );
  const loan = useMemo(
    () => computeLoanPlan({ amount: costs.loanAmount, monthlyRatePct, months, scheduleRows: 0 }),
    [costs.loanAmount, monthlyRatePct, months],
  );

  return (
    <section className="mt-5 overflow-hidden rounded-[18px] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="focus-ring flex w-full items-center justify-between gap-3 p-5 text-left transition hover:bg-brand-600/[0.03]"
      >
        <span className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-brand-600/10 text-brand-600">
            <Wallet className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-display text-base font-extrabold text-ink-950">
              Bu evi alırsam ne öderim?
            </span>
            <span className="mt-0.5 block text-xs text-text-muted">
              Peşinat, kredi taksiti ve tapu/komisyon masraflarını saniyede görün
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
              id="pc-pesinat"
              label="Peşinat"
              value={`%${downPct} · ${formatTry(downPayment)}`}
              min={0}
              max={100}
              step={5}
              current={downPct}
              onChange={setDownPct}
            />
            <SliderRow
              id="pc-vade"
              label="Kredi vadesi"
              value={`${months} ay`}
              min={MIN_LOAN_MONTHS}
              max={MAX_LOAN_MONTHS}
              step={12}
              current={months}
              onChange={setMonths}
            />
            <SliderRow
              id="pc-faiz"
              label="Aylık faiz oranı"
              value={`%${monthlyRatePct.toFixed(2)}`}
              min={0}
              max={6}
              step={0.05}
              current={monthlyRatePct}
              onChange={setMonthlyRatePct}
            />
          </div>

          {/* --- Sonuç ---------------------------------------------------- */}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[14px] border border-brand-600/20 bg-brand-600/6 p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">Aylık taksit</p>
              <p className="numeric mt-1 font-display text-2xl font-extrabold tabular-nums text-ink-950">
                {loan.monthlyPayment > 0 ? formatTry(loan.monthlyPayment) : "Kredi yok"}
              </p>
              <p className="mt-0.5 text-[11px] text-text-muted">
                {loan.monthlyPayment > 0
                  ? `${formatTry(costs.loanAmount)} kredi · ${months} ay`
                  : "Peşin alım varsayıldı"}
              </p>
            </div>
            <div className="rounded-[14px] border border-mint-500/25 bg-mint-500/8 p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mint-600">Cepten çıkan toplam</p>
              <p className="numeric mt-1 font-display text-2xl font-extrabold tabular-nums text-ink-950">
                {formatTry(costs.cashOutOfPocket)}
              </p>
              <p className="mt-0.5 text-[11px] text-text-muted">
                {formatTry(costs.downPayment)} peşinat + {formatTry(costs.totalCosts)} masraf
              </p>
            </div>
          </div>

          {/* --- Masraf dökümü -------------------------------------------- */}
          {costs.lines.length > 0 ? (
            <ul className="mt-4 divide-y divide-line rounded-[14px] border border-line">
              {costs.lines.map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="text-text-muted">{l.label}</span>
                  <span className="numeric shrink-0 font-semibold tabular-nums text-ink-950">
                    {formatTry(l.amount)}
                  </span>
                </li>
              ))}
              {loan.totalInterest > 0 ? (
                <li className="flex items-center justify-between gap-3 bg-canvas/60 px-4 py-2.5 text-sm">
                  <span className="text-text-muted">Vade sonuna kadar toplam faiz</span>
                  <span className="numeric shrink-0 font-semibold tabular-nums text-ink-950">
                    {formatTry(loan.totalInterest)}
                  </span>
                </li>
              ) : null}
            </ul>
          ) : null}

          <p className="mt-4 flex items-start gap-2 rounded-[12px] border border-amber-400/30 bg-amber-400/8 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {APPROX_DISCLAIMER} Taşınma, tadilat, aidat ve abonelik bedelleri dâhil değildir.
          </p>

          <a
            href={`#${leadAnchorId}`}
            className="btn-shine mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-600/90"
          >
            <ArrowDown className="h-4 w-4" /> Detaylı bilgi için bize ulaşın
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
