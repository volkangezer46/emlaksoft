"use client";

import { useState } from "react";
import { ArrowRight, Calculator, Info, TrendingUp } from "lucide-react";
import { computeRentIncrease, TUFE_12M_AVG, tufeRateForMonth } from "@/lib/tufe";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function RentCalculator({ months, latestMonth }: { months: string[]; latestMonth: string }) {
  const [rent, setRent] = useState<string>("");
  const [month, setMonth] = useState<string>(latestMonth);
  const [manualRate, setManualRate] = useState<string>("");
  const [useManual, setUseManual] = useState(false);

  const tufe = tufeRateForMonth(month);
  const legalCap = tufe.rate;
  const appliedRate = useManual && manualRate ? Number(manualRate) : legalCap;

  // Not: burada useMemo yok — computeRentIncrease dört aritmetik işlem yapıyor,
  // manuel memoization hem gereksiz hem de React Compiler'ın kendi
  // memoization'ını uygulamasını engelliyordu (preserve-manual-memoization).
  const rentNum = Number(rent);
  const result =
    rentNum > 0
      ? computeRentIncrease(rentNum, appliedRate, useManual ? legalCap : undefined)
      : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      {/* Girdi kartı */}
      <div className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
          <Calculator className="h-4 w-4 text-brand-600" /> Hesaplama girdileri
        </h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-text-muted" htmlFor="rent">Mevcut aylık kira (₺)</label>
            <input
              id="rent"
              type="number"
              inputMode="numeric"
              min="0"
              step="500"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
              placeholder="Örn. 25000"
              className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-text-muted" htmlFor="month">Yenileme ayı</label>
            <select
              id="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            >
              {months.map((m) => (
                <option key={m} value={m}>{monthLabel(m)} — 12 aylık ort. TÜFE %{TUFE_12M_AVG[m]?.toFixed(2)}</option>
              ))}
            </select>
            {!tufe.exact ? (
              <p className="mt-1 text-xs text-amber-600">Seçilen ay için veri yok; en güncel ay ({monthLabel(tufe.sourceMonth)}) kullanıldı.</p>
            ) : null}
          </div>

          <label className="flex items-center gap-2 rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm">
            <input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            <span>Kendi oranımı gir (yasal tavan yine uygulanır)</span>
          </label>

          {useManual ? (
            <div>
              <label className="mb-1.5 block text-sm text-text-muted" htmlFor="rate">İstenen artış oranı (%)</label>
              <input
                id="rate"
                type="number"
                min="0"
                step="0.5"
                value={manualRate}
                onChange={(e) => setManualRate(e.target.value)}
                placeholder={`Örn. ${legalCap.toFixed(0)}`}
                className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              />
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-[12px] border border-brand-600/15 bg-brand-600/5 px-3 py-2.5 text-xs text-text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
          <span>
            Yasal tavan: bir önceki kira yılının <strong>12 aylık ortalama TÜFE</strong> oranı (TBK m.344).
            Rakamlar TÜİK referansıdır; resmi oran için TÜİK esas alınmalıdır.
          </span>
        </div>
      </div>

      {/* Sonuç kartı */}
      <div className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
          <TrendingUp className="h-4 w-4 text-mint-600" /> Sonuç
        </h2>

        {result ? (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-center gap-3 rounded-[14px] bg-[image:var(--grad-ink)] p-5 text-white theme-dark">
              <div className="text-center">
                <p className="text-[11px] text-white/60">Mevcut</p>
                <p className="font-display text-xl font-extrabold">{money(result.currentRent)}</p>
              </div>
              <ArrowRight className="h-5 w-5 text-cyan-400" />
              <div className="text-center">
                <p className="text-[11px] text-white/60">Yeni kira</p>
                <p className="font-display text-2xl font-extrabold text-mint-300">{money(result.newRent)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-[12px] border border-line bg-canvas p-3">
                <p className="font-display text-lg font-extrabold text-ink-950">%{result.cappedRatePct.toFixed(2)}</p>
                <p className="text-[11px] text-text-muted">Uygulanan oran</p>
              </div>
              <div className="rounded-[12px] border border-line bg-canvas p-3">
                <p className="font-display text-lg font-extrabold text-brand-600">{money(result.monthlyDiff)}</p>
                <p className="text-[11px] text-text-muted">Aylık fark</p>
              </div>
              <div className="rounded-[12px] border border-line bg-canvas p-3">
                <p className="font-display text-lg font-extrabold text-mint-600">{money(result.annualDiff)}</p>
                <p className="text-[11px] text-text-muted">Yıllık fark</p>
              </div>
            </div>

            {result.capApplied ? (
              <p className="rounded-[10px] border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                Girdiğiniz oran (%{result.ratePct.toFixed(2)}) yasal tavanı aşıyor; hesaplama %{result.cappedRatePct.toFixed(2)} ile sınırlandı.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 grid place-items-center rounded-[14px] border border-dashed border-line-strong bg-canvas px-6 py-12 text-center">
            <Calculator className="h-8 w-8 text-text-faint" />
            <p className="mt-3 text-sm text-text-muted">Kira tutarını girin, yeni kira anında hesaplansın.</p>
          </div>
        )}
      </div>
    </div>
  );
}
