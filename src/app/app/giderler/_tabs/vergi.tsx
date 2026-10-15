import Link from "@/components/ui/smart-link";
import { ArrowUpRight, HelpCircle, Landmark, Percent, Receipt, Scale } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { createClient } from "@/lib/supabase/server";
import { now, trDayKey } from "@/lib/clock";
import { formatTry } from "@/lib/format";
import { isMissingCashSchema } from "@/lib/finance/cash/load";
import { countByMonth, monthBounds, vatSummaryRows, vatTotals, type VatSummaryRaw } from "@/lib/finance/expense-budget";
import { FINANCE_PATH, monthLabelOf, type FinanceTabProps } from "./butce";

/** "KDV bilgisi yok" sayacının okuyacağı en çok satır (yalnız tarih sütunu). */
const NO_VAT_SCAN_LIMIT = 5000;

/**
 * Vergi sekmesi (?sekme=vergi&yil=YYYY): aylık KDV özeti (hesaplanan − indirilecek = ödenecek), kesilen ve ödenen stopaj.
 * KDV'si boş eski hareketlere KDV uydurulmaz: "KDV bilgisi yok" sayacına düşer ve tıklanınca filtreli Hareketler açılır.
 * Her sayı aynı kümeyle Hareketler'e gider: KDV tutarları `kdv=var`, stopajlar `stopaj=var` (ledger-filters; ofis hesabı,
 * TL, gelir/gider, tutar sıfırdan farklı). Bilgi amaçlıdır; beyanname yerine geçmez.
 */
