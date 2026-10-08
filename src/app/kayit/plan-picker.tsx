"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, House, Minus, Plus, Sparkles, UserRound, Users } from "lucide-react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { GrowBar, RiseIn } from "@/components/ui/motion/grow";
import { useReducedMotion } from "@/components/ui/use-reduced-motion";
import { cn } from "@/lib/utils";
import { yearlyDiscountPercentOf, yearlyOfferLabel, type BillingCycle, type PlanDef, type PlanId } from "@/lib/billing/plans";
import { maxTotalSeats, type SeatQuote } from "@/lib/billing/seat-pricing";
import { registrationQuote, type SeatCalcOffers } from "@/lib/billing/seat-calculator-model";

/**
 * Kayıt paket seçici (premium): danışman sayısı -> motor önerisi, kullanıcı başka pakete geçebilir.
 * Tüm tutar ve sınırlar katalog/motordan gelir (`registrationQuote` = fiyat sayfası hesaplayıcısıyla AYNI motor);
 * hiçbir rakam burada uydurulmaz. Kapasite çubuğu: "Kullanıcı" satırı SEÇİLEN danışman sayısının paketin en yüksek
 * kullanıcı kapasitesine oranıdır; diğer satırlar paketlerin sınırını birbirine göre gösterir (∞ = sınırsız).
 * Hareket: LazyMotion + m.*; azaltılmış harekette süre 0.
 */

const nf = new Intl.NumberFormat("tr-TR");
const SLIDER_CAP = 60;

type Props = {
  plans: readonly PlanDef[];
  offers?: SeatCalcOffers;
  seats: number;
  seatsMax: number;
  onSeatsChange: (n: number) => void;
  cycle: BillingCycle;
  onCycleChange: (c: BillingCycle) => void;
  recommendedId: PlanId;
  selectedId: PlanId;
  onSelect: (id: PlanId) => void;
  /** Motor hiçbir paketle karşılayamıyorsa (ofis başına en çok kullanıcı aşıldı) açıklama. */
  overMaxNote: string | null;
  trialText: string;
};

type Row = { plan: PlanDef; quote: SeatQuote; fits: boolean; monthlyEq: number };

function limitText(n: number | null): string {
  return n == null ? "∞" : nf.format(n);
}

