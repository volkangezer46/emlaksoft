import { Tag } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listOffers } from "@/app/actions/offers";
import { createClient } from "@/lib/supabase/server";
import { NewOfferDialog } from "./new-offer-dialog";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable, ROW_HREF, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";

const STATUS_LABELS: Record<string, string> = {
  draft:     "Taslak",
  submitted: "Sunuldu",
  countered: "Karşı teklif",
  accepted:  "Kabul edildi",
  rejected:  "Reddedildi",
  withdrawn: "Geri çekildi",
};

/** Durum → tasarım sistemi rozet tonu (ham emerald/red/zinc yerine). */
const STATUS_BADGES: DataTableColumn["badges"] = {
  draft:     { label: STATUS_LABELS.draft,     variant: "default" },
  submitted: { label: STATUS_LABELS.submitted, variant: "info" },
  countered: { label: STATUS_LABELS.countered, variant: "warning" },
  accepted:  { label: STATUS_LABELS.accepted,  variant: "success" },
  rejected:  { label: STATUS_LABELS.rejected,  variant: "danger" },
  withdrawn: { label: STATUS_LABELS.withdrawn, variant: "outline" },
};

const OFFER_COLUMNS: DataTableColumn[] = [
  { key: "property", header: "Portföy", sortable: true },
  { key: "customer", header: "Müşteri", sortable: true },
  { key: "amount", header: "Teklif", format: "money", align: "right", sortable: true },
  { key: "counter", header: "Karşı teklif", format: "money", align: "right", hideBelow: "md" },
  { key: "status", header: "Durum", format: "badge", badges: STATUS_BADGES, sortable: true },
  { key: "created_at", header: "Tarih", format: "date", align: "right", sortable: true },
];

function propertyLabel(p: { property_code: string; title: string | null } | { property_code: string; title: string | null }[] | null) {
  if (!p) return "—";
  const item = Array.isArray(p) ? p[0] : p;
  return item?.title ?? item?.property_code ?? "—";
}

function customerLabel(c: { full_name: string } | { full_name: string }[] | null) {
  if (!c) return "—";
  return Array.isArray(c) ? c[0]?.full_name ?? "—" : c.full_name;
}

export default async function TekliflerPage() {
  const { perms } = await requireModulePage("offers");
  const canCreate = perms.offers?.includes("create") ?? perms.commissions?.includes("create") ?? false;

  const supabase = await createClient();
  const [offers, { data: propData }, { data: custData }] = await Promise.all([
    listOffers(),
    supabase
      .from("properties")
      .select("id, property_code, title, list_price")
      .is("deleted_at", null)
      .in("status", ["live", "draft", "reserved"])
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("customers")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("full_name", { ascending: true })
      .limit(300),
  ]);

  const properties = (propData ?? []).map((p) => ({
    id: p.id,
    property_code: p.property_code as string,
    title: p.title as string | null,
    list_price: p.list_price as number | null,
  }));
  const customers = (custData ?? []).map((c) => ({
    id: c.id,
    full_name: c.full_name as string,
  }));

  const accepted = offers.filter((o) => o.status === "accepted").length;
  const pending  = offers.filter((o) => o.status === "submitted").length;

  // DataTable client bileşenine geçen düz (serileştirilebilir) satırlar
  const offerRows: DataTableRow[] = offers.map((o) => ({
    id:         o.id,
    [ROW_HREF]: `/app/teklifler/${o.id}`,
    property:   propertyLabel(o.property),
    customer:   customerLabel(o.customer),
    amount:     o.amount != null ? Number(o.amount) : null,
    counter:    o.counter_amount != null ? Number(o.counter_amount) : null,
    status:     o.status,
    created_at: o.created_at,
  }));

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Tag className="h-4 w-4" /> Teklif takibi
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Teklifler</h1>
            <p className="mt-1 text-sm text-white/75">Portföylere gelen teklifleri ve durumlarını izleyin.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {[
              { label: "Toplam", value: offers.length },
              { label: "Bekliyor", value: pending },
              { label: "Kabul edildi", value: accepted },
            ].map((k) => (
              <div key={k.label} className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
                <p className="font-display text-2xl font-extrabold text-white">{k.value}</p>
                <p className="text-[10px] text-white/70">{k.label}</p>
              </div>
            ))}
            {canCreate ? <NewOfferDialog properties={properties} customers={customers} /> : null}
          </div>
        </div>
      </section>

      {offers.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="Henüz teklif yok"
          description="Portföylere gelen teklifler burada listelenir. Portföy detayından veya “Yeni teklif” ile ilk teklifi ekleyin."
        />
      ) : (
        <DataTable
          columns={OFFER_COLUMNS}
          rows={offerRows}
          minWidth={700}
          searchPlaceholder="Portföy veya müşteri ara…"
          empty={{ description: "Arama terimini değiştirip tekrar deneyin." }}
        />
      )}
    </div>
  );
}
