"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  Calculator,
  Percent,
  ReceiptText,
  UserRound,
  Wallet,
} from "lucide-react";
import { calculateCommission } from "@/lib/commission";

const DONUT_C = 2 * Math.PI * 42;

function parseNumber(value: string) {
  const normalized = value.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  return Number(normalized) || 0;
}

function money(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
}

/*
 * BU BILESENDE DUZELTILEN UC SEY:
 *
 * 1. "KDV dahil" modu YOKTU. Onceki onay kutusu ("%20 KDV hesapla") yalnizca
 *    KDV'nin GOSTERILIP gosterilmeyecegini belirliyordu. Musteri "180.000 KDV
 *    dahil" dediginde danisman yanlis rakam goruyordu: dogru matrah
 *    180.000 / 1,20 = 150.000, ama arayuz dogrudan 180.000 uzerinden gidiyordu.
 *
 * 2. KDV orani (0.2) burada da SABIT yaziliydi — deals.ts ve workflow.ts ile
 *    birlikte ucuncu kopya. Hepsi lib/commission.ts'e tasindi.
 *
 * 3. "Elime ne gececek" sorusuna CEVAP VERMIYORDU: danismanin brut payini
 *    gosteriyor, stopaj ve diger kesintileri hic hesaba katmiyordu. X7'nin
 *    amaci tam olarak bu soruydu.
 *
 * Stopaj varsayilani SIFIR ve kullanici girdisi — danismanin vergi statusune
 * gore degistigi icin uygulamanin karar vermesi dogru olmaz.
 */
