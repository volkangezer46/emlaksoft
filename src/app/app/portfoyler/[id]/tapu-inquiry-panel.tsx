"use client";

import { useState } from "react";
import { Landmark, Loader2, ShieldAlert, TrendingUp } from "lucide-react";
import { queryTapuInsight, type TapuInquiryResult } from "@/app/actions/tapu-inquiry";

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

export function TapuInquiryPanel({
  provinceName,
  districtName,
  defaultAda,
  defaultParsel,
}: {
  provinceName: string | null;
  districtName?: string | null;
  defaultAda?: string | null;
  defaultParsel?: string | null;
}) {
  const [ada, setAda] = useState(defaultAda ?? "");
  const [parsel, setParsel] = useState(defaultParsel ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TapuInquiryResult | null>(null);

  async function run() {
    if (!provinceName) return;
    setLoading(true);
    setResult(null);
    const r = await queryTapuInsight({ provinceName, districtName, ada: ada || null, parsel: parsel || null });
    setResult(r);
    setLoading(false);
  }

  return (
    <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-cyan-400/12 text-cyan-600">
          <Landmark className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-ink-950">Tapu & parsel sorgusu</h2>
          <p className="text-xs text-text-muted">TAKBİS/Tapusor ada-parsel değerleme ve yatırım analizi</p>
        </div>
      </div>

      {!provinceName ? (
        <p className="mt-4 rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-xs text-text-muted">
          Sorgu için portföyün il bilgisi gereklidir.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-[90px] flex-1">
              <label className="mb-1 block text-xs text-text-muted" htmlFor="tapu-ada">Ada</label>
              <input id="tapu-ada" value={ada} onChange={(e) => setAda(e.target.value)} placeholder="Ör. 1234"
                className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" />
            </div>
            <div className="min-w-[90px] flex-1">
              <label className="mb-1 block text-xs text-text-muted" htmlFor="tapu-parsel">Parsel</label>
              <input id="tapu-parsel" value={parsel} onChange={(e) => setParsel(e.target.value)} placeholder="Ör. 56"
                className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400" />
            </div>
            <button
              type="button"
              onClick={run}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />}
              Sorgula
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-text-faint">{provinceName}{districtName ? ` · ${districtName}` : ""}</p>

          {result && result.ok && result.configured === false ? (
            <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-amber-300/50 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Tapusor API anahtarı tanımlı değil. Yönetici <strong>/admin/sistem</strong>’den anahtarı ekleyince sorgu aktifleşir.</span>
            </div>
          ) : null}

          {result && !result.ok ? (
            <p className="mt-3 rounded-[10px] border border-danger-500/30 bg-danger-500/5 px-3 py-2 text-xs text-danger-600">{result.error}</p>
          ) : null}

          {result && result.ok && result.configured ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-[12px] border border-line bg-canvas p-3">
                <p className="text-[11px] text-text-muted">Tahmini değer</p>
                <p className="font-display text-lg font-extrabold text-ink-950">{money(result.insight.estimatedValue)}</p>
              </div>
              <div className="rounded-[12px] border border-line bg-canvas p-3">
                <p className="flex items-center gap-1 text-[11px] text-text-muted"><TrendingUp className="h-3 w-3" /> Yatırım skoru</p>
                <p className="font-display text-lg font-extrabold text-cyan-600">{result.insight.investmentScore ?? "—"}<span className="text-xs text-text-faint">/100</span></p>
              </div>
              <div className="rounded-[12px] border border-line bg-canvas p-3">
                <p className="text-[11px] text-text-muted">12 aylık fiyat değişimi</p>
                <p className="font-display text-lg font-extrabold text-mint-600">{result.insight.priceChange12m != null ? `%${result.insight.priceChange12m}` : "—"}</p>
              </div>
              <div className="rounded-[12px] border border-line bg-canvas p-3">
                <p className="text-[11px] text-text-muted">Kira geri dönüşü</p>
                <p className="font-display text-lg font-extrabold text-ink-950">{result.insight.rentYieldMonths != null ? `${result.insight.rentYieldMonths} ay` : "—"}</p>
              </div>
              {result.insight.legalFlags.length > 0 ? (
                <div className="sm:col-span-2 rounded-[12px] border border-amber-300/50 bg-amber-50 p-3">
                  <p className="text-[11px] font-semibold text-amber-700">Hukuki notlar</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
                    {result.insight.legalFlags.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
