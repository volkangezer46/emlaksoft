"use client";

import { useMemo, useState } from "react";
import type { PlanDef, SeatRounding, SeatTier } from "@/lib/billing/plans";
import { suggestSeatTiers, validateSeatCatalog } from "@/lib/billing/seat-pricing";

/** Düzenleyicide bir kademe satırı: başlangıç türetilir (boşluk/çakışma kurulamaz), yalnız bitiş ve fiyat girilir. */
export type TierRow = { to: string; price: string };

export function tiersToRows(tiers: readonly SeatTier[] | null | undefined): TierRow[] {
  return (tiers ?? []).map((t) => ({ to: t.toSeat === null ? "" : String(t.toSeat), price: String(t.monthlyTry) }));
}

const INT = /^\d+$/;

/** Satırın başlangıç (ek kullanıcı sırası) değeri. */
export function rowFrom(rows: readonly TierRow[], index: number): number {
  let from = 1;
  for (let k = 0; k < index; k++) {
    const n = Number(rows[k]!.to);
    from = (Number.isFinite(n) && n > 0 ? n : from) + 1;
  }
  return from;
}

export function rowsToTiers(rows: readonly TierRow[]): { tiers: SeatTier[]; errors: string[] } {
  const tiers: SeatTier[] = [];
  const errors: string[] = [];
  let from = 1;
  rows.forEach((r, i) => {
    const n = i + 1;
    const last = i === rows.length - 1;
    const price = r.price.trim();
    const to = r.to.trim();
    if (!INT.test(price) || Number(price) < 1) errors.push(`Kademe ${n}: aylık fiyat pozitif tam sayı olmalı.`);
    if (!to && !last) errors.push(`Kademe ${n}: bitiş boş bırakılamaz (yalnız son kademe sınırsız olabilir).`);
    if (to && !INT.test(to)) errors.push(`Kademe ${n}: bitiş tam sayı olmalı.`);
    const toNum = to && INT.test(to) ? Number(to) : null;
    tiers.push({ fromSeat: from, toSeat: toNum, monthlyTry: INT.test(price) ? Number(price) : 0 });
    from = (toNum ?? from) + 1;
  });
  return { tiers, errors };
}

/** Plan düzenleme taslağı: kademeler, yuvarlama, azami kullanıcı, fiyatlar + canlı doğrulama (validateSeatCatalog). */
export function useSeatDraft(plan: PlanDef, plans: PlanDef[]) {
  const [rows, setRows] = useState<TierRow[]>(() => tiersToRows(plan.extraSeatTiers));
  const [rounding, setRounding] = useState<SeatRounding>(plan.seatRounding ?? "none");
  const [maxSeats, setMaxSeats] = useState(plan.maxSeats ? String(plan.maxSeats) : "");
  const [price, setPrice] = useState(String(plan.monthlyTry));
  const [extraPrice, setExtraPrice] = useState(plan.extraSeatMonthlyTry ? String(plan.extraSeatMonthlyTry) : "");

  const derived = useMemo(() => {
    const parsed = rowsToTiers(rows);
    const monthly = INT.test(price.trim()) && Number(price.trim()) > 0 ? Number(price.trim()) : plan.monthlyTry;
    const extra = INT.test(extraPrice.trim()) && Number(extraPrice.trim()) > 0 ? Number(extraPrice.trim()) : null;
    const max = INT.test(maxSeats.trim()) && Number(maxSeats.trim()) > 0 ? Number(maxSeats.trim()) : null;
    const edited: PlanDef = {
      ...plan,
      monthlyTry: monthly,
      extraSeatMonthlyTry: extra,
      extraSeatTiers: rows.length > 0 && parsed.errors.length === 0 ? parsed.tiers : null,
      maxSeats: max,
      seatRounding: rounding === "none" ? null : rounding,
    };
    const replaced = plans.map((p) => (p.id === plan.id ? edited : p));
    const report =
      parsed.errors.length > 0 ? { errors: parsed.errors, warnings: [] as string[] } : validateSeatCatalog(replaced);
    return { edited, replaced, report, parsed };
  }, [rows, rounding, maxSeats, price, extraPrice, plan, plans]);

  function applySuggested() {
    const mode: SeatRounding = rounding === "none" ? "x9" : rounding;
    if (rounding === "none") setRounding("x9");
    setRows(tiersToRows(suggestSeatTiers({ ...derived.edited, seatRounding: mode })));
  }

  return {
    rows,
    setRows,
    rounding,
    setRounding,
    maxSeats,
    setMaxSeats,
    price,
    setPrice,
    extraPrice,
    setExtraPrice,
    applySuggested,
    ...derived,
    tiersJson: JSON.stringify(rows.length > 0 && derived.parsed.errors.length === 0 ? derived.parsed.tiers : []),
  };
}