export function PlanPicker(props: Props) {
  const { plans, offers, seats, cycle, recommendedId, selectedId } = props;
  const reduce = useReducedMotion();
  const sellable = plans.filter((p) => !p.hidden);

  const rows: Row[] = sellable.flatMap((plan) => {
    const quote = registrationQuote(plans, offers, plan.id, seats, cycle);
    if (!quote) return [];
    const monthlyEq = cycle === "yearly" ? Math.round(quote.totalForCycleTry / 12) : quote.totalMonthlyTry;
    return [{ plan, quote, fits: !quote.maxSeatsExceeded, monthlyEq }];
  });
  const maxMonthly = Math.max(1, ...rows.filter((r) => r.fits).map((r) => r.monthlyEq));
  // Paketler arası göreli sınır çubukları: sonlu sınırların en büyüğü 100% (sınırsız = tam çubuk + ∞).
  const maxOf = (pick: (p: PlanDef) => number | null) => Math.max(1, ...sellable.map((p) => pick(p) ?? 0));
  const maxBranches = maxOf((p) => p.limits.branches);
  const maxProps = maxOf((p) => p.limits.activeProperties);
  const maxCustomers = maxOf((p) => p.limits.customers);

  const recommended = rows.find((r) => r.plan.id === recommendedId);
  const selected = rows.find((r) => r.plan.id === selectedId);
  const yearlyPct = Math.max(0, ...sellable.map((p) => yearlyDiscountPercentOf(p)));

  // Mobilde seçilen kart yatay şeritte ortalanır. İlk görünüşte (adım gizliyken genişlik 0) şerit görünür olunca
  // yalnız yatay kaydırılır (sayfa dikey kaymaz); sonra kullanıcı seçtikçe yumuşak ortalanır.
  const stripRef = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (strip.clientWidth === 0 || strip.scrollWidth <= strip.clientWidth) return;
      const el = strip.querySelector<HTMLElement>('[aria-checked="true"]');
      const card = el?.closest<HTMLElement>(".snap-center") ?? el;
      if (card) strip.scrollLeft = card.offsetLeft - (strip.clientWidth - card.offsetWidth) / 2;
      ro.disconnect();
    });
    ro.observe(strip);
    return () => ro.disconnect();
    // Yalnız ilk görünüş için; sonraki seçimler aşağıdaki efektte.
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = stripRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: reduce ? "auto" : "smooth" });
  }, [selectedId, reduce]);

  const [text, setText] = useState(String(seats));
  const [prevSeats, setPrevSeats] = useState(seats);
  if (prevSeats !== seats) {
    setPrevSeats(seats);
    setText(String(seats));
  }
  const commit = (n: number) => props.onSeatsChange(Math.min(props.seatsMax, Math.max(1, Math.floor(Number.isFinite(n) ? n : 1))));

  return (
    <>
      <div className="space-y-5">
        {/* 1) Danışman sayısı */}
        <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="seats" className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
              <Users className="h-4 w-4 text-brand-600" aria-hidden /> Kaç danışman çalışacak?
            </label>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Danışman sayısını azalt" disabled={seats <= 1} onClick={() => commit(seats - 1)} className="focus-ring grid h-11 w-11 place-items-center rounded-[var(--radius-card)] border border-line bg-surface text-ink-950 transition hover:border-brand-300 disabled:opacity-40">
                <Minus className="h-4 w-4" aria-hidden />
              </button>
              <input
                id="seats"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={text}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
                  setText(digits);
                  if (digits !== "") commit(Number(digits));
                }}
                onBlur={() => commit(text === "" ? 1 : Number(text))}
                className="focus-ring h-11 w-20 rounded-[var(--radius-card)] border border-line bg-surface px-2 text-center text-base font-bold tabular-nums text-ink-950"
              />
              <button type="button" aria-label="Danışman sayısını artır" disabled={seats >= props.seatsMax} onClick={() => commit(seats + 1)} className="focus-ring grid h-11 w-11 place-items-center rounded-[var(--radius-card)] border border-line bg-surface text-ink-950 transition hover:border-brand-300 disabled:opacity-40">
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
          <input
            type="range"
            min={1}
            max={Math.min(props.seatsMax, SLIDER_CAP)}
            value={Math.min(seats, Math.min(props.seatsMax, SLIDER_CAP))}
            onChange={(e) => commit(Number(e.target.value))}
            aria-label="Danışman sayısı kaydırıcı"
            className="mt-4 h-2 w-full cursor-pointer accent-[var(--brand-600)]"
          />
          <div className="mt-1 flex justify-between text-xs text-text-faint" aria-hidden>
            <span>1</span>
            <span>{Math.min(props.seatsMax, SLIDER_CAP)}{props.seatsMax > SLIDER_CAP ? "+" : ""}</span>
          </div>
        </div>

        {/* 2) Aylık / yıllık */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink-900">Paketini seç</p>
          <div role="radiogroup" aria-label="Faturalama dönemi" className="inline-flex rounded-full border border-line bg-surface p-1">
            {(["monthly", "yearly"] as const).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={cycle === c}
                onClick={() => props.onCycleChange(c)}
                className={cn(
                  "focus-ring relative min-h-9 rounded-full px-4 text-xs font-semibold transition",
                  cycle === c ? "bg-brand-600 text-white shadow-[var(--shadow-glow-brand)]" : "text-text-muted hover:text-ink-950",
                )}
              >
                {c === "monthly" ? "Aylık" : "Yıllık"}
                {c === "yearly" && yearlyPct > 0 ? (
                  <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold", cycle === "yearly" ? "bg-white/20 text-white" : "bg-mint-500/15 text-mint-700")}>
                    %{yearlyPct} tasarruf
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {props.overMaxNote ? (
          <p className="rounded-[var(--radius-card)] bg-brand-600/[0.06] px-3.5 py-2.5 text-sm text-ink-950" role="status">
            {props.overMaxNote}
          </p>
        ) : (
          <>
            {/* 3) Kartlar */}
            <div
              ref={stripRef}
              role="radiogroup"
              aria-label="Paket"
              className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
            >
              {rows.map(({ plan, quote, fits, monthlyEq }, i) => {
                const active = plan.id === selectedId;
                const isRec = plan.id === recommendedId;
                const seatCap = maxTotalSeats(plan);
                const seatRatio = Number.isFinite(seatCap) ? Math.min(1, seats / seatCap) : Math.min(1, seats / Math.max(seats, 50));
                const bars = [
                  { label: "Kullanıcı", Icon: Users, ratio: seatRatio, value: `${nf.format(seats)} / ${Number.isFinite(seatCap) ? nf.format(seatCap) : "∞"}`, strong: true },
                  { label: "Şube", Icon: Building2, ratio: plan.limits.branches == null ? 1 : plan.limits.branches / maxBranches, value: limitText(plan.limits.branches) },
                  { label: "Aktif portföy", Icon: House, ratio: plan.limits.activeProperties == null ? 1 : plan.limits.activeProperties / maxProps, value: limitText(plan.limits.activeProperties) },
                  { label: "Müşteri", Icon: UserRound, ratio: plan.limits.customers == null ? 1 : plan.limits.customers / maxCustomers, value: limitText(plan.limits.customers) },
                ];
                const diff = recommended && !isRec && fits ? monthlyEq - recommended.monthlyEq : 0;
                return (
                  <RiseIn key={plan.id} delay={i * 0.05} className="min-w-[82%] snap-center sm:min-w-0">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={!fits}
                      onClick={() => props.onSelect(plan.id)}
                      className={cn(
                        "focus-ring group relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-[var(--radius-card)] border p-4 text-left transition-[border-color,box-shadow,transform] duration-200",
                        active ? "border-brand-600 bg-brand-600/[0.04] shadow-[var(--shadow-glow-brand)]" : "border-line bg-surface hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-[var(--elev-2)]",
                        !fits && "cursor-not-allowed opacity-55",
                        reduce && "hover:translate-y-0",
                      )}
                    >
                      {isRec && fits ? (
                        <span aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-amber-400/25 blur-2xl motion-safe:animate-pulse" />
                      ) : null}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-display text-lg font-bold tracking-tight text-ink-950">{plan.name}</p>
                          <p className="text-xs text-text-muted">{plan.blurb}</p>
                        </div>
                        <span
                          aria-hidden
                          className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition", active ? "border-brand-600 bg-brand-600 text-white" : "border-line text-transparent")}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {isRec && fits ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                            <Sparkles className="h-3 w-3" aria-hidden /> Sana uygun
                          </span>
                        ) : plan.popular && fits ? (
                          <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-700">En çok tercih</span>
                        ) : null}
                        {!fits ? <span className="rounded-full bg-line px-2 py-0.5 text-xs font-bold text-text-muted">{nf.format(seats)} kullanıcıyı taşımaz</span> : null}
                      </div>
                      {fits ? (
                        <div>
                          <p className="flex items-baseline gap-1">
                            <AnimatedNumber value={monthlyEq} suffix=" ₺" className="font-display text-3xl font-extrabold tracking-tight text-ink-950" />
                            <span className="text-xs text-text-muted">/ay + KDV</span>
                          </p>
                          <p className="mt-0.5 text-xs text-text-muted">
                            {quote.extraSeats > 0 ? `${quote.includedSeats} dahil + ${quote.extraSeats} ek kullanıcı` : `${quote.includedSeats} kullanıcı dahil`}
                            {cycle === "yearly" ? ` · yıllık ${nf.format(quote.totalForCycleTry)} ₺ (${yearlyOfferLabel(plan)})` : ""}
                          </p>
                          {diff !== 0 ? (
                            <p className={cn("mt-0.5 text-xs font-semibold", diff > 0 ? "text-text-muted" : "text-mint-700")}>
                              {diff > 0 ? `Önerilene göre +${nf.format(diff)} ₺/ay` : `Önerilenden ${nf.format(-diff)} ₺/ay ucuz`}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      <ul className="space-y-1.5" aria-label={`${plan.name} kapasitesi`}>
                        {bars.map(({ label, Icon, ratio, value, strong }) => (
                          <li key={label} className="text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 text-text-muted">
                                <Icon className="h-3.5 w-3.5 text-brand-600" aria-hidden /> {label}
                              </span>
                              <span className={cn("tabular-nums", strong ? "font-bold text-ink-950" : "font-semibold text-ink-900")}>{value}</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                              <GrowBar className={cn("h-full rounded-full", strong ? "bg-[image:var(--grad-brand)]" : "bg-brand-600/55")} percent={Math.max(4, Math.round(ratio * 100))} />
                            </div>
                          </li>
                        ))}
                      </ul>
                      <ul className="mt-auto space-y-1 border-t border-line/70 pt-2.5">
                        {plan.features.slice(2, 5).map((f) => (
                          <li key={f} className="flex items-start gap-1.5 text-xs text-text-muted">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" aria-hidden />
                            <span className="min-w-0">{f}</span>
                          </li>
                        ))}
                      </ul>
                    </button>
                  </RiseIn>
                );
              })}
            </div>

            {/* 4) Paketler arası aylık maliyet karşılaştırması */}
            <figure className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <figcaption className="mb-3 text-xs font-semibold text-text-muted">
                {nf.format(seats)} kullanıcı için aylık maliyet karşılaştırması (KDV hariç{cycle === "yearly" ? ", yıllık ödemenin aylık karşılığı" : ""})
              </figcaption>
              <ul className="space-y-2">
                {rows.map(({ plan, fits, monthlyEq }) => (
                  <li key={plan.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs sm:grid-cols-[7rem_minmax(0,1fr)_5rem]">
                    <span className={cn("truncate", plan.id === selectedId ? "font-bold text-ink-950" : "text-text-muted")}>{plan.name}</span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
                      {fits ? (
                        <GrowBar className={cn("h-full rounded-full", plan.id === selectedId ? "bg-[image:var(--grad-brand)]" : "bg-brand-600/40")} percent={Math.max(3, Math.round((monthlyEq / maxMonthly) * 100))} duration={0.6} />
                      ) : null}
                    </div>
                    <span className="text-right font-semibold tabular-nums text-ink-950">{fits ? `${nf.format(monthlyEq)} ₺` : "—"}</span>
                  </li>
                ))}
              </ul>
            </figure>

            <p className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/[0.07] px-3.5 py-2.5 text-xs leading-relaxed text-ink-900" role="status">
              <strong>{props.trialText}, kart gerekmez.</strong> Seçtiğin paket deneme sonunda geçerli olur; ödeme anında değiştirebilirsin.
              {selected && selected.plan.id !== recommendedId && recommended ? (
                <span className="mt-1 block text-text-muted">
                  Motor {nf.format(seats)} kullanıcı için {recommended.plan.name} paketini önerir; {selected.plan.name} da bu kapasiteyi karşıladığı için seçimine saygı gösterilir.
                </span>
              ) : null}
            </p>
          </>
        )}
      </div>
    </>
  );
}
