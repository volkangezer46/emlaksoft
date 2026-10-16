"use client";

import { useEffect, useState } from "react";
import { History, TrendingDown, TrendingUp } from "lucide-react";
import { listUnitPriceHistory, type UnitPriceHistoryRow } from "@/app/actions/project-sales";

function money(n: number | null) {
  return n == null ? "—" : "₺" + new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n);
}

/** Veritabanı tetiğinin yazdığı sabit gerekçeler (ASCII) → ekran metni. */
const DB_REASONS: Record<string, string> = {
  "Toplu fiyat guncelleme": "Toplu fiyat güncelleme",
  "Toplu guncelleme geri alindi": "Toplu güncelleme geri alındı",
  "Fiyat listesi aktarimi": "Fiyat listesi aktarımı",
};

const DATE = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });

/** PF-05 — Daire fiyat geçmişi ("geçen ay şu fiyattı"): tekil düzenleme, toplu zam ve fiyat listesi aktarımı. */
export function UnitPriceHistory({ unitId }: { unitId: string }) {
  const [state, setState] = useState<{ loading: boolean; available: boolean; rows: UnitPriceHistoryRow[] }>({
    loading: true,
    available: true,
    rows: [],
  });

  useEffect(() => {
    let alive = true;
    listUnitPriceHistory(unitId).then((res) => {
      if (alive) setState({ loading: false, available: res.available, rows: res.rows });
    });
    return () => {
      alive = false;
    };
  }, [unitId]);

  if (!state.available) return null;
  return (
    <div className="rounded-[var(--radius-card)] border border-line p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-text-faint">
        <History className="h-3.5 w-3.5" /> Fiyat geçmişi
      </p>
      {state.loading ? (
        <div className="mt-2 h-8 animate-pulse rounded bg-line" role="status" aria-label="Fiyat geçmişi yükleniyor" />
      ) : state.rows.length === 0 ? (
        <p className="mt-1.5 text-xs text-text-muted">Fiyat henüz değişmedi.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {state.rows.map((r) => {
            const up = (r.new_price ?? 0) >= (r.old_price ?? 0);
            const pct = r.old_price && r.new_price ? ((r.new_price - r.old_price) / r.old_price) * 100 : null;
            return (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                <span className="numeric font-semibold text-ink-950">
                  {money(r.old_price)} → {money(r.new_price)}
                  {pct != null ? (
                    <span className={`ml-1.5 inline-flex items-center gap-0.5 ${up ? "text-mint-700" : "text-danger-600"}`}>
                      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      %{new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(Math.abs(pct))}
                    </span>
                  ) : null}
                </span>
                <span className="text-text-muted">
                  {DATE.format(new Date(r.created_at))}
                  {r.reason ? ` · ${DB_REASONS[r.reason] ?? r.reason}` : ""}
                  {r.actor ? ` · ${r.actor}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
