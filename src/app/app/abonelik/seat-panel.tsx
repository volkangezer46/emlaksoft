"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Minus, Plus, ShieldAlert, Users2 } from "lucide-react";
import { startSeatPurchase } from "@/app/actions/billing";
import { BILLING_VAT_RATE, type PlanDef, type SeatTier } from "@/lib/billing/plans";
import { evaluateSeatChange } from "@/lib/billing/seat-purchase-core";
import { WalletCreditToggle, type WalletCheckoutInfo } from "@/components/app/wallet-credit-toggle";

const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tl = (n: number) => `${fmt.format(n)} ₺`;
const tl2 = (n: number) => `${fmt2.format(n)} ₺`;

/** Slider/stepper üst sınırı: DB kontrolü (ek <= 500) ile uyumlu. */
const UI_EXTRA_CAP = 500;

export type SeatPanelProps = {
  plans: PlanDef[];
  planId: string;
  cycle: "monthly" | "yearly";
  usedSeats: number;
  includedSeats: number;
  extraSeats: number;
  lockedBaseMonthlyTry: number | null;
  lockedTiers: SeatTier[] | null;
  periodStartMs: number | null;
  periodEndMs: number | null;
  /** Sunucudan gelen "şimdi" (bileşende Date.now yasak). */
  nowMs: number;
  /** owner/gm. */
  canBuy: boolean;
  /** Satış hazırlığı tamam (seat_purchase_ready) ve ödeme altyapısı bağlı. */
  purchaseReady: boolean;
  /** Abonelik aktif (deneme/gecikmiş değil). */
  subscriptionActive: boolean;
  /** Eşik (%); admin ayarı. */
  warnPercent: number;
  /** TL hesap kredisi cüzdanı (yoksa/etkin değilse null: onay kutusu gösterilmez). */
  wallet?: WalletCheckoutInfo | null;
};