export async function VergiTab({ params }: FinanceTabProps) {
  const supabase = await createClient();
  const today = trDayKey(now());
  const thisYear = Number(today.slice(0, 4));
  const yearRaw = Number(params.yil);
  const year = Number.isInteger(yearRaw) && yearRaw >= 2020 && yearRaw <= thisYear + 1 ? yearRaw : thisYear;
  const from = `${year}-01-01`;
  const to = year === thisYear ? today : `${year}-12-31`;

  const [vatRes, noVatRes] = await Promise.all([
    supabase.rpc("finance_vat_summary", { p_from: from, p_to: to }),
    // Eski hareketlerde KDV boş kalır ("bilinmiyor"): gelir/gider hareketleri, iptal ve transfer hariç.
    supabase
      .from("cash_entries")
      .select("entry_date, account:finance_accounts!cash_entries_account_fk!inner(owner_scope)", { count: "exact" })
      .eq("account.owner_scope", "office")
      // KDV özeti RPC'si yalnız TL ve örnek olmayan hareketleri sayar; sayaç da aynı kapsamda olmalı.
      .eq("currency", "TRY")
      .eq("is_sample", false)
      .is("vat_rate", null)
      .is("voided_at", null)
      .in("kind", ["income", "expense"])
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: true })
      .range(0, NO_VAT_SCAN_LIMIT - 1),
  ]);

  if (vatRes.error && isMissingCashSchema(vatRes.error)) {
    return (
      <EmptyState
        icon={Percent}
        title="KDV özeti kurulum bekliyor"
        description="Hareketlere KDV ve stopaj alanları muhasebe güncellemesiyle gelir. Güncelleme uygulanınca aylık KDV özeti burada açılır."
        tone="amber"
      />
    );
  }
  if (vatRes.error) return <Alert tone="warning">KDV özeti şu an yüklenemedi; sayfayı yenileyin.</Alert>;

  const rows = vatSummaryRows((vatRes.data ?? []) as VatSummaryRaw[]);
  const totals = vatTotals(rows);
  const noVatByMonth = noVatRes.error ? new Map<string, number>() : countByMonth(((noVatRes.data ?? []) as { entry_date: string }[]).map((r) => r.entry_date));
  const noVatTotal = noVatRes.error ? 0 : (noVatRes.count ?? 0);
  const months = [...new Set([...rows.map((r) => r.month), ...noVatByMonth.keys()])].sort().reverse();
  const byMonth = new Map(rows.map((r) => [r.month, r]));

  const tabHref = (y: number) => `${FINANCE_PATH}?sekme=vergi${y === thisYear ? "" : `&yil=${y}`}`;
  const entriesHref = (f: string, t: string, extra = "") => `${FINANCE_PATH}?sekme=hareketler&from=${f}&to=${t}${extra}`;
  // `kdv=yok` (ledger-filters): ofis hesabı, origin=entry, vat_rate boş, gelir/gider, TL, örnek değil — sayaçla aynı küme.
  const noVatHref = (f: string, t: string) => entriesHref(f, t, "&kdv=yok");
  // `kdv=var` / `stopaj=var`: finance_vat_summary'nin topladığı satırlar (ofis hesabı, TL, gelir/gider, tutar ≠ 0).
  // Hesaplanan KDV'nin komisyon payı komisyon kaydından (Komisyonlar) gelir; Hareketler listesinde yer almaz.
  const vatHref = (f: string, t: string, tur = "") => entriesHref(f, t, `&kdv=var${tur ? `&tur=${tur}` : ""}`);
  const whHref = (f: string, t: string, tur: "gelir" | "gider") => entriesHref(f, t, `&stopaj=var&tur=${tur}`);

  const kpis: KpiItem[] = [
    { label: "Hesaplanan KDV", value: formatTry(totals.outputVat), icon: <Receipt />, tone: "info", href: vatHref(from, to, "gelir"), hint: `${year} · satışlar` },
    { label: "İndirilecek KDV", value: formatTry(totals.inputVat), icon: <Scale />, tone: "success", href: vatHref(from, to, "gider"), hint: `${year} · alışlar` },
    {
      label: totals.payable >= 0 ? "Ödenecek KDV" : "Devreden KDV",
      value: formatTry(Math.abs(totals.payable)),
      icon: <Landmark />,
      tone: totals.payable > 0 ? "warning" : "neutral",
      href: vatHref(from, to),
      hint: "hesaplanan − indirilecek",
    },
    { label: "KDV bilgisi yok", value: noVatTotal, icon: <HelpCircle />, tone: noVatTotal > 0 ? "warning" : "neutral", href: noVatHref(from, to), hint: "eski / eksik hareket", attention: noVatTotal > 0 },
  ];

  return (
    <div className="grid gap-5">
      <nav aria-label="Vergi yılı" className="flex flex-wrap items-center gap-2">
        {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
          <FilterChip key={y} href={tabHref(y)} active={y === year}>
            {y}
          </FilterChip>
        ))}
      </nav>

      <Alert tone="info" title="Bilgi amaçlıdır">
        Tutarlar hareketlere girilen KDV ve stopaj oranlarından hesaplanır; beyanname yerine geçmez. Beyan öncesi mali müşavirinizle doğrulayın.
      </Alert>

      <KpiStrip items={kpis} label="KDV özeti" />

      {noVatTotal > 0 ? (
        <Alert
          tone="warning"
          action={
            <Link href={noVatHref(from, to)} className="font-semibold underline">
              Hareketleri aç
            </Link>
          }
        >
          {noVatTotal} hareketin KDV bilgisi yok (eski kayıtlar ya da oran seçilmeden girilenler). Bunlar özete katılmaz; düzeltmek için listeden hareketi açıp “Düzenle” sayfasında KDV oranını seçin.
        </Alert>
      ) : null}

      {months.length === 0 ? (
        <EmptyState
          icon={Percent}
          title={`${year} için KDV'li hareket yok`}
          description="Yeni kayıt sayfasında KDV oranını (%1, %10, %20) seçtiğiniz gelir ve giderler burada aylık olarak toplanır."
          tone="brand"
          variant="compact"
        />
      ) : (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Aylık KDV ve stopaj</CardTitle>
              <CardDescription>Satıra tıklayınca o ayın hareketleri açılır. Eksi ödenecek, sonraki aya devreden KDV&apos;dir.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <caption className="sr-only">Aylık KDV ve stopaj özeti</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">
                    <th scope="col" className="px-3 py-2">Ay</th>
                    <th scope="col" className="px-3 py-2 text-right">Hesaplanan</th>
                    <th scope="col" className="px-3 py-2 text-right">İndirilecek</th>
                    <th scope="col" className="px-3 py-2 text-right">Ödenecek</th>
                    <th scope="col" className="px-3 py-2 text-right">Kesilen stopaj</th>
                    <th scope="col" className="px-3 py-2 text-right">Ödenen stopaj</th>
                    <th scope="col" className="px-3 py-2 text-right">KDV bilgisi yok</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => {
                    const r = byMonth.get(m);
                    const b = monthBounds(m);
                    const href = entriesHref(b.from, b.to);
                    const missing = noVatByMonth.get(m) ?? 0;
                    return (
                      <tr key={m} className="group border-b border-line last:border-b-0 hover:bg-surface-hover/40">
                        <td className="px-3 py-2.5">
                          <Link href={href} className="focus-ring inline-flex items-center gap-1 rounded font-semibold capitalize text-text hover:underline">
                            {monthLabelOf(m)}
                            <ArrowUpRight className="h-3 w-3 text-text-faint opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
                          </Link>
                        </td>
                        <td className="numeric px-3 py-2.5 text-right">
                          <Link href={vatHref(b.from, b.to, "gelir")} className="hover:underline">{formatTry(r?.outputVat ?? 0)}</Link>
                        </td>
                        <td className="numeric px-3 py-2.5 text-right">
                          <Link href={vatHref(b.from, b.to, "gider")} className="hover:underline">{formatTry(r?.inputVat ?? 0)}</Link>
                        </td>
                        <td className={`numeric px-3 py-2.5 text-right font-bold ${(r?.payable ?? 0) > 0 ? "text-warning-strong" : "text-text-muted"}`}>
                          <Link href={vatHref(b.from, b.to)} className="hover:underline">{formatTry(r?.payable ?? 0)}</Link>
                        </td>
                        <td className="numeric px-3 py-2.5 text-right">
                          <Link href={whHref(b.from, b.to, "gelir")} className="hover:underline">{formatTry(r?.withholdingCollected ?? 0)}</Link>
                        </td>
                        <td className="numeric px-3 py-2.5 text-right">
                          <Link href={whHref(b.from, b.to, "gider")} className="hover:underline">{formatTry(r?.withholdingPaid ?? 0)}</Link>
                        </td>
                        <td className="numeric px-3 py-2.5 text-right">
                          {missing > 0 ? (
                            <Link href={noVatHref(b.from, b.to)} className="font-semibold text-warning-strong hover:underline">
                              {missing}
                            </Link>
                          ) : (
                            <span className="text-text-faint">0</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-strong text-xs font-semibold text-text">
                    <th scope="row" className="px-3 py-2 text-left">{year} toplam</th>
                    <td className="numeric px-3 py-2 text-right">
                      <Link href={vatHref(from, to, "gelir")} className="hover:underline">{formatTry(totals.outputVat)}</Link>
                    </td>
                    <td className="numeric px-3 py-2 text-right">
                      <Link href={vatHref(from, to, "gider")} className="hover:underline">{formatTry(totals.inputVat)}</Link>
                    </td>
                    <td className="numeric px-3 py-2 text-right">
                      <Link href={vatHref(from, to)} className="hover:underline">{formatTry(totals.payable)}</Link>
                    </td>
                    <td className="numeric px-3 py-2 text-right">
                      <Link href={whHref(from, to, "gelir")} className="hover:underline">{formatTry(totals.withholdingCollected)}</Link>
                    </td>
                    <td className="numeric px-3 py-2 text-right">
                      <Link href={whHref(from, to, "gider")} className="hover:underline">{formatTry(totals.withholdingPaid)}</Link>
                    </td>
                    <td className="numeric px-3 py-2 text-right">
                      <Link href={noVatHref(from, to)} className="hover:underline">{noVatTotal}</Link>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-text-faint">
              Hesaplanan KDV: satış/gelir hareketlerindeki KDV. İndirilecek KDV: alış/gider hareketlerindeki KDV. Kesilen stopaj: müşterinin tahsilatınızdan
              kestiği; ödenen stopaj: sizin kira gibi ödemelerden kesip vergi dairesine yatırdığınız tutardır. Hesaplanan KDV&apos;nin
              komisyon payı komisyon kaydından ve kayıt tarihine göre sayılır; Hareketler listesinde yer almaz. Vadeli faturalar (açık kalem) KDV&apos;si
              düzenleme ayında sayılır (KDVK md.10); sonraki tahsilat ya da ödemeler aynı KDV&apos;yi ikinci kez saymaz.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
