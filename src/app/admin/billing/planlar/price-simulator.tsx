"use client";

import { Button } from "@/components/ui/button";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applySimulatedSeatPricing } from "@/app/actions/platform-billing-plans";
import { simulatePriceChange, type NewSalesAssumption, type SeatSubscriberRow } from "@/lib/billing/seat-analytics";
import type { PlanDef } from "@/lib/billing/plans";
import { opFieldClass } from "../inline-op";
import { useSeatDraft } from "./seat-draft";
import { SeatTierEditor } from "./seat-tier-editor";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

const lbl = "block text-xs font-semibold text-text-muted";
const tl = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} ₺`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${tl(Math.abs(n))}`;

export type SimSubscriber = Pick<SeatSubscriberRow, "plan" | "status" | "cycle" | "amountTry" | "extraSeats" | "locked">;

type SaleRow = { planId: string; seats: string; count: string };

/** Fiyat simülatörü: kaydetmeden önizler (deterministik hesap + açık varsayım alanları), ardından satır içi onayla uygular. */
export function PriceSimulator({
  plans,
  subscribers,
  canWrite,
}: {
  plans: PlanDef[];
  subscribers: SimSubscriber[];
  canWrite: boolean;
}) {
  const sellable = plans;
  const [planId, setPlanId] = useState<string>(sellable[0]?.id ?? plans[0]!.id);
  const plan = plans.find((p) => p.id === planId) ?? plans[0]!;
  return (
    <div className="space-y-4">
      <label className={`${lbl} max-w-xs`}>
        Simüle edilecek paket
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={`mt-1 w-full ${opFieldClass}`}>
          {sellable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <SimulatorBody key={plan.id} plan={plan} plans={plans} subscribers={subscribers} canWrite={canWrite} />
    </div>
  );
}

function SimulatorBody({
  plan,
  plans,
  subscribers,
  canWrite,
}: {
  plan: PlanDef;
  plans: PlanDef[];
  subscribers: SimSubscriber[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const draft = useSeatDraft(plan, plans);
  const [sales, setSales] = useState<SaleRow[]>([{ planId: plan.id, seats: String(plan.limits.seats), count: "0" }]);
  const [repriceExisting, setRepriceExisting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const newSales = useMemo<NewSalesAssumption[]>(
    () =>
      sales
        .map((s) => ({ planId: s.planId, totalSeats: Number(s.seats), count: Number(s.count), cycle: "monthly" as const }))
        .filter((s) => Number.isInteger(s.totalSeats) && s.totalSeats > 0 && Number.isInteger(s.count) && s.count > 0),
    [sales],
  );

  const result = useMemo(
    () =>
      simulatePriceChange({
        currentPlans: plans,
        proposedPlans: draft.replaced,
        subscribers,
        newSales,
        repriceExistingAtRenewal: repriceExisting,
      }),
    [plans, draft.replaced, subscribers, newSales, repriceExisting],
  );

  const hasErrors = draft.report.errors.length > 0;
  const changed =
    draft.edited.monthlyTry !== plan.monthlyTry ||
    JSON.stringify(draft.edited.extraSeatTiers ?? null) !== JSON.stringify(plan.extraSeatTiers ?? null) ||
    (draft.edited.maxSeats ?? null) !== (plan.maxSeats ?? null) ||
    (draft.edited.seatRounding ?? null) !== (plan.seatRounding ?? null);

  function updateSale(i: number, patch: Partial<SaleRow>) {
    setSales(sales.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function apply() {
    const fd = new FormData();
    fd.set("plan_id", plan.id);
    fd.set("monthly_try", draft.price.trim());
    fd.set("seat_tiers_json", draft.tiersJson);
    fd.set("max_seats", draft.maxSeats.trim());
    fd.set("seat_rounding", draft.rounding);
    start(async () => {
      const r = await applySimulatedSeatPricing(fd);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.notice ?? "Uygulandı." });
      setConfirm(false);
      if (!r.error) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={lbl}>
          Taban fiyat (aylık, ₺)
          <input value={draft.price} onChange={(e) => draft.setPrice(e.target.value)} inputMode="numeric" className={`mt-1 w-full ${opFieldClass}`} />
          <span className="mt-1 block font-normal text-text-faint">Şu an: {tl(plan.monthlyTry)}</span>
        </label>
        <label className={lbl}>
          Ek kullanıcı (tek fiyat, kademe yoksa)
          <input value={draft.extraPrice} onChange={(e) => draft.setExtraPrice(e.target.value)} inputMode="numeric" placeholder="yok" className={`mt-1 w-full ${opFieldClass}`} />
        </label>
      </div>

      <SeatTierEditor plan={plan} draft={draft} />

      <fieldset className="space-y-2 rounded-[var(--radius-card)] border border-line p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-text-faint">Varsayımlar (siz girersiniz; tahmin üretilmez)</legend>
        <label className="flex items-center gap-2 text-xs font-semibold text-text-muted">
          <input type="checkbox" checked={repriceExisting} onChange={(e) => setRepriceExisting(e.target.checked)} />
          Kilitsiz mevcut aboneler yenilemede yeni liste fiyatına geçsin (varsayılan politika: kayıtlı tutar değişmez)
        </label>
        <p className="text-xs text-text-muted">Yeni satış varsayımı: seçtiğiniz paket ve kullanıcı sayısıyla kaç yeni abonelik satılır?</p>
        <ul className="space-y-2">
          {sales.map((s, i) => (
            <li key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <label className={lbl}>
                Paket
                <select value={s.planId} onChange={(e) => updateSale(i, { planId: e.target.value })} className={`mt-1 w-full ${opFieldClass}`}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className={lbl}>
                Toplam kullanıcı
                <input value={s.seats} onChange={(e) => updateSale(i, { seats: e.target.value })} inputMode="numeric" className={`mt-1 w-full ${opFieldClass}`} />
              </label>
              <label className={lbl}>
                Yeni abonelik adedi
                <input value={s.count} onChange={(e) => updateSale(i, { count: e.target.value })} inputMode="numeric" className={`mt-1 w-full ${opFieldClass}`} />
              </label>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setSales(sales.filter((_, idx) => idx !== i))}
                aria-label={`Satış varsayımı ${i + 1} sil`}
              >
                Sil
              </Button>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => setSales([...sales, { planId: plan.id, seats: String(plan.limits.seats), count: "0" }])}
        >
          Varsayım ekle
        </Button>
      </fieldset>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
        <Table className="w-full text-left text-sm">
          <caption className="sr-only">Fiyat simülasyonu sonucu</caption>
          <THead className="bg-canvas text-xs text-text-faint">
            <TR>
              <TH className="px-3 py-2 font-semibold">Gösterge</TH>
              <TH className="px-3 py-2 font-semibold">Şimdi</TH>
              <TH className="px-3 py-2 font-semibold">Yeni fiyatla</TH>
              <TH className="px-3 py-2 font-semibold">Fark</TH>
            </TR>
          </THead>
          <TBody className="text-ink-950">
            <TR className="border-t border-line">
              <TD className="px-3 py-2">MRR (aylık)</TD>
              <TD className="px-3 py-2 tabular-nums">{tl(result.before.mrrTry)}</TD>
              <TD className="px-3 py-2 tabular-nums">{tl(result.after.mrrTry)}</TD>
              <TD className="px-3 py-2 font-semibold tabular-nums">{signed(result.deltaMrrTry)}</TD>
            </TR>
            <TR className="border-t border-line">
              <TD className="px-3 py-2">ARPA</TD>
              <TD className="px-3 py-2 tabular-nums">{tl(result.before.arpaTry)}</TD>
              <TD className="px-3 py-2 tabular-nums">{tl(result.after.arpaTry)}</TD>
              <TD className="px-3 py-2 font-semibold tabular-nums">{signed(result.deltaArpaTry)}</TD>
            </TR>
            <TR className="border-t border-line">
              <TD className="px-3 py-2">Yeni satıştan MRR</TD>
              <TD className="px-3 py-2 tabular-nums">{tl(result.before.newSalesMrrTry)}</TD>
              <TD className="px-3 py-2 tabular-nums">{tl(result.after.newSalesMrrTry)}</TD>
              <TD className="px-3 py-2 font-semibold tabular-nums">{signed(result.after.newSalesMrrTry - result.before.newSalesMrrTry)}</TD>
            </TR>
            <TR className="border-t border-line">
              <TD className="px-3 py-2">Abone sayısı (varsayım dahil)</TD>
              <TD className="px-3 py-2 tabular-nums">{result.before.subscribers}</TD>
              <TD className="px-3 py-2 tabular-nums">{result.after.subscribers}</TD>
              <TD className="px-3 py-2 tabular-nums">-</TD>
            </TR>
          </TBody>
        </Table>
      </div>
      <p className="text-xs text-text-muted">
        Fiyatı değişmeyen mevcut abone: <strong className="text-ink-950">{result.unchangedSubscribers}</strong>
        {result.lockedSubscribers > 0 ? ` (${result.lockedSubscribers} kilitli fiyat)` : ""} · yeniden fiyatlanan:{" "}
        <strong className="text-ink-950">{result.repricedSubscribers}</strong>. Bu sonuç yalnız girdiğiniz değerlerin hesabıdır; talep tepkisi tahmin edilmez.
      </p>

      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          {!confirm ? (
            <Button variant="navy" size="sm" type="button" disabled={hasErrors || !changed} onClick={() => setConfirm(true)}>
              Bu fiyatlamayı uygula
            </Button>
          ) : (
            <>
              <span className="text-xs text-text-muted">
                {plan.name} paketinin fiyatı ve kademeleri güncellenir; mevcut abonelerin kayıtlı/kilitli tutarı değişmez.
              </span>
              <Button variant="navy" size="sm" type="button" disabled={pending} onClick={apply}>
                {pending ? "Uygulanıyor…" : "Onayla"}
              </Button>
              <button type="button" disabled={pending} onClick={() => setConfirm(false)} className="focus-ring min-h-9 px-3 text-xs font-semibold text-text-muted">
                Vazgeç
              </button>
            </>
          )}
          {!changed && !confirm ? <span className="text-xs text-text-faint">Önce bir değer değiştirin.</span> : null}
          {msg ? (
            <span role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
              {msg.text}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-text-muted">Uygulama yalnız süper admin içindir; önizleme herkese açıktır.</p>
      )}
    </div>
  );
}
