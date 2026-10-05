"use client";

import { useId, useMemo, useState } from "react";
import { calculateRoi, formatNum, formatTry, parseTrNumber, type RoiRaw } from "@/lib/roi-calculator";
import { AnimatedNumber } from "@/components/ui/animated-number";
import type { PlanDef } from "@/lib/billing/plans";
import { applyOffers, type SeatCalcOffers } from "@/lib/billing/seat-calculator-model";
import { maxTotalSeats, quoteSeats } from "@/lib/billing/seat-pricing";

const FIELDS: { key: keyof RoiRaw; label: string; hint: string; unit?: string; example: string }[] = [
  { key: "monthlyLeads", label: "Aylık gelen talep sayısı", hint: "Telefon, portal, web ve yönlendirmeyle gelen toplam talep.", example: "örn. 60" },
  { key: "avgPrice", label: "Ortalama portföy / satış bedeli", hint: "Sattığınız bir mülkün ortalama bedeli.", unit: "₺", example: "örn. 4.500.000" },
  { key: "commissionRate", label: "Ortalama komisyon oranı", hint: "KDV hariç, tek taraf için.", unit: "%", example: "örn. 2" },
  { key: "conversionRate", label: "Şu anki dönüşüm oranı", hint: "Taleplerin satışa dönüşme yüzdesi.", unit: "%", example: "örn. 4" },
  { key: "untrackedRate", label: "Takipsiz kalan talep oranı", hint: "Geri dönülmeyen veya unutulan taleplerin yüzdesi.", unit: "%", example: "örn. 25" },
  { key: "advisors", label: "Danışman sayısı", hint: "İsteğe bağlı; girerseniz paket bedeli bu kullanıcı sayısına göre hesaplanır.", example: "örn. 4" },
];

const EMPTY: RoiRaw = { monthlyLeads: "", avgPrice: "", commissionRate: "", conversionRate: "", untrackedRate: "", advisors: "" };

/**
 * Paket bedeli ek kullanıcı fiyatlama motorundan (seat-pricing) gelir: "Danışman sayısı" girildiyse seçilen
 * paketin O KADAR kullanıcı için aylık toplamı, girilmediyse dahil kullanıcı sayısı için tutarı kullanılır.
 * Fiyat mantığı burada çoğaltılmaz.
 */