export function CommissionSimulator() {
  const [dealValue, setDealValue] = useState("6.750.000");
  const [rate, setRate] = useState("3");
  const [advisorShare, setAdvisorShare] = useState("60");
  const [vatIncluded, setVatIncluded] = useState(false);
  const [withholdingRate, setWithholdingRate] = useState("0");
  const [otherDeductions, setOtherDeductions] = useState("");

  const calc = useMemo(
    () =>
      calculateCommission({
        amount: parseNumber(dealValue),
        rate: parseNumber(rate),
        vatIncluded,
        advisorShare: parseNumber(advisorShare),
        withholdingRate: parseNumber(withholdingRate),
        otherDeductions: parseNumber(otherDeductions),
      }),
    [dealValue, rate, vatIncluded, advisorShare, withholdingRate, otherDeductions],
  );

  const result = {
    deal: parseNumber(dealValue),
    gross: calc.net,
    vat: calc.vat,
    advisor: calc.advisorGross,
    office: calc.officeGross,
    advisorRate: calc.used.advisorShare,
  };

  return (
    <section className="dashboard-panel overflow-hidden rounded-[20px] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Calculator className="h-4 w-4" /> Canlı hesaplama</p>
          <h2 className="mt-1 font-display text-lg font-bold text-ink-950">Komisyon simülatörü</h2>
        </div>
        {/* Onceki onay kutusu KDV'yi yalnizca GOSTERIYORDU; burada anlasmanin
            KDV dahil mi haric mi oldugu soruluyor. Ikisi arasinda %20 fark var
            ve sahada en sik karisan nokta bu. */}
        <div className="flex gap-1.5 rounded-full border border-line bg-canvas p-1">
          {[
            { v: false, l: "KDV hariç" },
            { v: true, l: "KDV dahil" },
          ].map((o) => (
            <button
              key={o.l}
              type="button"
              onClick={() => setVatIncluded(o.v)}
              aria-pressed={vatIncluded === o.v}
              className={`focus-ring press rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                vatIncluded === o.v ? "bg-ink-950 text-white" : "text-text-muted hover:text-ink-950"
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.2fr]">
        <div className="grid content-start gap-4 border-b border-line p-5 lg:border-b-0 lg:border-r">
          <label className="text-sm font-medium text-ink-950">
            İşlem bedeli
            <div className="relative mt-1.5">
              <Wallet className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-600" />
              <input value={dealValue} onChange={(event) => setDealValue(event.target.value)} inputMode="decimal" className="w-full rounded-[11px] border border-line bg-canvas py-3 pl-10 pr-12 text-lg font-bold tabular-nums text-ink-950 outline-none transition focus:border-brand-400 focus:bg-surface" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-faint">₺</span>
            </div>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-ink-950">
              Komisyon oranı
              <div className="relative mt-1.5">
                <input value={rate} onChange={(event) => setRate(event.target.value)} inputMode="decimal" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 pr-9 text-sm font-semibold outline-none focus:border-brand-400" />
                <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              </div>
            </label>
            <label className="text-sm font-medium text-ink-950">
              Danışman payı
              <div className="relative mt-1.5">
                <input value={advisorShare} onChange={(event) => setAdvisorShare(event.target.value)} inputMode="decimal" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 pr-9 text-sm font-semibold outline-none focus:border-brand-400" />
                <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              </div>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-ink-950">
              Stopaj
              <div className="relative mt-1.5">
                <input value={withholdingRate} onChange={(event) => setWithholdingRate(event.target.value)} inputMode="decimal" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 pr-9 text-sm font-semibold outline-none focus:border-brand-400" />
                <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              </div>
            </label>
            <label className="text-sm font-medium text-ink-950">
              Diğer kesinti
              <input value={otherDeductions} onChange={(event) => setOtherDeductions(event.target.value)} inputMode="decimal" placeholder="₺" className="mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold tabular-nums outline-none focus:border-brand-400" />
            </label>
          </div>
          <div className="rounded-[13px] border border-brand-300/35 bg-brand-600/5 p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">Komisyon (KDV hariç)</p>
            <p className="mt-1 font-display text-3xl font-extrabold tabular-nums text-ink-950">{money(result.gross)}</p>
            <p className="mt-1 text-xs text-text-muted">
              {money(result.deal)} bedel üzerinden %{rate}
              {vatIncluded ? " · girilen tutar KDV dahil kabul edildi" : ""}
            </p>
            <p className="hairline-t mt-2.5 flex items-center justify-between pt-2.5 text-xs">
              <span className="text-text-muted">Müşteriden tahsil edilecek</span>
              <span className="font-display text-sm font-extrabold tabular-nums text-ink-950">{money(calc.gross)}</span>
            </p>
          </div>
        </div>

        <div className="p-5">
          <div className="grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
            <div className="relative mx-auto grid h-40 w-40 place-items-center">
              {/* rotating conic glow behind the donut */}
              <div className="conic-spin pointer-events-none absolute inset-1 rounded-full opacity-40 blur-md" style={{ background: "conic-gradient(from 0deg, var(--brand-500), var(--mint-500), var(--brand-500))" }} />
              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--mint-500)" strokeWidth="9" opacity="0.9" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--brand-600)"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={`${DONUT_C * (result.advisorRate / 100)} ${DONUT_C}`}
                  style={{ transition: "stroke-dasharray .7s cubic-bezier(0.16, 1, 0.3, 1)" }}
                />
                {/* boundary marker at end of advisor arc */}
                <circle
                  cx={50 + 42 * Math.cos((result.advisorRate / 100) * 2 * Math.PI)}
                  cy={50 + 42 * Math.sin((result.advisorRate / 100) * 2 * Math.PI)}
                  r="3.2"
                  className="glow-dot"
                  fill="#fff"
                  style={{ transition: "cx .7s cubic-bezier(0.16, 1, 0.3, 1), cy .7s cubic-bezier(0.16, 1, 0.3, 1)" }}
                />
              </svg>
              <div className="relative grid h-24 w-24 place-items-center rounded-full bg-surface text-center shadow-[0_8px_24px_-10px_rgba(15,23,42,0.4)]">
                <div><p className="text-[11px] text-text-faint">Dağıtılacak</p><p className="font-display text-base font-extrabold tabular-nums text-ink-950">{money(result.gross)}</p></div>
              </div>
            </div>
            <div className="space-y-3">
              {[
                { icon: UserRound, label: `Danışman payı · %${result.advisorRate}`, value: result.advisor, color: "text-brand-600", bg: "bg-brand-600/10" },
                { icon: Building2, label: `Ofis payı · %${100 - result.advisorRate}`, value: result.office, color: "text-mint-600", bg: "bg-mint-500/10" },
                { icon: ReceiptText, label: "Hesaplanan KDV", value: result.vat, color: "text-amber-500", bg: "bg-amber-400/12" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-[12px] border border-line bg-canvas/60 p-3">
                  <span className={`grid h-9 w-9 place-items-center rounded-[10px] ${item.bg} ${item.color}`}><item.icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1"><p className="text-[11px] text-text-muted">{item.label}</p><p className="font-display text-base font-bold tabular-nums text-ink-950">{money(item.value)}</p></div>
                </div>
              ))}
            </div>
          </div>

          {/* X7'nin asil sorusu: "elime ne gececek". Onceki hali yalnizca brut
              payi gosteriyordu. */}
          <div className="mt-4 rounded-[13px] border border-mint-500/30 bg-mint-500/[0.07] p-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-mint-600">
                  Danışmanın eline geçen
                </p>
                <p className="mt-0.5 font-display text-2xl font-extrabold tabular-nums text-mint-600">
                  {money(calc.advisorNet)}
                </p>
              </div>
              {calc.withholding > 0 ? (
                <p className="text-xs text-text-muted">
                  Stopaj <span className="font-semibold tabular-nums text-danger-600">−{money(calc.withholding)}</span>
                </p>
              ) : null}
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
            Paylaşım <strong>KDV hariç</strong> tutar üzerinden yapılır — KDV devlete gider, ofis ya da
            danışmanın geliri değildir. Stopaj ve diğer kesintiler sizin girdiğiniz oranlardır;
            danışmanın vergi statüsüne göre değiştiği için varsayılanları sıfırdır. Bu araç aritmetik
            yapar, <strong>mali müşavir yerine geçmez</strong>.
          </p>
        </div>
      </div>
    </section>
  );
}
