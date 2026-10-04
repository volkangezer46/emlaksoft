"use client";

import { useId, useState } from "react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { formatTry } from "@/lib/format";
import { computeCommissionTool, type CommissionRaw } from "@/lib/tools/commission-tool";
import { computeLoanTool, type LoanRaw } from "@/lib/tools/loan-tool";
import { computePurchaseTool, type PurchaseRaw } from "@/lib/tools/purchase-cost-tool";
import { computeRentalYield, type YieldRaw } from "@/lib/tools/rental-yield";
import { EmptyMsg, INPUT_CLS, Row, ToolField, ToolShellLayout } from "./tool-ui";

const SOFT = "Bu bir tahmindir; hukuki, mali veya yatırım tavsiyesi değildir. Girdiğiniz veriler tarayıcınızda hesaplanır, sunucuya gönderilmez.";

const nf2 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const money2 = (n: number) => `${nf2.format(n)} ₺`;

function Big({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-text-muted">{label}</p>
      <p className="font-display text-3xl font-bold tabular-nums text-ink-950 sm:text-4xl">{children}</p>
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3 text-xs leading-relaxed text-text-muted">
      <p className="font-semibold text-ink-950">Hesap</p>
      <p className="mt-1 tabular-nums">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

const COMMISSION_EMPTY: CommissionRaw = { price: "", rate: "", vatRate: "20", vatIncluded: false };

export function CommissionCalculator() {
  const uid = useId();
  const [raw, setRaw] = useState<CommissionRaw>(COMMISSION_EMPTY);
  const r = computeCommissionTool(raw);
  const bad = r.status === "invalid" ? r.fields : [];
  return (
    <ToolShellLayout
      resultTitle="Tahmini sonuç"
      onReset={() => setRaw({ ...COMMISSION_EMPTY, vatRate: "" })}
      disclaimer={SOFT}
      form={
        <>
          <ToolField label="Satış (veya kira) bedeli" hint="Komisyonun hesaplanacağı tutar." unit="₺" placeholder="örn. 1.000.000" value={raw.price} invalid={bad.includes("price")} onChange={(v) => setRaw((s) => ({ ...s, price: v }))} />
          <ToolField label="Komisyon oranı" hint="Sözleşmede anlaşılan oran; araç oran önermez." unit="%" placeholder="örn. 2" value={raw.rate} invalid={bad.includes("rate")} onChange={(v) => setRaw((s) => ({ ...s, rate: v }))} />
          <ToolField label="KDV oranı" hint="Güncel oranı resmi kaynaktan teyit edin; boşsa KDV 0 sayılır." unit="%" value={raw.vatRate} invalid={bad.includes("vatRate")} onChange={(v) => setRaw((s) => ({ ...s, vatRate: v }))} />
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-semibold text-ink-950">Anlaşılan komisyon</legend>
            <div className="mt-1.5 flex flex-col gap-1 sm:flex-row sm:gap-6">
              {[
                [false, "KDV hariç"],
                [true, "KDV dahil"],
              ].map(([val, label]) => (
                <label key={String(label)} className="inline-flex min-h-11 items-center gap-2 text-sm text-ink-950">
                  <input type="radio" name={`${uid}-vat`} checked={raw.vatIncluded === val} onChange={() => setRaw((s) => ({ ...s, vatIncluded: val as boolean }))} className="h-4 w-4" />
                  {label as string}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      }
    >
      {r.status !== "ok" ? (
        <EmptyMsg invalid={r.status === "invalid"} />
      ) : (
        <div className="space-y-4">
          <Big label="Müşteriden tahsil edilecek toplam">
            <AnimatedNumber value={r.gross} kind="currency" maximumFractionDigits={2} />
          </Big>
          <dl className="space-y-2 border-t border-line pt-4 text-sm">
            <Row dt="Komisyon (KDV hariç, matrah)" dd={money2(r.net)} />
            <Row dt={`KDV (%${nf2.format(r.vatRate)})`} dd={money2(r.vat)} />
          </dl>
          <Formula>
            {raw.vatIncluded
              ? `Matrah = bedel × %${nf2.format(r.rate)} ÷ (1 + %${nf2.format(r.vatRate)}) = ${money2(r.net)}; KDV = matrah × %${nf2.format(r.vatRate)} = ${money2(r.vat)}`
              : `Matrah = bedel × %${nf2.format(r.rate)} = ${money2(r.net)}; KDV = matrah × %${nf2.format(r.vatRate)} = ${money2(r.vat)}; toplam = ${money2(r.gross)}`}
          </Formula>
        </div>
      )}
    </ToolShellLayout>
  );
}

// ---------------------------------------------------------------------------

const PURCHASE_EMPTY: PurchaseRaw = { price: "", deedTotalPct: "4", deedShare: "half", serviceFee: "", commissionPct: "", vatPct: "" };

export function PurchaseCostCalculator() {
  const [raw, setRaw] = useState<PurchaseRaw>(PURCHASE_EMPTY);
  const selId = useId();
  const r = computePurchaseTool(raw);
  const bad = r.status === "invalid" ? r.fields : [];
  return (
    <ToolShellLayout
      resultTitle="Tahmini alım masrafı"
      onReset={() => setRaw(PURCHASE_EMPTY)}
      disclaimer={`${SOFT} Oranları ve tutarları resmi kaynaktan teyit edin.`}
      form={
        <>
          <ToolField label="Satış bedeli" hint="Tapuda görünecek bedel." unit="₺" placeholder="örn. 3.000.000" value={raw.price} invalid={bad.includes("price")} onChange={(v) => setRaw((s) => ({ ...s, price: v }))} />
          <ToolField label="Toplam tapu harcı oranı" hint="Alıcı + satıcı toplamı; güncelliğini resmi kaynaktan teyit edin." unit="%" value={raw.deedTotalPct} invalid={bad.includes("deedTotalPct")} onChange={(v) => setRaw((s) => ({ ...s, deedTotalPct: v }))} />
          <div>
            <label htmlFor={selId} className="block text-sm font-semibold text-ink-950">Harcı kim öder?</label>
            <select id={selId} value={raw.deedShare} onChange={(e) => setRaw((s) => ({ ...s, deedShare: e.target.value === "buyer" ? "buyer" : "half" }))} className={`${INPUT_CLS} mt-1.5 border-line-strong`}>
              <option value="half">Yarı yarıya (alıcı payı hesaplanır)</option>
              <option value="buyer">Tamamını alıcı öder</option>
            </select>
          </div>
          <ToolField label="Tapu hizmet bedeli (isteğe bağlı)" hint="Sabit tutar; boşsa hesaba katılmaz." unit="₺" value={raw.serviceFee} invalid={bad.includes("serviceFee")} onChange={(v) => setRaw((s) => ({ ...s, serviceFee: v }))} />
          <ToolField label="Alıcı komisyon oranı (isteğe bağlı)" hint="Boşsa komisyon hesaba katılmaz." unit="%" value={raw.commissionPct} invalid={bad.includes("commissionPct")} onChange={(v) => setRaw((s) => ({ ...s, commissionPct: v }))} />
          <ToolField label="Komisyon KDV oranı" hint="Komisyon girdiyseniz uygulanır." unit="%" value={raw.vatPct} invalid={bad.includes("vatPct")} onChange={(v) => setRaw((s) => ({ ...s, vatPct: v }))} />
        </>
      }
    >
      {r.status !== "ok" ? (
        <EmptyMsg invalid={r.status === "invalid"} />
      ) : (
        <div className="space-y-4">
          <Big label="Satış bedelinin üstüne yaklaşık masraf">
            <AnimatedNumber value={r.totalCosts} kind="currency" />
          </Big>
          <p className="text-sm tabular-nums text-text-muted">Bedelin yaklaşık %{nf2.format(r.costsPctOfPrice)} kadarı</p>
          <dl className="space-y-2 border-t border-line pt-4 text-sm">
            {r.lines.length === 0 ? <p className="text-text-muted">Hesaplanacak kalem yok.</p> : null}
            {r.lines.map((l) => (
              <Row key={l.key} dt={l.label} dd={money2(l.amount)} />
            ))}
          </dl>
          <p className="text-xs leading-relaxed text-text-muted">DASK, konut sigortası, ekspertiz, kredi masrafları ve yeni bina KDV&apos;si hesaba katılmaz.</p>
        </div>
      )}
    </ToolShellLayout>
  );
}

// ---------------------------------------------------------------------------

const YIELD_EMPTY: YieldRaw = { price: "", monthlyRent: "", yearlyExpenses: "" };

export function RentalYieldCalculator() {
  const [raw, setRaw] = useState<YieldRaw>(YIELD_EMPTY);
  const r = computeRentalYield(raw);
  const bad = r.status === "invalid" ? r.fields : [];
  return (
    <ToolShellLayout
      resultTitle="Tahmini getiri"
      onReset={() => setRaw(YIELD_EMPTY)}
      disclaimer={SOFT}
      form={
        <>
          <ToolField label="Konut fiyatı" hint="Satın alma (veya güncel değer) bedeli." unit="₺" placeholder="örn. 5.000.000" value={raw.price} invalid={bad.includes("price")} onChange={(v) => setRaw((s) => ({ ...s, price: v }))} />
          <ToolField label="Aylık kira" hint="Beklenen aylık kira bedeli." unit="₺" placeholder="örn. 25.000" value={raw.monthlyRent} invalid={bad.includes("monthlyRent")} onChange={(v) => setRaw((s) => ({ ...s, monthlyRent: v }))} />
          <div className="sm:col-span-2">
            <ToolField label="Yıllık giderler (isteğe bağlı)" hint="Aidat, vergi, bakım, boş kalma tahmini; girerseniz net getiri de hesaplanır." unit="₺" value={raw.yearlyExpenses} invalid={bad.includes("yearlyExpenses")} onChange={(v) => setRaw((s) => ({ ...s, yearlyExpenses: v }))} />
          </div>
        </>
      }
    >
      {r.status !== "ok" ? (
        <EmptyMsg invalid={r.status === "invalid"} />
      ) : (
        <div className="space-y-4">
          <Big label="Brüt kira getirisi (yıllık)">
            <AnimatedNumber value={r.grossYieldPct} kind="percent" maximumFractionDigits={2} />
          </Big>
          <dl className="space-y-2 border-t border-line pt-4 text-sm">
            <Row dt="Amortisman süresi (brüt)" dd={`${nf2.format(r.grossPaybackYears)} yıl`} />
            <Row dt="Yıllık kira" dd={money2(r.yearlyRent)} />
            {r.netYieldPct !== null ? <Row dt="Net getiri" dd={`%${nf2.format(r.netYieldPct)}`} /> : null}
            {r.hasExpenses ? <Row dt="Amortisman süresi (net)" dd={r.netPaybackYears !== null ? `${nf2.format(r.netPaybackYears)} yıl` : "Giderler kirayı aşıyor"} /> : null}
          </dl>
          <Formula>
            Brüt getiri = ({formatTry(r.yearlyRent)} yıllık kira ÷ {formatTry(r.price)} fiyat) × 100 = %{nf2.format(r.grossYieldPct)}
          </Formula>
        </div>
      )}
    </ToolShellLayout>
  );
}

// ---------------------------------------------------------------------------

const LOAN_EMPTY: LoanRaw = { amount: "", monthlyRatePct: "", months: "" };

export function LoanCalculator() {
  const [raw, setRaw] = useState<LoanRaw>(LOAN_EMPTY);
  const r = computeLoanTool(raw);
  const bad = r.status === "invalid" ? r.fields : [];
  return (
    <ToolShellLayout
      resultTitle="Tahmini ödeme planı"
      onReset={() => setRaw(LOAN_EMPTY)}
      disclaimer={`Tahmini hesaptır, banka teklifi değildir. ${SOFT}`}
      form={
        <>
          <ToolField label="Kredi tutarı" hint="Çekmek istediğiniz kredi." unit="₺" placeholder="örn. 2.000.000" value={raw.amount} invalid={bad.includes("amount")} onChange={(v) => setRaw((s) => ({ ...s, amount: v }))} />
          <ToolField label="Aylık faiz oranı" hint="Bankanın güncel teklifindeki aylık oran; araç oran önermez." unit="%" value={raw.monthlyRatePct} invalid={bad.includes("monthlyRatePct")} onChange={(v) => setRaw((s) => ({ ...s, monthlyRatePct: v }))} />
          <ToolField label="Vade" hint="Ay cinsinden, tam sayı (örn. 120)." unit="ay" value={raw.months} invalid={bad.includes("months")} onChange={(v) => setRaw((s) => ({ ...s, months: v }))} />
        </>
      }
    >
      {r.status !== "ok" ? (
        <EmptyMsg invalid={r.status === "invalid"} />
      ) : (
        <div className="space-y-4">
          <Big label="Aylık taksit">
            <AnimatedNumber value={r.monthlyPayment} kind="currency" maximumFractionDigits={2} />
          </Big>
          <dl className="space-y-2 border-t border-line pt-4 text-sm">
            <Row dt="Toplam geri ödeme" dd={money2(r.totalPayment)} />
            <Row dt="Toplam faiz" dd={money2(r.totalInterest)} />
            <Row dt="Yıllık nominal oran (aylık × 12)" dd={`%${nf2.format(r.annualRatePct)}`} />
          </dl>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface">
            <table className="w-full text-xs tabular-nums">
              <caption className="p-2 text-left font-semibold text-ink-950">İlk {r.schedule.length} ayın ödeme planı</caption>
              <thead>
                <tr className="border-y border-line text-text-muted">
                  <th scope="col" className="px-2 py-1.5 text-left">Ay</th>
                  <th scope="col" className="px-2 py-1.5 text-right">Taksit</th>
                  <th scope="col" className="px-2 py-1.5 text-right">Anapara</th>
                  <th scope="col" className="px-2 py-1.5 text-right">Faiz</th>
                  <th scope="col" className="px-2 py-1.5 text-right">Kalan</th>
                </tr>
              </thead>
              <tbody>
                {r.schedule.map((row) => (
                  <tr key={row.no} className="border-b border-line last:border-0">
                    <th scope="row" className="px-2 py-1.5 text-left font-medium">{row.no}</th>
                    <td className="px-2 py-1.5 text-right">{nf2.format(row.payment)}</td>
                    <td className="px-2 py-1.5 text-right">{nf2.format(row.principal)}</td>
                    <td className="px-2 py-1.5 text-right">{nf2.format(row.interest)}</td>
                    <td className="px-2 py-1.5 text-right">{nf2.format(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Formula>Taksit = K × i ÷ (1 − (1 + i)^−n); eşit taksitli (anüite). Dosya masrafı, sigorta ve vergiler dahil değildir.</Formula>
        </div>
      )}
    </ToolShellLayout>
  );
}
