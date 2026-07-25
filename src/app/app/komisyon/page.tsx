import {
  Banknote,
  CheckCircle2,
  Clock3,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { exportCommissionsCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { CommissionSimulator } from "./commission-simulator";
import { CommissionActions } from "./commission-actions";
import { CommissionSplitEditor } from "./commission-split-editor";
import { ListLimitNotice } from "@/components/app/list-limit-notice";

type CommissionRow = {
  id: string;
  gross_amount: number;
  vat_amount: number;
  status: string;
  splits: { label?: string; amount?: number; rate?: number }[] | null;
  created_at: string;
  deal: {
    deal_value: number | null;
    stage: string;
    property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  } | {
    deal_value: number | null;
    stage: string;
    property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  }[] | null;
};

function money(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
}

function dealOf(value: CommissionRow["deal"]) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CommissionPage() {
  const { perms } = await requireModulePage("commissions");
  const canEdit = (perms.commissions ?? []).includes("edit");
  const supabase = await createClient();
  const { data, count: commissionTotal } = await supabase
    .from("commissions")
    .select(
      "id, gross_amount, vat_amount, status, splits, created_at, deal:deals(deal_value,stage,property:properties(id,property_code,title))",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as CommissionRow[];
  const total = rows.reduce((sum, row) => sum + Number(row.gross_amount), 0);
  const paid = rows.filter((row) => row.status === "paid" || row.status === "collected").reduce((sum, row) => sum + Number(row.gross_amount), 0);
  const pending = total - paid;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-amber-400/20 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-amber-400"><Banknote className="h-4 w-4" /> Finans merkezi</span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Komisyon & hakediş</h1>
          <p className="mt-1 text-sm text-white/60">Çok taraflı paylaşım, KDV ve tahsilat görünümü tek defterde.</p>
        </div>
        <div className="relative mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "Toplam komisyon", value: money(total), icon: Wallet, tone: "text-cyan-400" },
            { label: "Tahsil edilen", value: money(paid), icon: CheckCircle2, tone: "text-mint-400" },
            { label: "Bekleyen", value: money(pending), icon: Clock3, tone: "text-amber-400" },
          ].map((item) => (
            <div key={item.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
              <item.icon className={`h-4 w-4 ${item.tone}`} />
              <p className="mt-2 truncate font-display text-lg font-extrabold text-white md:text-xl">{item.value}</p>
              <p className="text-[10px] text-white/45 sm:text-xs">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <CommissionSimulator />

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div><p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><ReceiptText className="h-4 w-4" /> Gerçek kayıtlar</p><h2 className="mt-1 font-display font-bold text-ink-950">Komisyon defteri</h2></div>
          <div className="flex items-center gap-2">
            <ExportCsvButton action={exportCommissionsCsv} label="Dışa aktar" />
            <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[10px] font-bold text-brand-600">{rows.length} kayıt</span>
          </div>
        </div>
        {/* Defter 100 kayitla sinirli; "N kayit" rozeti CEKILEN kumeyi
            sayiyordu, gercek toplami degil. Para tutan bir listede bunun
            sessiz kalmasi ozellikle kotu. */}
        <div className="px-5 pt-3">
          <ListLimitNotice
            shown={rows.length}
            total={commissionTotal}
            hint="Tam döküm için dışa aktarım kullanın."
          />
        </div>
        {rows.length === 0 ? (
          <div className="grid place-items-center px-6 py-14 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-amber-400/12 text-amber-500"><Wallet className="h-7 w-7" /></span>
            <h3 className="mt-4 font-display text-lg font-bold text-ink-950">Henüz komisyon kaydı yok</h3>
            <p className="mt-1 max-w-md text-sm text-text-muted">Kapanan anlaşmalardan oluşan komisyon ve hakediş kayıtları burada izlenecek.</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((row) => {
              const deal = dealOf(row.deal);
              const property = deal ? (Array.isArray(deal.property) ? deal.property[0] : deal.property) : null;
              return (
                <article key={row.id} className="group relative grid gap-3 px-5 py-4 transition hover:bg-brand-600/[0.02] md:grid-cols-[1.4fr_.7fr_.7fr_auto] md:items-center">
                  {property?.id ? (
                    <Link href={`/app/portfoyler/${property.id}`} className="absolute inset-0" aria-label={`${property.title ?? property.property_code ?? "Komisyon"} portföyü`} />
                  ) : null}
                  <div><p className="text-sm font-semibold text-ink-950">{property?.title ?? "Komisyon kaydı"}</p><p className="mt-0.5 text-xs text-text-muted">{property?.property_code ?? "Genel işlem"} · {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(row.created_at))}</p></div>
                  <div>
                    <p className="text-[10px] text-text-faint">Brüt komisyon</p>
                    <p className="font-display text-sm font-bold text-ink-950">{money(Number(row.gross_amount))}</p>
                    {Array.isArray(row.splits) && row.splits.length > 0 ? (
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-text-muted">
                        {row.splits.map((s, i) => (
                          <span key={i}>{s.label} %{s.rate}{i < row.splits!.length - 1 ? " ·" : ""}</span>
                        ))}
                      </p>
                    ) : null}
                  </div>
                  <div><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${row.status === "paid" || row.status === "collected" ? "bg-mint-500/10 text-mint-600" : "bg-amber-400/15 text-amber-500"}`}>{row.status === "paid" || row.status === "collected" ? "Tahsil edildi" : "Hesaplandı"}</span></div>
                  {canEdit ? (
                    <div className="relative z-10 flex flex-col items-end gap-1.5">
                      <CommissionSplitEditor commissionId={row.id} gross={Number(row.gross_amount)} initial={row.splits} />
                      <CommissionActions commissionId={row.id} amount={Number(row.gross_amount)} status={row.status} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-line bg-canvas/60 px-5 py-3 text-[10px] font-semibold text-mint-600"><TrendingUp className="h-3.5 w-3.5" /> Tüm hesaplamalar denetim iziyle saklanır</div>
      </section>
    </div>
  );
}