export function RoiCalculator({
  plans,
  offers,
  defaultPlanId,
}: {
  plans: readonly PlanDef[];
  offers?: SeatCalcOffers;
  defaultPlanId: string;
}) {
  const uid = useId();
  const [raw, setRaw] = useState<RoiRaw>(EMPTY);
  const [planId, setPlanId] = useState(defaultPlanId);
  const effective = useMemo(() => applyOffers(plans, offers), [plans, offers]);
  const plan = effective.find((p) => p.id === planId) ?? effective[0]!;
  const advisors = parseTrNumber(raw.advisors);
  const seats = advisors !== null && advisors >= 1 ? Math.floor(advisors) : plan.limits.seats;
  const quote = quoteSeats(effective, plan.id, seats, "monthly");
  const cap = maxTotalSeats(plan);
  const result = calculateRoi(raw, {
    monthlyTry: quote.totalMonthlyTry,
    // Ek kullanıcı satın alınabildiği için kapsam uyarısı yalnız paketin azami kullanıcısına göredir.
    seats: Number.isFinite(cap) ? cap : Number.MAX_SAFE_INTEGER,
  });
  const invalid = result.status === "invalid" ? result.fields : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <form
        className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-7"
        onSubmit={(e) => e.preventDefault()}
        noValidate
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {FIELDS.map((f) => {
            const id = `${uid}-${f.key}`;
            const bad = invalid.includes(f.key);
            return (
              <div key={f.key} className={f.key === "advisors" ? "sm:col-span-1" : undefined}>
                <label htmlFor={id} className="block text-sm font-semibold text-ink-950">
                  {f.label}
                </label>
                <div className="relative mt-1.5">
                  <input
                    id={id}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={raw[f.key]}
                    placeholder={f.example}
                    aria-invalid={bad}
                    aria-describedby={`${id}-hint`}
                    onChange={(e) => setRaw((r) => ({ ...r, [f.key]: e.target.value }))}
                    className={`h-11 w-full rounded-[var(--radius-control)] border bg-surface px-3 text-base text-ink-950 placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                      f.unit ? "pr-9" : ""
                    } ${bad ? "border-danger-600" : "border-line-strong"}`}
                  />
                  {f.unit ? (
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-text-muted">
                      {f.unit}
                    </span>
                  ) : null}
                </div>
                <p id={`${id}-hint`} className={`mt-1 text-xs ${bad ? "font-semibold text-danger-700" : "text-text-muted"}`}>
                  {bad ? "Geçerli bir sayı girin (yüzdeler 0-100 arası)." : f.hint}
                </p>
              </div>
            );
          })}
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-plan`} className="block text-sm font-semibold text-ink-950">
              Kıyaslanacak paket
            </label>
            <select
              id={`${uid}-plan`}
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-base text-ink-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              {effective.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · taban {formatTry(p.monthlyTry)}/ay (KDV hariç)
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRaw(EMPTY)}
          className="mt-5 inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Girdileri temizle
        </button>
      </form>

      <section aria-labelledby={`${uid}-sonuc`} className="rounded-[var(--radius-panel)] border border-line bg-surface-2 p-5 sm:p-7">
        <h3 id={`${uid}-sonuc`} className="font-display text-lg font-bold text-ink-950">
          Tahmini sonuç
        </h3>
        <div aria-live="polite" aria-atomic="true" className="mt-4">
          {result.status === "empty" ? (
            <p className="text-sm text-text-muted">Kendi sayılarınızı girin; sonuç burada, hesabın nasıl yapıldığıyla birlikte görünür. Hiçbir sektör ortalaması kullanılmaz.</p>
          ) : result.status === "invalid" ? (
            <p className="text-sm text-text-muted">Tüm alanlara geçerli ve negatif olmayan sayılar girdiğinizde sonuç hesaplanır.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-text-muted">Takip edilmeyen taleplerden tahmini kaçan komisyon</p>
                <p className="font-display text-3xl font-bold tabular-nums text-ink-950 sm:text-4xl">
                  <AnimatedNumber value={result.missedMonthly} kind="currency" /> <span className="text-base font-semibold text-text-muted">/ ay</span>
                </p>
                <p className="text-sm tabular-nums text-text-muted">Yılda yaklaşık <AnimatedNumber value={result.missedYearly} kind="currency" /> (KDV hariç)</p>
              </div>
              <dl className="space-y-2 border-t border-line pt-4 text-sm">
                <Row dt={`${plan.name} paketinin aylık bedeli (${seats} kullanıcı)`} dd={`${formatTry(result.planMonthly)} (KDV hariç)`} />
                {result.coverage !== null ? (
                  <Row dt="Kaçan komisyon / paket bedeli" dd={`${formatNum(result.coverage)} kat`} />
                ) : null}
                {result.breakEvenDeals !== null ? (
                  <Row dt="Paket bedelini çıkarmak için gereken kapanış" dd={`ayda ${formatNum(result.breakEvenDeals, 2)} satış`} />
                ) : null}
                <Row dt="Fark (kaçan komisyon - paket bedeli)" dd={formatTry(result.netMonthly)} />
              </dl>
              <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3 text-xs leading-relaxed text-text-muted">
                <p className="font-semibold text-ink-950">Hesap</p>
                <p className="mt-1 tabular-nums">
                  {formatNum(result.untrackedLeads)} takipsiz talep × %{raw.conversionRate.trim()} dönüşüm = {formatNum(result.missedDeals)} kaçan satış × {formatTry(result.commissionPerDeal)} komisyon (KDV hariç) = {formatTry(result.missedMonthly)}
                </p>
              </div>
              {result.seatsExceeded ? (
                <p role="status" className="rounded-[var(--radius-card)] tone-warning p-3 text-sm">
                  {plan.name} paketi en fazla {Number.isFinite(cap) ? cap : seats} kullanıcıyı kapsar; danışman sayınız bunu aşıyor.
                </p>
              ) : null}
            </div>
          )}
        </div>
        <p className="mt-5 text-xs leading-relaxed text-text-muted">
          Bu bir tahmindir ve yalnızca sizin girdilerinize dayanır. Takipsiz taleplerin, takip edilseydi mevcut dönüşüm oranınızla kapanacağı varsayılır; gerçek sonuç farklı olabilir. Sektör verisi veya ortalama kullanılmaz.
        </p>
      </section>
    </div>
  );
}

function Row({ dt, dd }: { dt: string; dd: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="text-text-muted">{dt}</dt>
      <dd className="font-semibold tabular-nums text-ink-950">{dd}</dd>
    </div>
  );
}
