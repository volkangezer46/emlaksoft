"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Check,
  Copy,
  Percent,
  PiggyBank,
  Printer,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Combobox } from "@/components/ui/combobox";
import { AreaTrend, BarCompare, ChartFrame } from "@/app/app/_ui/lazy-chart";
import { useToast } from "@/components/app/toast-provider";
import { convertTry, formatFx } from "@/lib/fx";
import { MAX_LOAN_MONTHS, MIN_LOAN_MONTHS, formatTry } from "@/lib/purchase-costs";
import {
  DEFAULT_GROWTH_SOURCE_MONTH,
  INVESTMENT_DEFAULTS,
  INVESTMENT_DISCLAIMER,
  IRR_METHOD_NOTE,
  RENT_TAX_NOTE,
  computeCashFlow,
  computeRentalYield,
  formatPct,
  formatYears,
  projectYears,
} from "@/lib/investment";

export type InvestmentProperty = {
  id: string;
  label: string;
  code: string;
  price: number | null;
  sqm: number | null;
  /** Bölge medyanından türetilen aylık kira önerisi (₺). */
  suggestedRent: number | null;
  /** Öneriyi üreten kiralık ilan sayısı — güven göstergesi. */
  suggestedRentSample: number;
  /** Portföyün yürürlükteki kira sözleşmesindeki gerçek kira (₺). */
  actualRent: number | null;
};

/** Kira rakamının nereden geldiği — kullanıcıya dürüstçe söylenir. */
export type RentSource = "contract" | "region" | "estimate" | "manual";

export type InvestmentInitial = {
  propertyId: string;
  price: number;
  sqm: number;
  monthlyRent: number;
  rentSource: RentSource;
  downPayment: number;
  months: number;
  monthlyRatePct: number;
  vacancyPct: number;
  maintenancePct: number;
  managementPct: number;
  taxPct: number;
  rentGrowthPct: number;
  priceGrowthPct: number;
};

export type FxProp = { usd: number | null; eur: number | null; ageLabel: string | null } | null;

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/** "1.250.000" / "1250000 ₺" → 1250000. Boş/çöp girdi 0 döner. */
function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

const fieldCls =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-brand-400";
const labelCls = "mb-1.5 block text-sm text-text-muted";

