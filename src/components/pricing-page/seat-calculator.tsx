"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { ArrowRight, Users } from "lucide-react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import type { BillingCycle, PlanDef } from "@/lib/billing/plans";
import {
  clampSeats,
  computeSeatCalc,
  seatBounds,
  seatCalcAnnouncement,
  type SeatCalcOffers,
} from "@/lib/billing/seat-calculator-model";
import { formatNumberTr } from "@/lib/format";

const money = (n: number) => `${formatNumberTr(Math.round(n))} ₺`;

/**
 * "Kaç kişilik ekibiniz var?" hesaplayıcısı. Plan verisi sunucudan props ile gelir (sabit fiyat yok);
 * hesap `seat-pricing` motoruyla istemcide ANLIK yapılır. Ağır parça olduğu için `SeatCalculatorLazy`
 * ile görünür alana yaklaşınca yüklenir (ilk boyamaya JS eklemez).
 */
export default function SeatCalculator({
  plans,
  offers,
  trialDays,
  initialSeats = 5,
  initialCycle = "monthly",
}: {
  plans: readonly PlanDef[];
  offers?: SeatCalcOffers;
  trialDays?: number;
  initialSeats?: number;
  initialCycle?: BillingCycle;
}) {
  const uid = useId();
  const bounds = useMemo(() => seatBounds(plans), [plans]);
  const [seats, setSeats] = useState(() => clampSeats(initialSeats, bounds));
  const [text, setText] = useState(() => String(clampSeats(initialSeats, bounds)));
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);

  const result = useMemo(() => computeSeatCalc(plans, offers, seats, cycle), [plans, offers, seats, cycle]);
  const contact = result.status === "over_max";
  const unit = cycle === "yearly" ? "yıl" : "ay";
  const ctaHref = `/kayit?plan=${result.planId}&cycle=${cycle}&seats=${contact ? bounds.inputMax : seats}`;
  const ctaLabel = trialDays ? `${trialDays} gün ücretsiz başla` : "Ücretsiz başla";

  function commit(n: number) {
    const v = clampSeats(n, bounds);
    setSeats(v);
    setText(String(v));
  }

  function onText(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 3);
    setText(digits);
    if (digits !== "") setSeats(clampSeats(Number(digits), bounds));
  }

  const sliderValue = Math.min(seats, bounds.sliderMax);

  return (
    <div className="grid gap-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5 text-left shadow-[var(--shadow-sm)] sm:p-7 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <h3 className="flex items-center gap-2 font-display text-xl font-bold text-ink-950">
          <Users aria-hidden className="h-5 w-5 text-brand-600" /> Kaç kişilik ekibiniz var?
        </h3>
        <p className="mt-1 text-sm text-text-muted">Kullanıcı sayısını seçin; size en uygun paket ve toplam tutar anında hesaplanır.</p>

        <div className="mt-5 flex items-center gap-3">
          <label htmlFor={`${uid}-n`} className="sr-only">
            Kullanıcı sayısı
          </label>
          <button
            type="button"
            aria-label="Kullanıcı sayısını azalt"
            onClick={() => commit(seats - 1)}
            disabled={seats <= bounds.min}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line-strong text-lg font-semibold text-ink-950 transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40 motion-reduce:transition-none"
          >
            −
          </button>
          <input
            id={`${uid}-n`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={text}
            onChange={(e) => onText(e.target.value)}
            onBlur={() => commit(text === "" ? bounds.min : Number(text))}
            className="h-11 w-24 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-center text-lg font-bold tabular-nums text-ink-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          />
          <button
            type="button"
            aria-label="Kullanıcı sayısını artır"
            onClick={() => commit(seats + 1)}
            disabled={seats >= bounds.inputMax}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line-strong text-lg font-semibold text-ink-950 transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-40 motion-reduce:transition-none"
          >
            +
          </button>
          <span className="text-sm text-text-muted">kullanıcı</span>
        </div>

        <input
          type="range"
          aria-label="Kullanıcı sayısı kaydırıcısı"
          aria-valuetext={`${seats} kullanıcı`}
          min={bounds.min}
          max={bounds.sliderMax}
          step={1}
          value={sliderValue}
          onChange={(e) => commit(Number(e.target.value))}
          className="mt-5 h-11 w-full cursor-pointer accent-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        />
        <div className="flex justify-between text-xs tabular-nums text-text-muted" aria-hidden>
          <span>{bounds.min}</span>
          <span>{bounds.sliderMax}</span>
        </div>

        <div role="radiogroup" aria-label="Faturalandırma dönemi" className="mt-5 inline-flex rounded-[var(--radius-card)] border border-line bg-surface-2 p-1">
          {(["monthly", "yearly"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={`min-h-11 rounded-[var(--radius-control)] px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 motion-reduce:transition-none ${
                cycle === c ? "bg-[var(--ink-950)] text-white shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-ink-950"
              }`}
            >
              {c === "monthly" ? "Aylık" : `Yıllık${result.yearlyLabel ? ` · ${result.yearlyLabel}` : ""}`}
            </button>
          ))}
        </div>
      </div>

      <section aria-label="Hesap sonucu" className="min-h-[30rem] rounded-[var(--radius-card)] border border-line bg-surface-2 p-5">
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {seatCalcAnnouncement(result)}
        </p>
        {contact ? (
          <div className="flex h-full min-h-[22rem] flex-col justify-center">
            <p className="text-sm font-bold uppercase tracking-[0.08em] text-brand-700">Kullanıcı sınırı</p>
            <p className="mt-2 font-display text-2xl font-bold text-ink-950">En fazla {formatNumberTr(bounds.inputMax)} kullanıcı</p>
            <p className="mt-2 text-sm text-text-muted">{result.limitNote}</p>
          </div>
        ) : (
          <div>
            <p className="text-sm text-text-muted">Önerilen paket</p>
            <p className="font-display text-2xl font-bold text-ink-950">{result.planName}</p>
            <div className="mt-3 flex min-h-12 flex-wrap items-end gap-x-2">
              <span className="font-display text-4xl font-bold tabular-nums text-ink-950">
                <AnimatedNumber value={result.cycleTotalTry} suffix=" ₺" />
              </span>
              <span className="mb-1 text-sm text-text-muted">/ {unit}</span>
              {result.campaign && result.listMonthlyEquivalentTry !== null ? (
                <span className="mb-1 text-sm tabular-nums text-text-muted line-through">
                  {money(cycle === "yearly" ? result.listMonthlyEquivalentTry * 12 : result.listMonthlyEquivalentTry)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-text-muted">KDV hariç · kullanıcı başı ortalama {money(result.perSeatMonthlyTry)} / ay</p>
            <div className="mt-2 min-h-10 space-y-1 text-sm font-semibold text-mint-700">
              {cycle === "yearly" && result.yearlySavingTry > 0 ? (
                <p>
                  {result.yearlyLabel}: yılda {money(result.yearlySavingTry)} tasarruf (aylık eşdeğer {money(result.monthlyEquivalentTry)})
                </p>
              ) : cycle === "monthly" && result.yearlySavingTry > 0 ? (
                <p>Yıllık ödemede {result.yearlyLabel}: yılda {money(result.yearlySavingTry)} tasarruf</p>
              ) : null}
              {result.campaign ? <p>Kampanya fiyatı uygulanıyor</p> : null}
            </div>
          </div>
        )}

        {!contact ? (
          <div className="mt-3 space-y-3">
            <details className="motion-details group rounded-[var(--radius-control)] border border-line bg-surface px-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-ink-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
                Fiyat kırılımı
                <span aria-hidden className="text-lg leading-none text-brand-700 transition-transform group-open:rotate-45 motion-reduce:transition-none">+</span>
              </summary>
              <dl className="space-y-1.5 pb-3 text-sm">
                <div className="flex flex-wrap justify-between gap-x-3">
                  <dt className="text-text-muted">{result.breakdown.base.label}</dt>
                  <dd className="font-semibold tabular-nums text-ink-950">{money(result.breakdown.base.amountTry)} / ay</dd>
                </div>
                {result.breakdown.rows.map((r) => (
                  <div key={r.fromSeat} className="flex flex-wrap justify-between gap-x-3">
                    <dt className="text-text-muted">
                      {formatNumberTr(r.count)} ek kullanıcı × {money(r.unitTry)}
                    </dt>
                    <dd className="font-semibold tabular-nums text-ink-950">{money(r.subtotalTry)} / ay</dd>
                  </div>
                ))}
                <div className="flex flex-wrap justify-between gap-x-3 border-t border-line pt-1.5">
                  <dt className="font-semibold text-ink-950">Aylık toplam</dt>
                  <dd className="font-bold tabular-nums text-ink-950">{money(result.quote.totalMonthlyTry)}</dd>
                </div>
              </dl>
            </details>

            {result.crossoverNote ? <p className="text-sm text-text">{result.crossoverNote}</p> : null}

            {result.alternatives.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-text-muted">Diğer paketlerle aynı ekip için</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {result.alternatives.map((a) => (
                    <li key={a.planId} className="flex flex-wrap justify-between gap-x-3">
                      <span className="text-text">{a.name}</span>
                      <span className="tabular-nums text-text-muted">
                        {money(cycle === "yearly" ? a.totalForCycleTry : a.totalMonthlyTry)} / {unit}
                        {a.diffMonthlyTry > 0 ? ` (aylık ${money(a.diffMonthlyTry)} fazla)` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <Link
          href={ctaHref}
          className="btn-shine mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {ctaLabel} <ArrowRight aria-hidden className="ml-2 h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
