"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  Calculator,
  Check,
  Copy,
  Landmark,
  Percent,
  PiggyBank,
  Receipt,
  Wallet,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/components/app/toast-provider";
import {
  APPROX_DISCLAIMER,
  DEFAULT_DOWN_PAYMENT_PCT,
  MAX_LOAN_MONTHS,
  MAX_LOAN_TO_VALUE_PCT,
  MIN_LOAN_MONTHS,
  computeLoanPlan,
  computePurchaseCosts,
  formatTry,
  type DeedFeeShare,
} from "@/lib/purchase-costs";

export type CalculatorProperty = {
  id: string;
  label: string;
  code: string;
  price: number | null;
  sqm: number | null;
  transactionType: string | null;
};

export type CalculatorInitial = {
  propertyId: string;
  price: number;
  downPayment: number | null;
  months: number;
  monthlyRatePct: number;
  commissionPct: number;
  deedFeeShare: DeedFeeShare;
  sqm: number;
  tab: "maliyet" | "kredi";
};

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/** "1.250.000" / "1250000 ₺" → 1250000. Boş/çöp girdi 0 döner. */
function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

const fieldCls =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm text-ink-950 outline-none transition focus:border-brand-400";
const labelCls = "mb-1.5 block text-sm text-text-muted";

/** Binlik ayraçlı para alanı — panelde ₺ girdileri hep bu biçimde. */
function MoneyField({
  label,
  value,
  onChange,
  id,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  id: string;
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
      <div className="mb-1.5 flex items-center justify-between">
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

/**
 * Panel hesaplayıcısı — "bu evi alırsam cebimden ne çıkar, taksit ne olur".
 * Tüm hesap istemcide (saf fonksiyonlar), sunucuya istek yok. Portföy seçimi
 * yalnızca fiyat/m² ön doldurmak için URL'e `?portfoy=` yazar.
 */
export function PurchaseCalculator({
  properties,
  initial,
}: {
  properties: CalculatorProperty[];
  initial: CalculatorInitial;
}) {
  const router = useRouter();
  const { push } = useToast();

  const [price, setPrice] = useState(initial.price);
  const [sqm, setSqm] = useState(initial.sqm);
  const [downPayment, setDownPayment] = useState(
    initial.downPayment ?? Math.round((initial.price * DEFAULT_DOWN_PAYMENT_PCT) / 100),
  );
  const [months, setMonths] = useState(initial.months);
  const [monthlyRatePct, setMonthlyRatePct] = useState(initial.monthlyRatePct);
  const [commissionPct, setCommissionPct] = useState(initial.commissionPct);
  const [deedFeeShare, setDeedFeeShare] = useState<DeedFeeShare>(initial.deedFeeShare);
  const [newBuild, setNewBuild] = useState(false);
  const [propertyKind, setPropertyKind] = useState<"residential" | "commercial">("residential");
  const [copied, setCopied] = useState(false);

  const downPct = price > 0 ? Math.round((downPayment / price) * 100) : 0;

  const costs = useMemo(
    () =>
      computePurchaseCosts({
        price,
        downPayment,
        sqm: sqm || null,
        commissionPct,
        deedFeeShare,
        newBuild,
        propertyKind,
      }),
    [price, downPayment, sqm, commissionPct, deedFeeShare, newBuild, propertyKind],
  );

  const loan = useMemo(
    () => computeLoanPlan({ amount: costs.loanAmount, monthlyRatePct, months, scheduleRows: 12 }),
    [costs.loanAmount, monthlyRatePct, months],
  );

  function selectProperty(id: string) {
    if (!id) return;
    router.push(`/app/hesaplayici?portfoy=${id}`);
  }

  async function copyShareLink() {
    const params = new URLSearchParams({
      fiyat: String(price),
      pesinat: String(downPayment),
      vade: String(months),
      faiz: String(monthlyRatePct),
      komisyon: String(commissionPct),
      harc: deedFeeShare,
    });
    if (sqm) params.set("m2", String(sqm));
    const url = `${window.location.origin}/app/hesaplayici?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      push("Hesap linki kopyalandı — müşteriye gönderebilirsiniz", "ok");
    } catch {
      push("Link kopyalanamadı, adres çubuğundan alabilirsiniz", "err");
    }
  }

  const summary = [
    {
      label: "Cepten çıkan toplam",
      value: formatTry(costs.cashOutOfPocket),
      hint: `${formatTry(costs.downPayment)} peşinat + ${formatTry(costs.totalCosts)} masraf`,
      icon: Wallet,
      tone: "brand" as const,
    },
    {
      label: "Aylık taksit",
      value: loan.monthlyPayment > 0 ? formatTry(loan.monthlyPayment) : "Kredi yok",
      hint: loan.monthlyPayment > 0 ? `${months} ay · aylık %${monthlyRatePct}` : "Peşin alım",
      icon: Banknote,
      tone: "mint" as const,
    },
    {
      label: "Toplam faiz",
      value: loan.totalInterest > 0 ? formatTry(loan.totalInterest) : "—",
      hint: loan.totalPayment > 0 ? `Toplam geri ödeme ${formatTry(loan.totalPayment)}` : "Faiz oluşmaz",
      icon: Percent,
      tone: "amber" as const,
    },
  ];

  const toneCls = {
    brand: "border-brand-600/20 bg-brand-600/6 text-brand-600",
    mint: "border-mint-500/25 bg-mint-500/8 text-mint-600",
    amber: "border-amber-400/30 bg-amber-400/8 text-amber-600",
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
      {/* ------------------------------- SOL: girdi + döküm ------------------ */}
      <div className="space-y-5">
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Calculator className="h-4 w-4 text-brand-600" /> Hesap girdileri
          </h2>

          <div className="mt-4 space-y-4">
            <div>
              <span className={labelCls}>Portföyden doldur (opsiyonel)</span>
              <Combobox
                aria-label="Portföy"
                defaultValue={initial.propertyId}
                placeholder="Portföy seçin — fiyat ve m² otomatik dolsun"
                searchPlaceholder="Kod ya da başlık ara…"
                emptyText="Fiyatlı satılık portföy bulunamadı"
                onValueChange={selectProperty}
                options={properties.map((p) => ({
                  value: p.id,
                  label: p.label,
                  hint: p.price ? `${p.code} · ${nf.format(p.price)} ₺` : p.code,
                }))}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyField id="fiyat" label="Satış bedeli" value={price} onChange={setPrice} />
              <div>
                <label className={labelCls} htmlFor="m2">
                  Brüt m² (sigorta tahmini için)
                </label>
                <input
                  id="m2"
                  inputMode="numeric"
                  value={sqm ? String(sqm) : ""}
                  onChange={(e) => setSqm(parseNumber(e.target.value))}
                  placeholder="135"
                  className={`${fieldCls} numeric text-right tabular-nums`}
                />
              </div>
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
              <div>
                <label className={labelCls} htmlFor="faiz">
                  Aylık faiz oranı (%)
                </label>
                <input
                  id="faiz"
                  inputMode="decimal"
                  value={String(monthlyRatePct)}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(",", "."));
                    setMonthlyRatePct(Number.isFinite(v) && v >= 0 ? v : 0);
                  }}
                  className={`${fieldCls} numeric text-right tabular-nums`}
                />
                <p className="mt-1 text-[11px] text-text-faint">
                  Yıllık nominal ≈ %{loan.annualRatePct} · bankanızın güncel oranını girin
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="komisyon">
                  Komisyon oranı (%)
                </label>
                <input
                  id="komisyon"
                  inputMode="decimal"
                  value={String(commissionPct)}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(",", "."));
                    setCommissionPct(Number.isFinite(v) && v >= 0 ? v : 0);
                  }}
                  className={`${fieldCls} numeric text-right tabular-nums`}
                />
              </div>
              <div>
                <span className={labelCls}>Tapu harcı paylaşımı</span>
                <div className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-canvas p-1">
                  {(
                    [
                      { key: "half" as const, label: "Yarı yarıya (%2)" },
                      { key: "buyer" as const, label: "Tamamı alıcı (%4)" },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setDeedFeeShare(opt.key)}
                      className={`focus-ring press rounded-[8px] px-2 py-2 text-xs font-bold transition ${
                        deedFeeShare === opt.key
                          ? "bg-brand-600 text-white"
                          : "text-text-muted hover:text-ink-950"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Yeni bina KDV + taşınmaz cinsi — ilk el alımda KDV, işyerinde stopaj notu */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className={labelCls}>Taşınmaz cinsi</span>
                <div className="grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-canvas p-1">
                  {(
                    [
                      { key: "residential" as const, label: "Konut" },
                      { key: "commercial" as const, label: "İşyeri" },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setPropertyKind(opt.key)}
                      className={`focus-ring press rounded-[8px] px-2 py-2 text-xs font-bold transition ${
                        propertyKind === opt.key ? "bg-brand-600 text-white" : "text-text-muted hover:text-ink-950"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className={labelCls}>Yapı durumu</span>
                <label className="flex h-[42px] cursor-pointer items-center gap-2.5 rounded-[10px] border border-line bg-canvas px-3 text-sm">
                  <input
                    type="checkbox"
                    checked={newBuild}
                    onChange={(e) => setNewBuild(e.target.checked)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <span className="font-medium text-ink-950">Yeni bina (müteahhitten ilk el)</span>
                </label>
                <p className="mt-1 text-[11px] text-text-faint">İşaretliyse fiyata KDV eklenir; ikinci elde KDV yok.</p>
              </div>
            </div>
          </div>
        </section>

        {costs.exceedsLoanToValue ? (
          <p className="flex items-start gap-2 rounded-[12px] border border-amber-400/30 bg-amber-400/8 px-3 py-2.5 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Kredi tutarı konut değerinin %{costs.loanToValuePct}&apos;ine denk geliyor. Konut kredisinde kredi/değer
            oranı yasal olarak en çok %{MAX_LOAN_TO_VALUE_PCT} olabilir — peşinatı artırmanız gerekebilir.
          </p>
        ) : null}

        <Tabs defaultValue={initial.tab} className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <TabsList>
            <TabsTrigger value="maliyet">
              <Receipt /> Alım maliyeti
            </TabsTrigger>
            <TabsTrigger value="kredi">
              <Landmark /> Kredi taksiti
            </TabsTrigger>
          </TabsList>

          {/* ------------------------- Alım maliyeti ------------------------- */}
          <TabsContent value="maliyet" className="mt-4">
            {costs.lines.length === 0 ? (
              <p className="rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
                Satış bedelini girin — masraf dökümü burada oluşur.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
                      <th className="py-2.5 pr-3">Kalem</th>
                      <th className="py-2.5 text-right">Tutar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {costs.lines.map((l) => (
                      <tr key={l.key}>
                        <td className="py-3 pr-3">
                          <p className="font-semibold text-ink-950">{l.label}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{l.note}</p>
                        </td>
                        <td className="numeric whitespace-nowrap py-3 text-right align-top font-bold tabular-nums text-ink-950">
                          {formatTry(l.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-canvas/60">
                      <td className="py-3 pr-3 font-display font-extrabold text-ink-950">
                        Masraf toplamı
                        <span className="ml-2 text-[11px] font-semibold text-text-muted">
                          fiyatın ~%{costs.costsPctOfPrice}&apos;i
                        </span>
                      </td>
                      {/* whitespace-nowrap: dar sütunda "170.000" ve "₺" alt alta düşüyordu */}
                      <td className="numeric whitespace-nowrap py-3 text-right font-display font-extrabold tabular-nums text-brand-600">
                        {formatTry(costs.totalCosts)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <ul className="mt-4 space-y-1 text-[11px] leading-relaxed text-text-faint">
              {costs.notes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          </TabsContent>

          {/* --------------------------- Kredi ------------------------------ */}
          <TabsContent value="kredi" className="mt-4">
            {loan.monthlyPayment <= 0 ? (
              <p className="rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
                Peşinat satış bedelinin tamamını karşılıyor — kredi kullanılmıyor. Peşinatı düşürürseniz taksit planı
                burada oluşur.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Kredi tutarı", value: formatTry(loan.amount) },
                    { label: "Aylık taksit", value: formatTry(loan.monthlyPayment) },
                    { label: "Toplam geri ödeme", value: formatTry(loan.totalPayment) },
                  ].map((k) => (
                    <div key={k.label} className="rounded-[14px] border border-line bg-canvas/60 p-3">
                      <p className="text-[11px] text-text-muted">{k.label}</p>
                      <p className="numeric mt-1 font-display text-lg font-extrabold tabular-nums text-ink-950">
                        {k.value}
                      </p>
                    </div>
                  ))}
                </div>

                <h3 className="mt-5 text-sm font-bold text-ink-950">İlk 12 taksitin kırılımı</h3>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  Başlangıçta taksidin büyük kısmı faize gider; anapara payı vade ilerledikçe artar.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
                        <th className="py-2.5 pr-3">Taksit</th>
                        <th className="py-2.5 pr-3 text-right">Anapara</th>
                        <th className="py-2.5 pr-3 text-right">Faiz</th>
                        <th className="py-2.5 text-right">Kalan borç</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {loan.amortizationSchedule.map((row) => (
                        <tr key={row.no} className={row.no <= 3 ? "bg-brand-600/[0.03]" : undefined}>
                          <td className="py-2.5 pr-3 font-semibold text-ink-950">{row.no}. ay</td>
                          <td className="numeric py-2.5 pr-3 text-right tabular-nums text-mint-600">
                            {formatTry(row.principal)}
                          </td>
                          <td className="numeric py-2.5 pr-3 text-right tabular-nums text-amber-600">
                            {formatTry(row.interest)}
                          </td>
                          <td className="numeric py-2.5 text-right tabular-nums text-text-muted">
                            {formatTry(row.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-text-faint">{loan.note}</p>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ------------------------------ SAĞ: özet --------------------------- */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <PiggyBank className="h-4 w-4 text-mint-600" /> Özet
          </h2>

          <div className="mt-4 space-y-3">
            {summary.map((s) => (
              <div key={s.label} className={`rounded-[14px] border p-4 ${toneCls[s.tone]}`}>
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em]">
                  <s.icon className="h-3.5 w-3.5" /> {s.label}
                </p>
                <p className="numeric mt-1.5 font-display text-2xl font-extrabold tabular-nums text-ink-950">
                  {s.value}
                </p>
                <p className="mt-0.5 text-[11px] text-text-muted">{s.hint}</p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={copyShareLink}
            className="btn-shine focus-ring press mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-600/90"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Link kopyalandı" : "Müşteriye gönder (link kopyala)"}
          </button>
          <p className="mt-2 text-center text-[11px] text-text-faint">
            Link bu hesabın tüm parametrelerini taşır — müşteri açtığında aynı sonucu görür.
          </p>

          <p className="mt-4 flex items-start gap-2 rounded-[12px] border border-amber-400/30 bg-amber-400/8 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {APPROX_DISCLAIMER}
          </p>
        </section>
      </div>
    </div>
  );
}
