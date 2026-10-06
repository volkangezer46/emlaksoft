"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Banknote, Info } from "lucide-react";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { LegalConstantsPanel } from "@/components/app/legal-constants-panel";
import { computeSellerProceeds, type SellerDeedFeeShare } from "@/lib/seller-proceeds";
import { describeBracketTable, describeLegalMany } from "@/lib/legal-constants";
import { formatTry } from "@/lib/purchase-costs";

export type SellerInitial = {
  salePrice: number;
  acquisitionPrice: number;
  holdingMonths: number;
};

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });

/** "1.250.000" / "1250000 ₺" → 1250000. Boş/çöp girdi 0 döner. */
function parseNumber(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function money(n: number): string {
  return n > 0 ? nf.format(n) : "";
}

const TAHMINI = (
  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-700">Tahmini</span>
);

/**
 * Satıcı net hesaplayıcı: satış bedeli, alış bedeli, elde tutma süresi, değer artış kazancı vergisi,
 * satıcı harcı ve komisyon → satıcının eline geçen. Sabitler `legal-constants` tek kaynağından; her sonuç
 * "Tahmini" etiketli ve kullanılan sabitler doğrulama rozetiyle listelenir.
 */
export function SellerCalculator({ initial }: { initial: SellerInitial }) {
  const [salePrice, setSalePrice] = useState(money(initial.salePrice));
  const [acquisition, setAcquisition] = useState(money(initial.acquisitionPrice));
  const [months, setMonths] = useState(initial.holdingMonths > 0 ? String(initial.holdingMonths) : "");
  const [expenses, setExpenses] = useState("");
  const [ufe, setUfe] = useState("");
  const [commission, setCommission] = useState("");
  const [deedShare, setDeedShare] = useState<SellerDeedFeeShare>("half");
  const [loan, setLoan] = useState("");
  const [usedExemption, setUsedExemption] = useState("");
  const [otherIncome, setOtherIncome] = useState("");

  const result = useMemo(
    () =>
      computeSellerProceeds({
        salePrice: parseNumber(salePrice),
        acquisitionPrice: parseNumber(acquisition),
        holdingMonths: Number(months) || 0,
        acquisitionExpenses: parseNumber(expenses),
        ufeIncreasePct: ufe === "" ? null : Number(ufe.replace(",", ".")),
        commissionPct: commission === "" ? null : Number(commission.replace(",", ".")),
        deedFeeShare: deedShare,
        outstandingLoan: parseNumber(loan),
        exemptionAlreadyUsed: parseNumber(usedExemption),
        otherTaxableIncome: parseNumber(otherIncome),
      }),
    [salePrice, acquisition, months, expenses, ufe, commission, deedShare, loan, usedExemption, otherIncome],
  );

  const legalItems = useMemo(
    () => [
      ...describeLegalMany(result.usedConstants),
      ...(result.usedTables.includes("income_tax") ? [describeBracketTable("income_tax")] : []),
      ...(result.usedTables.includes("dkv") ? [describeBracketTable("dkv")] : []),
    ],
    [result.usedConstants, result.usedTables],
  );

  const moneyInput = (value: string, set: (v: string) => void, id: string, placeholder?: string) => (
    <FormInput
      id={id}
      inputMode="numeric"
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        const n = parseNumber(e.target.value);
        set(n > 0 ? nf.format(n) : "");
      }}
    />
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="font-display text-sm font-extrabold text-ink-950">Satış bilgileri</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Satış bedeli (₺)" htmlFor="sp-sale">
              {moneyInput(salePrice, setSalePrice, "sp-sale", "ör. 5.000.000")}
            </FormField>
            <FormField label="Alış bedeli (₺)" htmlFor="sp-buy" hint="Tapudaki edinme bedeli.">
              {moneyInput(acquisition, setAcquisition, "sp-buy", "ör. 3.000.000")}
            </FormField>
            <FormField label="Elde tutma süresi (ay)" htmlFor="sp-months" hint="60 ay (5 yıl) ve üstünde değer artış kazancı vergisi çıkmaz.">
              <FormInput
                id="sp-months"
                inputMode="numeric"
                placeholder="ör. 36"
                value={months}
                onChange={(e) => setMonths(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
              />
            </FormField>
            <FormField label="Edinme/iyileştirme giderleri (₺)" htmlFor="sp-exp" hint="Alış harcı, tadilat vb.; kazançtan düşülür.">
              {moneyInput(expenses, setExpenses, "sp-exp")}
            </FormField>
            <FormField label="Yİ-ÜFE artışı (%)" htmlFor="sp-ufe" hint="İsteğe bağlı. Eşiği aşarsa alış bedeli endekslenir; oranı TÜİK'ten alın.">
              <FormInput id="sp-ufe" inputMode="decimal" placeholder="ör. 45" value={ufe} onChange={(e) => setUfe(e.target.value.replace(/[^\d.,]/g, "").slice(0, 6))} />
            </FormField>
            <FormField label="Satıcı komisyonu (%, KDV hariç)" htmlFor="sp-comm" hint="Boşsa tavanın yarısı varsayılır.">
              <FormInput id="sp-comm" inputMode="decimal" placeholder="2" value={commission} onChange={(e) => setCommission(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))} />
            </FormField>
            <FormField label="Tapu harcı paylaşımı" htmlFor="sp-deed">
              <FormSelect id="sp-deed" value={deedShare} onChange={(e) => setDeedShare(e.target.value as SellerDeedFeeShare)}>
                <option value="half">Kanuni: satıcı yarısı</option>
                <option value="seller">Tamamı satıcıda</option>
                <option value="none">Satıcıda harç yok (alıcı öder)</option>
              </FormSelect>
            </FormField>
            <FormField label="Kalan kredi / ipotek (₺)" htmlFor="sp-loan">
              {moneyInput(loan, setLoan, "sp-loan")}
            </FormField>
            <FormField label="Bu yıl kullanılan istisna (₺)" htmlFor="sp-used" hint="Aynı yıl başka satışlarda kullanıldıysa.">
              {moneyInput(usedExemption, setUsedExemption, "sp-used")}
            </FormField>
            <FormField label="Diğer gelir vergisi matrahı (₺)" htmlFor="sp-other" hint="İsteğe bağlı. Vergi dilimini yükseltir.">
              {moneyInput(otherIncome, setOtherIncome, "sp-other")}
            </FormField>
          </div>
        </section>

        <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]" aria-live="polite">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-sm font-extrabold text-ink-950">
              <Banknote className="h-4 w-4 text-brand-600" aria-hidden /> Satıcının eline geçen
            </h2>
            {TAHMINI}
          </div>
          <p className="font-display text-3xl font-extrabold tabular-nums text-ink-950">{formatTry(result.netProceeds)}</p>
          <p className="text-xs text-text-muted">
            Vergi öncesi: {formatTry(result.netBeforeTax)} · Tahmini vergi: {formatTry(result.incomeTax)}
          </p>

          <dl className="divide-y divide-line text-sm">
            <div className="flex justify-between py-2">
              <dt className="text-text-muted">Satış bedeli</dt>
              <dd className="font-semibold tabular-nums">{formatTry(result.salePrice)}</dd>
            </div>
            {result.lines.map((l) => (
              <div key={l.key} className="py-2">
                <div className="flex justify-between gap-3">
                  <dt className="text-text-muted">− {l.label}</dt>
                  <dd className="font-semibold tabular-nums">{formatTry(l.amount)}</dd>
                </div>
                <p className="mt-0.5 text-xs text-text-faint">{l.note}</p>
              </div>
            ))}
            <div className="flex justify-between py-2">
              <dt className="font-bold text-ink-950">Net (tahmini)</dt>
              <dd className="font-bold tabular-nums">{formatTry(result.netProceeds)}</dd>
            </div>
          </dl>

          {result.withinTaxWindow ? (
            <p className="rounded-[var(--radius-card)] bg-canvas px-3 py-2 text-xs text-text-muted">
              Değer artış kazancı {formatTry(result.gain)} · istisna {formatTry(result.exemptionApplied)} · vergiye tabi{" "}
              {formatTry(result.taxableGain)} (endekslenmiş maliyet {formatTry(result.indexedAcquisitionCost)})
            </p>
          ) : null}

          {result.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/[0.07] px-3 py-2 text-xs text-text-muted">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden /> {w}
            </p>
          ))}
          {result.notes.map((n) => (
            <p key={n} className="flex items-start gap-2 text-xs text-text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden /> {n}
            </p>
          ))}
        </section>
      </div>

      <p className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-text-muted">
        <strong className="text-ink-950">Tahminidir; mali müşavirlik değildir.</strong> Satıcının vergi durumu kişiye özeldir
        (diğer gelirler, miras/bağış, önceki istisna kullanımı, endeksleme). Değerli konut vergisi yalnız bilgi uyarısıdır.
        Kesin tutar için mali müşavirinize ve ilgili tapu müdürlüğüne danışın. Alıcı tarafı masrafları için{" "}
        <Link href="/app/hesaplayici" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
          Alım maliyeti &amp; kredi
        </Link>{" "}
        sekmesine bakın; ikisi aynı yasal sabitleri kullanır.
      </p>

      <LegalConstantsPanel items={legalItems} />
    </div>
  );
}
