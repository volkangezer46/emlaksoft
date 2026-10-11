import Link from "@/components/ui/smart-link";
import { ExternalLink, Scale } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/badge";
import { EmptyStateV3 } from "@/components/ui/empty-state";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { loadOwnerFinance } from "@/lib/property-management/load";
import { loadInvoiceButtonContext } from "@/lib/integrations/einvoice/service";
import { InvoiceCutButton } from "@/components/app/einvoice/invoice-cut-button";
import { OWNER_BALANCE_NOTE, balanceLabel } from "@/lib/property-management/ledger";
import { AgreementCard, ChargeLinksPanel, PayoutPanel } from "./owner-panels";

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const monthTitle = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);

/**
 * Kira detayı › Mülk sahibi sekmesi: yönetim sözleşmesi, hakediş defteri (aylık), mülk sahibine ödemeler, gider/aidat yansıtma.
 * Yalnız `rentals:edit` olanlara çizilir (sözleşme IBAN içerir; RLS de aynı kapıdadır). Bakiye kayıtlardan türer, saklanmaz.
 */
export async function OwnerTab({
  supabase,
  tenantId,
  rentalId,
  propertyId,
  today,
  canEdit,
  canDelete,
  canInvoice = false,
}: {
  supabase: SupabaseClient;
  tenantId: string;
  rentalId: string;
  propertyId: string | null;
  today: string;
  canEdit: boolean;
  canDelete: boolean;
  /** commissions.create: yönetim ücreti satırlarında "Fatura kes" (e-Fatura bağlantısı yoksa "e-Fatura'yı bağla"). */
  canInvoice?: boolean;
}) {
  const fin = await loadOwnerFinance(supabase, { tenantId, rentalId, propertyId });
  if (!fin.available) {
    return (
      <EmptyStateV3
        variant="compact"
        title="Mülk sahibi hakedişi henüz etkin değil."
        description="Bu özellik için veritabanı güncellemesi uygulanmamış. Uygulandığında yönetim sözleşmesi, hakediş defteri ve mülk sahibi ödemeleri burada görünür."
      />
    );
  }
  const { agreement, ledger } = fin;
  const managed = agreement?.managed === true;
  const t = ledger.totals;
  // Yönetim ücreti faturası: kaynak = tahsilat kaydı (rent_payments.id; defter satırı kimliği "fee:<id>").
  const feeEntries = [...ledger.entries].filter((e) => e.kind === "fee").reverse();
  const invoiceCtx = managed && feeEntries.length > 0
    ? await loadInvoiceButtonContext(supabase, canInvoice, "rent_management_fee", feeEntries.map((e) => e.id.slice(4)))
    : null;

  return (
    <div className="space-y-4">
      <AgreementCard rentalId={rentalId} agreement={agreement} canEdit={canEdit} />

      {managed ? (
        <>
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                <Scale className="h-4 w-4 text-brand-600" /> Hakediş defteri
              </h2>
              {propertyId ? (
                <Link
                  href={`/app/portfoyler/${propertyId}?sekme=portallar`}
                  className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] text-xs font-semibold text-brand-600 hover:underline"
                >
                  Ekstreyi malik portalında paylaş <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </Link>
              ) : null}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { l: "Tahsil edilen kira", v: t.collected, tone: "text-mint-600" },
                { l: "Yönetim ücreti", v: -t.fee, tone: "text-ink-950" },
                { l: "Gider & aidat", v: -(t.expenses + t.dues), tone: "text-ink-950" },
                { l: "Ödenen", v: -t.paidOut, tone: "text-ink-950" },
                { l: balanceLabel(t.balance), v: t.balance, tone: t.balance > 0 ? "text-amber-700" : t.balance < 0 ? "text-danger-600" : "text-ink-950" },
              ].map((k) => (
                <div key={k.l} className="rounded-[var(--radius-card)] border border-line bg-canvas p-3">
                  <dt className="text-xs text-text-muted">{k.l}</dt>
                  <dd className={`numeric mt-0.5 font-bold ${k.tone}`}>{money(k.v)}</dd>
                </div>
              ))}
            </dl>

            {ledger.months.length === 0 ? (
              <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong p-5 text-center text-sm text-text-muted">
                Henüz tahsilat yok. Tahakkuk &amp; tahsilat sekmesinden “Ödeme al” ile kira tahsil edildikçe hakediş satırları oluşur.
              </p>
            ) : (
              <div className="mt-4">
                <TableFrame stack minWidth={640}>
                  <Table>
                    <caption className="sr-only">Aylık hakediş defteri</caption>
                    <THead>
                      <TR>
                        <TH>Dönem</TH>
                        <TH align="right">Tahsilat</TH>
                        <TH align="right">Ücret</TH>
                        <TH align="right">Gider/aidat</TH>
                        <TH align="right">Hakediş</TH>
                        <TH align="right">Ödenen</TH>
                        <TH align="right">Bakiye</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {[...ledger.months].reverse().map((m) => (
                        <TR key={m.month}>
                          <TD primary className="font-semibold text-ink-950">{monthTitle(m.month)}</TD>
                          <TD label="Tahsilat" align="right" className="numeric">{money(m.collected)}</TD>
                          <TD label="Ücret" align="right" className="numeric">{money(m.fee)}</TD>
                          <TD label="Gider/aidat" align="right" className="numeric">{money(m.expenses + m.dues)}</TD>
                          <TD label="Hakediş" align="right" className="numeric font-bold text-ink-950">{money(m.entitlement)}</TD>
                          <TD label="Ödenen" align="right" className="numeric">{money(m.paidOut)}</TD>
                          <TD label="Bakiye" align="right" className="numeric font-bold">
                            {money(m.closing)}
                            {m.closing < 0 ? <Badge variant="danger" size="sm" className="ml-1">alacak</Badge> : null}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableFrame>
              </div>
            )}
            <p className="mt-3 text-xs text-text-muted">{OWNER_BALANCE_NOTE}</p>
          </section>

          {invoiceCtx?.canInvoice ? (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <h2 className="font-display font-bold text-ink-950">Yönetim ücreti faturaları</h2>
              <p className="mt-1 text-xs text-text-muted">Her tahsilattan kesilen yönetim ücreti için e-Fatura kesin; kesilmişse faturaya gidin.</p>
              <TableFrame stack minWidth={480} className="mt-3">
                <Table>
                  <caption className="sr-only">Yönetim ücreti faturaları</caption>
                  <THead>
                    <TR>
                      <TH>Tarih</TH>
                      <TH align="right">Ücret</TH>
                      <TH align="right">Fatura</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {feeEntries.map((e) => (
                      <TR key={e.id}>
                        <TD primary className="font-semibold text-ink-950">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(`${e.date}T00:00:00`))}</TD>
                        <TD label="Ücret" align="right" className="numeric">{money(Math.abs(e.signed))}</TD>
                        <TD label="Fatura" align="right">
                          <InvoiceCutButton ctx={invoiceCtx} sourceId={e.id.slice(4)} kaynak="kira_ucret" />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableFrame>
            </section>
          ) : null}

          <PayoutPanel rentalId={rentalId} today={today} payable={ledger.payable} payouts={fin.payouts} canEdit={canEdit} canDelete={canDelete} />
          <ChargeLinksPanel rentalId={rentalId} candidates={fin.candidates} canEdit={canEdit} />
        </>
      ) : null}
    </div>
  );
}
