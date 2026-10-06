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
import { CommissionCapNotice } from "@/components/app/commission-cap-notice";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { DonutRing } from "@/components/ui/viz/donut-ring";

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
export function CommissionSimulator({ defaultRate = 3, defaultAdvisorShare = 60 }: { defaultRate?: number; defaultAdvisorShare?: number } = {}) {
  const [dealValue, setDealValue] = useState("6.750.000");
  const [rate, setRate] = useState(String(defaultRate));
  const [advisorShare, setAdvisorShare] = useState(String(defaultAdvisorShare));
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
    <section className="dashboard-panel overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-accent-text"><Calculator className="h-4 w-4" /> Canlı hesaplama</p>
          <h2 className="mt-1 font-display text-lg font-bold text-text">Komisyon simülatörü</h2>
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
                vatIncluded === o.v ? "bg-accent text-accent-fg" : "text-text-muted hover:text-text"
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.2fr]">
        <div className="grid content-start gap-4 border-b border-line p-5 lg:border-b-0 lg:border-r">
          <label className="text-sm font-medium text-text">
            İşlem bedeli
            <div className="relative mt-1.5">
              <Wallet className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent-text" />
              <input value={dealValue} onChange={(event) => setDealValue(event.target.value)} inputMode="decimal" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas py-3 pl-10 pr-12 text-lg font-bold tabular-nums text-text outline-none transition focus:border-accent focus:bg-surface" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-faint">₺</span>
            </div>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-text">
              Komisyon oranı
              <div className="relative mt-1.5">
                <input value={rate} onChange={(event) => setRate(event.target.value)} inputMode="decimal" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 pr-9 text-sm font-semibold outline-none focus:border-accent" />
                <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              </div>
            </label>
            <label className="text-sm font-medium text-text">
              Danışman payı
              <div className="relative mt-1.5">
                <input value={advisorShare} onChange={(event) => setAdvisorShare(event.target.value)} inputMode="decimal" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 pr-9 text-sm font-semibold outline-none focus:border-accent" />
                <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              </div>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-text">
              Stopaj
              <div className="relative mt-1.5">
                <input value={withholdingRate} onChange={(event) => setWithholdingRate(event.target.value)} inputMode="decimal" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 pr-9 text-sm font-semibold outline-none focus:border-accent" />
                <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              </div>
            </label>
            <label className="text-sm font-medium text-text">
              Diğer kesinti
              <input value={otherDeductions} onChange={(event) => setOtherDeductions(event.target.value)} inputMode="decimal" placeholder="₺" className="mt-1.5 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold tabular-nums outline-none focus:border-accent" />
            </label>
          </div>
          <CommissionCapNotice kind="sale" amount={result.deal} commissionAmount={result.gross} />
          <div className="rounded-[var(--radius-card)] border border-border-interactive bg-accent-subtle p-4">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-accent-text">Komisyon (KDV hariç)</p>
            <p className="mt-1 font-display text-3xl font-extrabold tabular-nums text-text"><AnimatedNumber value={result.gross} kind="currency" /></p>
            <p className="mt-1 text-xs text-text-muted">
              {money(result.deal)} bedel üzerinden %{rate}
              {vatIncluded ? " · girilen tutar KDV dahil kabul edildi" : ""}
            </p>
            <p className="hairline-t mt-2.5 flex items-center justify-between pt-2.5 text-xs">
              <span className="text-text-muted">Müşteriden tahsil edilecek</span>
              <span className="font-display text-sm font-extrabold tabular-nums text-text"><AnimatedNumber value={calc.gross} kind="currency" /></span>
            </p>
          </div>
        </div>

        <div className="p-5">
          <div className="grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
            {/* Pay dağılımı: tek grafik setinden DonutRing (değer değişince dilimler akıcı kayar; reduce'ta anlık). */}
            <DonutRing
              className="mx-auto"
              size={160}
              stroke={14}
              format="percent"
              ariaLabel="Komisyon dağılımı"
              segments={[
                { label: "Danışman payı", value: result.advisorRate, color: "var(--accent)" },
                { label: "Ofis payı", value: 100 - result.advisorRate, color: "var(--viz-pos)" },
              ]}
            >
              <div className="grid h-24 w-24 place-items-center rounded-full bg-surface text-center shadow-[var(--elev-2)]">
                <div><p className="text-xs text-text-faint">Dağıtılacak</p><p className="font-display text-base font-extrabold tabular-nums text-text"><AnimatedNumber value={result.gross} kind="currency" /></p></div>
              </div>
            </DonutRing>
            <div className="space-y-3">
              {[
                { icon: UserRound, label: `Danışman payı · %${result.advisorRate}`, value: result.advisor, color: "text-accent-text", bg: "bg-accent-subtle" },
                { icon: Building2, label: `Ofis payı · %${100 - result.advisorRate}`, value: result.office, color: "text-[color:var(--viz-pos)]", bg: "bg-[color-mix(in_srgb,var(--viz-pos)_13%,transparent)]" },
                { icon: ReceiptText, label: "Hesaplanan KDV", value: result.vat, color: "text-[color:var(--pm-warn-text)]", bg: "bg-[color-mix(in_srgb,var(--viz-5)_14%,transparent)]" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
                  <span className={`grid h-9 w-9 place-items-center rounded-[var(--radius-control)] ${item.bg} ${item.color}`}><item.icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1"><p className="text-xs text-text-muted">{item.label}</p><p className="font-display text-base font-bold tabular-nums text-text"><AnimatedNumber value={item.value} kind="currency" /></p></div>
                </div>
              ))}
            </div>
          </div>

          {/* X7'nin asil sorusu: "elime ne gececek". Onceki hali yalnizca brut
              payi gosteriyordu. */}
          <div className="mt-4 rounded-[var(--radius-card)] border border-[color:var(--viz-pos)]/30 bg-[color-mix(in_srgb,var(--viz-pos)_8%,transparent)] p-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-[color:var(--viz-pos)]">
                  Danışmanın eline geçen
                </p>
                <p className="mt-0.5 font-display text-2xl font-extrabold tabular-nums text-[color:var(--viz-pos)]">
                  <AnimatedNumber value={calc.advisorNet} kind="currency" />
                </p>
              </div>
              {calc.withholding > 0 ? (
                <p className="text-xs text-text-muted">
                  Stopaj <span className="font-semibold tabular-nums text-[color:var(--viz-neg)]">−{money(calc.withholding)}</span>
                </p>
              ) : null}
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-text-muted">
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