function MoneyField({
  label,
  value,
  onChange,
  id,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  id: string;
  hint?: string;
}) {
  return (
    <div>
      <label className={labelCls} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          inputMode="numeric"
          value={value ? nf.format(value) : ""}
          onChange={(e) => onChange(parseNumber(e.target.value))}
          placeholder="0"
          className={`${fieldCls} numeric pr-8 text-right font-semibold tabular-nums`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-faint">₺</span>
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-text-faint">{hint}</p> : null}
    </div>
  );
}

function PctField({
  label,
  value,
  onChange,
  id,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  id: string;
  hint?: string;
}) {
  return (
    <div>
      <label className={labelCls} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          value={String(value)}
          onChange={(e) => {
            const v = Number(e.target.value.replace(",", "."));
            onChange(Number.isFinite(v) && v >= 0 ? v : 0);
          }}
          className={`${fieldCls} numeric pr-8 text-right tabular-nums`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-faint">%</span>
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-text-faint">{hint}</p> : null}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  id,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (n: number) => void;
  id: string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label className="text-sm text-text-muted" htmlFor={id}>
          {label}
        </label>
        <span className="numeric text-sm font-bold tabular-nums text-brand-600">
          {value.toLocaleString("tr-TR")} {suffix}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-brand-600"
      />
    </div>
  );
}

const RENT_SOURCE_LABEL: Record<RentSource, string> = {
  contract: "Yürürlükteki kira sözleşmesinden alındı — gerçek veri.",
  region: "Aynı ilçedeki kiralık ilanların medyan ₺/m² değeri × portföyün m²'si — tahmini.",
  estimate: `Bölge kira verisi yok; fiyatın binde ${INVESTMENT_DEFAULTS.rentEstimatePerMille}'ü varsayıldı — tahmini.`,
  manual: "Elle girildi.",
};

/**
 * Yatırım getirisi analizörü.
 *
 * TAMAMEN İSTEMCİ HESABI: girdilerin hepsi `useState`, hesabın tamamı
 * `src/lib/investment.ts` saf fonksiyonları. Sunucuya tek istek gitmez —
 * kaydırıcı oynatıldığında sonuç anında değişir.
 *
 * PAYLAŞIM: "Müşteriye gönder" tüm girdileri URL paramına yazar; link
 * açıldığında sayfa aynı sonucu üretir (page.tsx searchParams sözleşmesi).
 * "Yazdır" ise globals.css `@media print` katmanını kullanır — ayrı PDF
 * kütüphanesi yok, tarayıcının "PDF olarak kaydet" akışı A4'e sığar.
 */
export function InvestmentAnalyzer({
  properties,
  initial,
  fx,
}: {
  properties: InvestmentProperty[];
  initial: InvestmentInitial;
  fx: FxProp;
}) {
  const router = useRouter();
  const { push } = useToast();

  const [price, setPrice] = useState(initial.price);
  const [monthlyRent, setMonthlyRent] = useState(initial.monthlyRent);
  const [rentTouched, setRentTouched] = useState(false);
  const [downPayment, setDownPayment] = useState(initial.downPayment);
  const [months, setMonths] = useState(initial.months);
  const [monthlyRatePct, setMonthlyRatePct] = useState(initial.monthlyRatePct);
  const [vacancyPct, setVacancyPct] = useState(initial.vacancyPct);
  const [maintenancePct, setMaintenancePct] = useState(initial.maintenancePct);
  const [managementPct, setManagementPct] = useState(initial.managementPct);
  const [taxPct, setTaxPct] = useState(initial.taxPct);
  const [rentGrowthPct, setRentGrowthPct] = useState(initial.rentGrowthPct);
  const [priceGrowthPct, setPriceGrowthPct] = useState(initial.priceGrowthPct);
  const [copied, setCopied] = useState(false);

  const selected = properties.find((p) => p.id === initial.propertyId) ?? null;
  const downPct = price > 0 ? Math.round((downPayment / price) * 100) : 0;
  const rentSource: RentSource = rentTouched ? "manual" : initial.rentSource;

  const cashFlow = useMemo(
    () =>
      computeCashFlow({
        price,
        downPayment,
        loanMonths: months,
        monthlyRatePct,
        monthlyRent,
        vacancyPct,
        maintenancePct,
        managementPct,
        taxPct,
      }),
    [price, downPayment, months, monthlyRatePct, monthlyRent, vacancyPct, maintenancePct, managementPct, taxPct],
  );

  // Getiri, mülkün kendi verimliliği — kredi hariç. Yıllık gider nakit akışı
  // hesabından gelir ki iki blok aynı varsayımları kullansın.
  const yieldRes = useMemo(
    () =>
      computeRentalYield({
        price,
        monthlyRent,
        annualCostsTry: cashFlow.annualOperatingCosts,
      }),
    [price, monthlyRent, cashFlow.annualOperatingCosts],
  );

  const projection = useMemo(
    () =>
      projectYears({
        price,
        downPayment,
        loanMonths: months,
        monthlyRatePct,
        monthlyRent,
        vacancyPct,
        maintenancePct,
        managementPct,
        taxPct,
        rentGrowthPct,
        priceGrowthPct,
        sqm: initial.sqm || null,
      }),
    [
      price,
      downPayment,
      months,
      monthlyRatePct,
      monthlyRent,
      vacancyPct,
      maintenancePct,
      managementPct,
      taxPct,
      rentGrowthPct,
      priceGrowthPct,
      initial.sqm,
    ],
  );

  const positive = cashFlow.monthlyCashFlow >= 0;

  const shareParams = useMemo(() => {
    const p = new URLSearchParams({
      fiyat: String(price),
      kira: String(monthlyRent),
      pesinat: String(downPayment),
      vade: String(months),
      faiz: String(monthlyRatePct),
      bosluk: String(vacancyPct),
      bakim: String(maintenancePct),
      yonetim: String(managementPct),
      vergi: String(taxPct),
      artis: String(rentGrowthPct),
      deger: String(priceGrowthPct),
    });
    if (initial.sqm) p.set("m2", String(initial.sqm));
    return p;
  }, [
    price,
    monthlyRent,
    downPayment,
    months,
    monthlyRatePct,
    vacancyPct,
    maintenancePct,
    managementPct,
    taxPct,
    rentGrowthPct,
    priceGrowthPct,
    initial.sqm,
  ]);

  function selectProperty(id: string) {
    if (!id) return;
    router.push(`/app/yatirim?portfoy=${id}`);
  }

  async function copyShareLink() {
    const url = `${window.location.origin}/app/yatirim?${shareParams.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      push("Yatırım analizi linki kopyalandı — müşteriye gönderebilirsiniz", "ok");
    } catch {
      push("Link kopyalanamadı, adres çubuğundan alabilirsiniz", "err");
    }
  }

  const fxLine = (amount: number): string | null => {
    if (!fx || !Number.isFinite(amount) || amount === 0) return null;
    const parts = [
      formatFx(convertTry(amount, fx.usd), "USD"),
      formatFx(convertTry(amount, fx.eur), "EUR"),
    ].filter((p): p is string => p !== null);
    return parts.length > 0 ? `≈ ${parts.join(" · ")}` : null;
  };

  const kpis = [
    {
      key: "brut",
      label: "Brüt kira getirisi",
      value: formatPct(yieldRes.grossYieldPct),
      hint: `Yıllık ${formatTry(yieldRes.annualRent)} kira / ${formatTry(price)} bedel`,
      icon: Percent,
      tone: "brand" as const,
    },
    {
      key: "net",
      label: "Net kira getirisi",
      value: formatPct(yieldRes.netYieldPct),
      hint: `Giderler düşülmüş — yıllık ${formatTry(cashFlow.annualOperatingCosts)} gider`,
      icon: TrendingUp,
      tone: "brand" as const,
    },
    {
      key: "amorti",
      label: "Amorti süresi",
      value: formatYears(yieldRes.netPaybackYears),
      hint:
        yieldRes.rentMultiplier > 0
          ? `Brüt kira çarpanı ${nf.format(Math.round(yieldRes.rentMultiplier * 10) / 10)} yıl`
          : "Kira girilmedi",
      icon: CalendarClock,
      tone: "brand" as const,
    },
    {
      key: "nakit",
      label: "Aylık net nakit",
      value: formatTry(cashFlow.monthlyCashFlow),
      hint: positive
        ? "Taksit ve giderler sonrası cebinizde kalan"
        : `Her ay cebinizden ${formatTry(Math.abs(cashFlow.monthlyCashFlow))} koyarsınız`,
      icon: Wallet,
      tone: positive ? ("mint" as const) : ("amber" as const),
    },
  ];

  const toneCls = {
    brand: "border-brand-600/20 bg-brand-600/6 text-brand-600",
    mint: "border-mint-500/25 bg-mint-500/8 text-mint-600",
    amber: "border-amber-400/30 bg-amber-400/8 text-amber-600",
  };

  const chartData = projection.years.map((y) => ({
    yil: `${y.year}. yıl`,
    nakit: y.netCash,
    kumulatif: y.cumulativeCash,
  }));

  return (
    <div className="print-sheet grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      {/* ============================ SOL: girdi + çıktı ==================== */}
      <div className="space-y-5">
        {/* ---------------------------- KPI şeridi -------------------------- */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.key} className={`print-avoid-break rounded-[16px] border p-4 ${toneCls[k.tone]}`}>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em]">
                <k.icon className="h-3.5 w-3.5" /> {k.label}
              </p>
              <p className="numeric mt-1.5 font-display text-2xl font-extrabold tabular-nums text-ink-950">
                {k.value}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{k.hint}</p>
            </div>
          ))}
        </div>

        {/* ---------------------------- Girdiler ---------------------------- */}
        <section className="no-print rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <PiggyBank className="h-4 w-4 text-brand-600" /> Yatırım girdileri
          </h2>

          <div className="mt-4 space-y-4">
            <div>
              <span className={labelCls}>Portföyden doldur (opsiyonel)</span>
              <Combobox
                aria-label="Portföy"
                defaultValue={initial.propertyId}
                placeholder="Portföy seçin — fiyat, m² ve kira önerisi otomatik dolsun"
                searchPlaceholder="Kod ya da başlık ara…"
                emptyText="Fiyatlı satılık portföy bulunamadı"
                onValueChange={selectProperty}
                options={properties.map((p) => ({
                  value: p.id,
                  label: p.label,
                  hint: p.price ? `${p.code} · ${nf.format(p.price)} ₺` : p.code,
                }))}
              />
              {selected?.sqm ? (
                <p className="mt-1 text-[11px] text-text-faint">
                  {selected.label} · {selected.sqm} m²
                  {selected.suggestedRentSample >= 3
                    ? ` · ilçede ${selected.suggestedRentSample} kiralık ilan referans alındı`
                    : ""}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyField id="fiyat" label="Alış bedeli" value={price} onChange={setPrice} />
              <MoneyField
                id="kira"
                label="Aylık brüt kira"
                value={monthlyRent}
                onChange={(n) => {
                  setRentTouched(true);
                  setMonthlyRent(n);
                }}
                hint={RENT_SOURCE_LABEL[rentSource]}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyField
                id="pesinat"
                label={`Peşinat (%${downPct})`}
                value={downPayment}
                onChange={(n) => setDownPayment(Math.min(n, price || n))}
              />
              <div className="flex flex-col justify-end pb-1">
                <Slider
                  id="pesinat-oran"
                  label="Peşinat oranı"
                  value={downPct}
                  min={0}
                  max={100}
                  step={5}
                  suffix="%"
                  onChange={(pct) => setDownPayment(Math.round((price * pct) / 100))}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Slider
                id="vade"
                label="Kredi vadesi"
                value={months}
                min={MIN_LOAN_MONTHS}
                max={MAX_LOAN_MONTHS}
                step={12}
                suffix="ay"
                onChange={setMonths}
              />
              <PctField
                id="faiz"
                label="Aylık faiz oranı"
                value={monthlyRatePct}
                onChange={setMonthlyRatePct}
                hint="Bankanızın güncel konut kredisi oranını girin."
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <PctField
                id="bosluk"
                label="Boşluk oranı"
                value={vacancyPct}
                onChange={setVacancyPct}
                hint="Kiracı değişimi arası boş süre."
              />
              <PctField
                id="bakim"
                label="Bakım-onarım"
                value={maintenancePct}
                onChange={setMaintenancePct}
                hint="Tahsil edilen kira üzerinden."
              />
              <PctField
                id="yonetim"
                label="Mülk yönetimi"
                value={managementPct}
                onChange={setManagementPct}
                hint="Kirayı ofis takip ediyorsa."
              />
              <PctField id="vergi" label="Kira geliri vergisi" value={taxPct} onChange={setTaxPct} />
            </div>
            <p className="rounded-[10px] border border-line bg-canvas/60 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
              {RENT_TAX_NOTE}
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <PctField
                id="artis"
                label="Yıllık kira artışı"
                value={rentGrowthPct}
                onChange={setRentGrowthPct}
                hint={`Konut kirasında yasal tavan TÜFE 12 aylık ortalamasıdır (TBK m.344). Varsayılan ${DEFAULT_GROWTH_SOURCE_MONTH} ayından geldi.`}
              />
              <PctField
                id="deger"
                label="Yıllık değer artışı"
                value={priceGrowthPct}
                onChange={setPriceGrowthPct}
                hint="Varsayılan olarak kira artışıyla aynı: uzun dönemde konut değerinin reel getirisi sıfıra yakın kabul edildi."
              />
            </div>
          </div>
        </section>

        {/* ------------------------- Aylık nakit akışı ---------------------- */}
        <section className="print-avoid-break rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Banknote className="h-4 w-4 text-mint-600" /> Aylık nakit akışı
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Kirayı tahsil ettikten, giderleri ve taksidi ödedikten sonra cebe kalan.
          </p>

          {price <= 0 || monthlyRent <= 0 ? (
            <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
              Alış bedeli ve aylık kirayı girin — nakit akışı dökümü burada oluşur.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <tbody className="divide-y divide-line">
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-ink-950">Brüt aylık kira</td>
                    <td className="numeric whitespace-nowrap py-2.5 text-right font-bold tabular-nums text-mint-600">
                      +{formatTry(cashFlow.monthlyRent)}
                    </td>
                  </tr>
                  {cashFlow.expenseLines.map((l) => (
                    <tr key={l.key}>
                      <td className="py-2.5 pr-3">
                        <p className="text-ink-950">{l.label}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{l.note}</p>
                      </td>
                      <td className="numeric whitespace-nowrap py-2.5 text-right align-top tabular-nums text-text-muted">
                        −{formatTry(l.amount)}
                      </td>
                    </tr>
                  ))}
                  {cashFlow.monthlyLoanPayment > 0 ? (
                    <tr>
                      <td className="py-2.5 pr-3">
                        <p className="text-ink-950">Kredi taksiti ({months} ay)</p>
                        <p className="mt-0.5 text-[11px] text-text-muted">
                          {formatTry(cashFlow.loanAmount)} kredi · aylık %{monthlyRatePct}
                        </p>
                      </td>
                      <td className="numeric whitespace-nowrap py-2.5 text-right align-top tabular-nums text-amber-600">
                        −{formatTry(cashFlow.monthlyLoanPayment)}
                      </td>
                    </tr>
                  ) : null}
                  <tr className="bg-canvas/60">
                    <td className="py-3 pr-3 font-display font-extrabold text-ink-950">
                      Aylık net nakit akışı
                      <span className="ml-2 text-[11px] font-semibold text-text-muted">
                        peşinata göre nakit getirisi {formatPct(cashFlow.cashOnCashPct)}
                      </span>
                    </td>
                    <td
                      className={`numeric whitespace-nowrap py-3 text-right font-display font-extrabold tabular-nums ${
                        positive ? "text-mint-600" : "text-amber-600"
                      }`}
                    >
                      {formatTry(cashFlow.monthlyCashFlow)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-3 text-text-muted">
                      Başabaş kira
                      <span className="ml-2 text-[11px]">
                        bu kiranın altında her ay cebinizden para koyarsınız
                      </span>
                    </td>
                    <td className="numeric whitespace-nowrap py-2.5 text-right font-semibold tabular-nums text-ink-950">
                      {cashFlow.breakEvenRent > 0 ? formatTry(cashFlow.breakEvenRent) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* --------------------------- Grafikler ---------------------------- */}
        {price > 0 && monthlyRent > 0 ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartFrame
              title="Yıllık net nakit akışı"
              subtitle="kredi bittiği yıl sıçrama görünür"
              height={230}
              className="print-avoid-break"
            >
              <BarCompare
                data={chartData}
                xKey="yil"
                series={[{ key: "nakit", label: "Net nakit", color: "var(--mint-500)" }]}
                format="money"
              />
            </ChartFrame>
            <ChartFrame
              title="Kümülatif nakit"
              subtitle={`başlangıç nakdi ${formatTry(projection.initialCash)}`}
              height={230}
              className="print-avoid-break"
            >
              <AreaTrend
                data={chartData}
                xKey="yil"
                series={[{ key: "kumulatif", label: "Kümülatif nakit" }]}
                format="money"
              />
            </ChartFrame>
          </div>
        ) : null}

        {/* ------------------------ 10 yıllık tablo ------------------------- */}
        {price > 0 && monthlyRent > 0 ? (
          <section className="print-avoid-break rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <TrendingUp className="h-4 w-4 text-brand-600" /> {projection.years.length} yıllık projeksiyon
            </h2>
            <p className="mt-1 text-xs text-text-muted">
              Kira yılda %{rentGrowthPct}, konut değeri yılda %{priceGrowthPct} artar varsayımıyla.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
                    <th className="py-2.5 pr-3">Yıl</th>
                    <th className="py-2.5 pr-3 text-right">Kira geliri</th>
                    <th className="py-2.5 pr-3 text-right">Gider</th>
                    <th className="py-2.5 pr-3 text-right">Taksit</th>
                    <th className="py-2.5 pr-3 text-right">Net nakit</th>
                    <th className="py-2.5 pr-3 text-right">Kalan borç</th>
                    <th className="py-2.5 pr-3 text-right">Tahmini değer</th>
                    <th className="py-2.5 text-right">Kümülatif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {projection.years.map((y) => (
                    <tr
                      key={y.year}
                      className={y.year === projection.cashPaybackYear ? "bg-mint-500/6" : undefined}
                    >
                      <td className="py-2.5 pr-3 font-semibold text-ink-950">{y.year}. yıl</td>
                      <td className="numeric py-2.5 pr-3 text-right tabular-nums text-ink-950">
                        {formatTry(y.rentIncome)}
                      </td>
                      <td className="numeric py-2.5 pr-3 text-right tabular-nums text-text-muted">
                        {formatTry(y.expenses)}
                      </td>
                      <td className="numeric py-2.5 pr-3 text-right tabular-nums text-text-muted">
                        {y.debtService > 0 ? formatTry(y.debtService) : "—"}
                      </td>
                      <td
                        className={`numeric py-2.5 pr-3 text-right font-bold tabular-nums ${
                          y.netCash >= 0 ? "text-mint-600" : "text-amber-600"
                        }`}
                      >
                        {formatTry(y.netCash)}
                      </td>
                      <td className="numeric py-2.5 pr-3 text-right tabular-nums text-text-muted">
                        {y.remainingPrincipal > 0 ? formatTry(y.remainingPrincipal) : "Kapandı"}
                      </td>
                      <td className="numeric py-2.5 pr-3 text-right tabular-nums text-ink-950">
                        {formatTry(y.estimatedValue)}
                      </td>
                      <td className="numeric py-2.5 text-right font-semibold tabular-nums text-ink-950">
                        {formatTry(y.cumulativeCash)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-text-faint">{IRR_METHOD_NOTE}</p>
          </section>
        ) : null}
      </div>

      {/* ============================ SAĞ: yapışkan özet ==================== */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <section className="print-avoid-break rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Sparkles className="h-4 w-4 text-mint-600" /> Yatırım özeti
          </h2>

          <dl className="mt-4 space-y-2.5 text-sm">
            {[
              {
                k: "Cepten çıkan başlangıç",
                v: formatTry(projection.initialCash),
                s: `${formatTry(downPayment)} peşinat + ${formatTry(projection.purchaseCosts)} alım masrafı`,
              },
              {
                k: "Aylık net nakit",
                v: formatTry(cashFlow.monthlyCashFlow),
                s: positive ? "Pozitif — mülk kendini döndürüyor" : "Negatif — her ay ilave ödeme",
              },
              {
                k: "Nakit amorti yılı",
                v: projection.cashPaybackYear ? `${projection.cashPaybackYear}. yıl` : "10 yılda olmuyor",
                s: "Kümülatif nakdin başlangıç nakdini karşıladığı yıl",
              },
              {
                k: `${projection.years.length}. yıl toplam getiri`,
                v: formatTry(projection.totalReturn),
                s: `Başlangıç nakdine göre ${formatPct(projection.totalReturnPct)}`,
              },
              {
                k: "Yaklaşık yıllık getiri",
                v: projection.approxIrrPct === null ? "Hesaplanamadı" : formatPct(projection.approxIrrPct),
                s: "Satış varsayımlı yaklaşık IRR",
              },
            ].map((row) => (
              <div key={row.k} className="rounded-[12px] border border-line bg-canvas/50 p-3">
                <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-faint">{row.k}</dt>
                <dd className="numeric mt-1 font-display text-lg font-extrabold tabular-nums text-ink-950">
                  {row.v}
                </dd>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{row.s}</p>
              </div>
            ))}
          </dl>

          {fx && fxLine(price) ? (
            <p className="mt-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-2.5 text-[11px] leading-relaxed text-text-muted">
              <span className="font-semibold text-ink-950">Döviz karşılığı:</span> alış bedeli {fxLine(price)}
              {fxLine(cashFlow.monthlyCashFlow) ? (
                <>
                  {" "}
                  · aylık net nakit {fxLine(cashFlow.monthlyCashFlow)}
                </>
              ) : null}
              {fx.ageLabel ? <span className="block text-text-faint">TCMB satış kuru · {fx.ageLabel}</span> : null}
            </p>
          ) : null}

          <div className="no-print mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={copyShareLink}
              className="btn-shine focus-ring press inline-flex items-center justify-center gap-2 rounded-[11px] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-600/90"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Kopyalandı" : "Müşteriye gönder"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="focus-ring press inline-flex items-center justify-center gap-2 rounded-[11px] border border-line bg-canvas px-4 py-3 text-sm font-bold text-ink-950 transition hover:border-line-strong"
            >
              <Printer className="h-4 w-4" /> Yazdır
            </button>
          </div>
          <p className="no-print mt-2 text-center text-[11px] text-text-faint">
            Link bu analizin tüm parametrelerini taşır — müşteri açtığında aynı sonucu görür.
          </p>

          <p className="mt-4 flex items-start gap-2 rounded-[12px] border border-amber-400/30 bg-amber-400/8 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {INVESTMENT_DISCLAIMER}
          </p>
        </section>
      </div>
    </div>
  );
}
