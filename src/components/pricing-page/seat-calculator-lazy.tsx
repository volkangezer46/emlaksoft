"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { BillingCycle, PlanDef } from "@/lib/billing/plans";
import type { SeatCalcOffers } from "@/lib/billing/seat-calculator-model";

/** Yüklenene kadar hesaplayıcıyla AYNI yükseklikte iskelet (CLS = 0). */
function Skeleton() {
  return (
    <div
      aria-busy="true"
      className="min-h-[58rem] rounded-[var(--radius-panel)] border border-line bg-surface p-5 sm:p-7 lg:min-h-[34rem]"
    >
      <h3 className="font-display text-xl font-bold text-ink-950">Kaç kişilik ekibiniz var?</h3>
      <p className="mt-1 text-sm text-text-muted">Kullanıcı sayısına göre paket ve toplam tutar hesaplayıcısı yükleniyor.</p>
    </div>
  );
}

const SeatCalculator = dynamic(() => import("./seat-calculator"), { ssr: false, loading: Skeleton });

/**
 * Hesaplayıcı JS'i yalnız bölüm görünür alana yaklaşınca (400px önce) indirilir; ilk boyama ve
 * hidrasyon yükünü artırmaz. IntersectionObserver yoksa hemen yüklenir.
 */
export function SeatCalculatorLazy(props: {
  plans: readonly PlanDef[];
  offers?: SeatCalcOffers;
  trialDays?: number;
  initialSeats?: number;
  initialCycle?: BillingCycle;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setShow(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <div ref={ref}>{show ? <SeatCalculator {...props} /> : <Skeleton />}</div>;
}
