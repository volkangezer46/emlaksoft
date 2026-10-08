import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@/components/ui/smart-link";
import { Scale } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FormField, FormSelect } from "@/components/ui/form-controls";
import { Button } from "@/components/ui/button";
import { CARI_NOTE, cariBalanceLabel } from "@/lib/building-management/unit-ledger";
import { PAYER_LABELS } from "@/lib/building-management/charges";
import { loadUnitCari, loadUnitOptions } from "@/lib/building-management/load";

const money = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(n);
const dayLabel = (iso: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(`${iso.slice(0, 10)}T00:00:00`));

/** "Daire cari" sekmesi: borç-alacak ekstresi (tahakkuk borç, tahsilat alacak, kümülatif bakiye). */
export async function CariTab({ db, tenantId, daireId }: { db: SupabaseClient; tenantId: string; daireId: string }) {
  const [options, data] = await Promise.all([
    loadUnitOptions(db, tenantId),
    daireId ? loadUnitCari(db, { tenantId, unitId: daireId }) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-5">
      <form action="/app/aidat" className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <input type="hidden" name="sekme" value="cari" />
        <FormField label="Daire" htmlFor="cari-daire" className="min-w-64 flex-1">
          <FormSelect id="cari-daire" name="daire" defaultValue={daireId}>
            <option value="">Daire seçin…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.buildingName} · {o.label}</option>)}
          </FormSelect>
        </FormField>
        <Button type="submit" size="sm">Ekstreyi göster</Button>
      </form>

      {!daireId ? (
        <EmptyState icon={Scale} title="Bir daire seçin" description="Cari ekstre, seçilen dairenin tahakkuk (borç) ve tahsilat (alacak) hareketlerini kümülatif bakiyeyle gösterir." />
      ) : !data ? (
        <EmptyState icon={Scale} title="Daire bulunamadı" description="Daire silinmiş ya da bu ofise ait olmayabilir." />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link href={`/app/aidat?sekme=binalar&bina=${data.building.id}&bolum=tahsilat`} className="text-xs font-semibold text-brand-600 hover:underline">← {data.building.name}</Link>
              <h2 className="mt-1 font-display text-xl font-extrabold text-ink-950">{data.building.name} · {data.unit.label}</h2>
              <p className="text-xs text-text-muted">
                Malik: {data.unit.ownerName ?? "—"} · Kiracı: {data.unit.tenantName ?? "—"} · Aidatı ödeyen: {PAYER_LABELS[data.unit.payer]}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { l: "Tahakkuk", v: data.cari.totals.charged },
                { l: "Tahsilat", v: data.cari.totals.paid },
                { l: cariBalanceLabel(data.cari.totals.balance), v: data.cari.totals.balance },
              ].map((k) => (
                <div key={k.l} className="rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2">
                  <p className="text-xs text-text-muted">{k.l}</p>
                  <p className="numeric font-bold text-ink-950">{money(k.v)}</p>
                </div>
              ))}
            </div>
          </div>

          {!data.cari.hasData ? (
            <EmptyState icon={Scale} title="Bu dairede henüz hareket yok" description="Dönem aidatı tahakkuk ettirildiğinde ya da gider paylaştırıldığında burada görünür." />
          ) : (
            <TableFrame minWidth={680}>
              <Table>
                <THead>
                  <TR><TH>Tarih</TH><TH>Açıklama</TH><TH align="right">Borç</TH><TH align="right">Alacak</TH><TH align="right">Bakiye</TH></TR>
                </THead>
                <TBody>
                  {data.cari.entries.map((e) => (
                    <TR key={e.id}>
                      <TD>{dayLabel(e.date)}</TD>
                      <TD>{e.label}</TD>
                      <TD align="right">{e.debit > 0 ? money(e.debit) : ""}</TD>
                      <TD align="right"><span className="text-mint-700">{e.credit > 0 ? money(e.credit) : ""}</span></TD>
                      <TD align="right"><span className="font-semibold text-ink-950">{money(e.balance)}</span></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableFrame>
          )}
          <p className="text-xs text-text-faint">{CARI_NOTE}</p>
        </div>
      )}
    </div>
  );
}