export function SeatPanel(props: SeatPanelProps) {
  const {
    plans, planId, cycle, usedSeats, includedSeats, extraSeats, lockedBaseMonthlyTry, lockedTiers,
    periodStartMs, periodEndMs, nowMs, canBuy, purchaseReady, subscriptionActive, warnPercent,
  } = props;
  const currentTotal = includedSeats + extraSeats;
  const [target, setTarget] = useState(currentTotal);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useCredit, setUseCredit] = useState(false);

  const locks = useMemo(
    () => ({ baseMonthlyTry: lockedBaseMonthlyTry, tiers: lockedTiers }),
    [lockedBaseMonthlyTry, lockedTiers],
  );
  const ev = useMemo(
    () =>
      evaluateSeatChange({
        plans, planId, cycle, usedSeats, currentTotalSeats: currentTotal, targetTotalSeats: target,
        locks, periodStartMs, periodEndMs, nowMs,
      }),
    [plans, planId, cycle, usedSeats, currentTotal, target, locks, periodStartMs, periodEndMs, nowMs],
  );
  const planName = plans.find((p) => p.id === planId)?.name ?? planId;

  const sliderMin = Math.max(includedSeats, usedSeats);
  const sliderMax = Math.max(
    sliderMin,
    Math.min(Number.isFinite(ev.maxTotalSeats) ? ev.maxTotalSeats : includedSeats + UI_EXTRA_CAP, includedSeats + UI_EXTRA_CAP),
  );
  const notSold = ev.status === "not_sold" || sliderMax <= includedSeats;

  const q = ev.toQuote;
  const reco = q.recommendation;
  const periodWord = cycle === "yearly" ? "yıl" : "ay";
  const usedPct = currentTotal > 0 ? Math.round((usedSeats / currentTotal) * 100) : 0;
  const barTone = usedPct >= 100 ? "bg-danger-500" : usedPct >= warnPercent ? "bg-amber-400" : "bg-mint-500";

  function setClamped(n: number) {
    setConfirming(false);
    setError(null);
    setTarget(Math.min(sliderMax, Math.max(sliderMin, Math.round(n))));
  }

  async function buy() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("target_seats", String(target));
    fd.set("confirm_try", String(ev.immediateChargeTry));
    if (useCredit && props.wallet) fd.set("use_credit", "1");
    const result = await startSeatPurchase(fd);
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
      return;
    }
    setPending(false);
    setConfirming(false);
    setError(result.error ?? "Ödeme başlatılamadı.");
  }

  const canConfirm = ev.status === "increase" && canBuy && purchaseReady && subscriptionActive;
  const blockReason = !canBuy
    ? "Kullanıcı sayısını yalnızca ofis sahibi veya genel müdür değiştirebilir."
    : !purchaseReady
      ? "Satın alma henüz etkin değil: yönetici hazırlığı tamamlanıyor. Fiyatı şimdiden inceleyebilirsiniz."
      : !subscriptionActive
        ? "Koltuk eklemek için ücretli bir paketin aktif olması gerekir (deneme veya gecikmiş abonelikte kapalı)."
        : null;

  return (
    <section id="koltuk" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Users2 className="h-4 w-4" /> Kullanıcı ekle / çıkar</p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Ekibinize göre koltuk sayısını ayarlayın</h2>
        </div>
        <Link
          href="/app/ekip"
          className="focus-ring rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 hover:bg-brand-600/15"
        >
          {usedSeats} aktif kullanıcı · ekibi gör
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Link href="/app/ekip" className="focus-ring rounded-[var(--radius-card)] border border-line bg-canvas/50 p-3 transition hover:border-brand-300">
          <p className="text-xs font-semibold text-text-muted">Kullanılan</p>
          <p className="numeric font-display text-xl font-extrabold text-ink-950">{usedSeats} <span className="text-sm font-semibold text-text-faint">/ {currentTotal}</span></p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/60">
            <div className={`h-full rounded-full ${barTone}`} style={{ width: `${Math.max(4, Math.min(100, usedPct))}%` }} />
          </div>
        </Link>
        <div className="rounded-[var(--radius-card)] border border-line bg-canvas/50 p-3">
          <p className="text-xs font-semibold text-text-muted">Pakete dahil</p>
          <p className="numeric font-display text-xl font-extrabold text-ink-950">{includedSeats}</p>
          <p className="mt-1 text-xs text-text-faint">{planName} paketinin taban fiyatına dahil</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-canvas/50 p-3">
          <p className="text-xs font-semibold text-text-muted">Satın alınmış ek</p>
          <p className="numeric font-display text-xl font-extrabold text-ink-950">{extraSeats}</p>
          <p className="mt-1 text-xs text-text-faint">
            {lockedBaseMonthlyTry || lockedTiers ? "Kilitli fiyatınız uygulanır" : "Güncel liste fiyatı uygulanır"}
          </p>
        </div>
      </div>

      {notSold ? (
        <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-3 text-sm text-text-muted">
          {planName} paketinde ek kullanıcı satılmıyor. Daha fazla kullanıcı için aşağıdan üst pakete geçebilirsiniz.
        </p>
      ) : (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setClamped(target - 1)}
              disabled={target <= sliderMin || pending}
              aria-label="Bir kullanıcı azalt"
              className="focus-ring grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-ink-950 transition hover:border-brand-400 disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <div className="min-w-24 text-center">
              <p className="numeric font-display text-3xl font-extrabold text-ink-950">{target}</p>
              <p className="text-xs text-text-muted">toplam kullanıcı</p>
            </div>
            <button
              type="button"
              onClick={() => setClamped(target + 1)}
              disabled={target >= sliderMax || pending}
              aria-label="Bir kullanıcı artır"
              className="focus-ring grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-ink-950 transition hover:border-brand-400 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
            <input
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={1}
              value={target}
              onChange={(e) => setClamped(Number(e.target.value))}
              aria-label="Hedef toplam kullanıcı sayısı"
              className="min-w-40 flex-1 accent-brand-600"
            />
          </div>
          <p className="mt-2 text-xs text-text-muted">
            En az <span className="numeric font-semibold">{sliderMin}</span> (aktif kullanıcı sayınızın altına inilemez
            {sliderMin === includedSeats ? " ve pakete dahil kullanıcılar azaltılamaz" : ""}), en çok{" "}
            <span className="numeric font-semibold">{Number.isFinite(ev.maxTotalSeats) ? ev.maxTotalSeats : `${sliderMax}+`}</span>.
          </p>
        </div>
      )}

      {!notSold ? (
        <div className="mt-5 rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-muted">Fiyat dökümü ({target} kullanıcı, {cycle === "yearly" ? "yıllık" : "aylık"})</p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-text-muted">
                {planName} taban fiyat ({includedSeats} kullanıcı dahil){lockedBaseMonthlyTry ? " · kilitli fiyat" : ""}
              </dt>
              <dd className="numeric font-semibold text-ink-950">{tl(q.baseMonthlyTry)}</dd>
            </div>
            {q.breakdown.length === 0 ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text-muted">Ek kullanıcı yok</dt>
                <dd className="numeric font-semibold text-ink-950">{tl(0)}</dd>
              </div>
            ) : (
              q.breakdown.map((r) => (
                <div key={r.fromSeat} className="flex items-baseline justify-between gap-3">
                  <dt className="text-text-muted">
                    {r.fromSeat === r.toSeat ? `${r.fromSeat}. ek kullanıcı` : `${r.fromSeat}.–${r.toSeat}. ek kullanıcı`}{" "}
                    <span className="numeric">({r.count} x {tl(r.unitTry)})</span>
                  </dt>
                  <dd className="numeric font-semibold text-ink-950">{tl(r.subtotalTry)}</dd>
                </div>
              ))
            )}
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
              <dt className="font-semibold text-ink-950">Aylık toplam</dt>
              <dd className="numeric font-display text-lg font-extrabold text-ink-950">{tl(q.totalMonthlyTry)}</dd>
            </div>
            {cycle === "yearly" ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text-muted">Yıllık toplam (aylığın {plans.find((p) => p.id === planId)?.yearlyPaidMonths ?? 10} katı)</dt>
                <dd className="numeric font-semibold text-ink-950">{tl(q.totalForCycleTry)}</dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-text-muted">Kullanıcı başı etkin fiyat (toplam / {target})</dt>
              <dd className="numeric font-semibold text-ink-950">{tl2(q.perSeatEffectiveTry)} / ay</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-text-faint">Tutarlar KDV hariçtir. Ek kullanıcı fiyatı kademelidir: her kademedeki kullanıcı o kademenin birim fiyatıyla hesaplanır.</p>
        </div>
      ) : null}

      {reco ? (
        <Link
          href="/app/abonelik#paketler"
          className="focus-ring mt-4 block rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/10 px-4 py-3 text-sm font-medium text-mint-700 transition hover:opacity-90"
        >
          <span className="inline-flex flex-wrap items-center gap-2">
            <ArrowUpRight className="h-4 w-4" />
            {reco.reason}
            {reco.savingsMonthlyTry > 0 ? <span className="font-bold">Paketleri incele</span> : <span className="font-bold">Üst pakete geç</span>}
          </span>
        </Link>
      ) : null}

      {/* Değişikliğin sonucu: oransal tutar / dönem sonu / engel açıklaması */}
      {ev.status === "increase" ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-brand-300/60 bg-brand-600/[0.04] p-4 text-sm">
          <p className="font-semibold text-ink-950">
            Şimdi ödenecek (oransal): <span className="numeric font-display text-lg font-extrabold">{tl2(ev.immediateChargeTry)}</span>{" "}
            <span className="text-xs font-semibold text-text-muted">KDV hariç</span>
          </p>
          <p className="mt-1 text-xs text-text-muted">{ev.message}</p>
          <p className="mt-1 text-xs text-text-faint">
            Hesap: dönem tutarı farkı {tl2(q.totalForCycleTry - ev.fromQuote.totalForCycleTry)} (yeni {tl(q.totalForCycleTry)} − mevcut {tl(ev.fromQuote.totalForCycleTry)}) x dönemin kalan oranı.
            Sonraki yenilemede {cycle === "yearly" ? "yıllık" : "aylık"} yeni toplam ({tl(q.totalForCycleTry)}) tahsil edilir.
          </p>
        </div>
      ) : ev.status === "decrease" ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-700">
          <p className="font-semibold">Azaltma: dönem sonunda geçerli, iade yok</p>
          <p className="mt-1 text-xs">{ev.message}</p>
          <p className="mt-1 text-xs">
            Yenilemeden itibaren aylık toplam {tl(q.totalMonthlyTry)} olur. Bu ekrandan azaltma talebi henüz alınmıyor; ekip destek ile iletişime geçin.
          </p>
        </div>
      ) : ev.status === "no_change" ? null : (
        <div className="mt-4 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-700" role="status">
          <span className="inline-flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {ev.message}
            </span>
          </span>
        </div>
      )}

      {ev.status === "increase" ? (
        <div className="mt-4">
          {!confirming ? (
            <button
              type="button"
              disabled={!canConfirm || pending}
              onClick={() => setConfirming(true)}
              className="btn-shine inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {ev.toQuote.extraSeats - extraSeats} kullanıcı ekle
            </button>
          ) : (
            <div className="rounded-[var(--radius-card)] border border-brand-400 bg-surface p-4">
              <p className="text-sm font-semibold text-ink-950">Onaylıyor musunuz?</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-text-muted">
                <li>Koltuk sayınız {currentTotal} → {target} olur (+{target - currentTotal}).</li>
                <li>Şimdi {tl2(ev.immediateChargeTry)} + KDV ödeme sayfasında tahsil edilir.</li>
                <li>Yenilemeden itibaren aylık toplam {tl(q.totalMonthlyTry)} ({tl(q.totalForCycleTry)} / {periodWord}).</li>
                <li>Koltuk azaltma dönem sonunda geçerli olur; iade yapılmaz.</li>
              </ul>
              <WalletCreditToggle
                wallet={props.wallet}
                checked={useCredit}
                onChange={setUseCredit}
                totalTry={Math.round(ev.immediateChargeTry * (1 + BILLING_VAT_RATE) * 100) / 100}
                disabled={pending}
                idPrefix="seat"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={buy}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {pending ? "Yönlendiriliyor…" : "Onayla ve öde"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                  className="rounded-[var(--radius-control)] border border-line px-4 py-2 text-sm font-semibold text-ink-950 transition hover:border-brand-400 disabled:opacity-60"
                >
                  Vazgeç
                </button>
              </div>
            </div>
          )}
          {blockReason ? <p className="mt-2 text-xs text-text-muted">{blockReason}</p> : null}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-danger-500" role="alert">{error}</p> : null}
    </section>
  );
}
