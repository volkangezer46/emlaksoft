import { Tag, CheckCircle2, XCircle, Clock } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listOffers } from "@/app/actions/offers";
import { createClient } from "@/lib/supabase/server";
import { NewOfferDialog } from "./new-offer-dialog";

const STATUS_LABELS: Record<string, string> = {
  draft:     "Taslak",
  submitted: "Sunuldu",
  countered: "Karşı teklif",
  accepted:  "Kabul edildi",
  rejected:  "Reddedildi",
  withdrawn: "Geri çekildi",
};

function money(n: number | null) {
  if (!n) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

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
          <div className="flex gap-3">
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
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        {offers.length === 0 ? (
          <p className="py-16 text-center text-sm text-text-muted">Henüz teklif yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b border-line bg-canvas/80 text-text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">Portföy</th>
                  <th className="px-4 py-3 font-semibold">Müşteri</th>
                  <th className="px-4 py-3 font-semibold">Teklif</th>
                  <th className="px-4 py-3 font-semibold">Karşı teklif</th>
                  <th className="px-4 py-3 font-semibold">Durum</th>
                  <th className="px-4 py-3 font-semibold">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => {
                  const statusStyle: Record<string, string> = {
                    accepted: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
                    rejected: "bg-red-50 text-red-700 ring-red-600/20",
                    submitted: "bg-blue-50 text-blue-700 ring-blue-600/20",
                    countered: "bg-amber-50 text-amber-700 ring-amber-600/20",
                    draft: "bg-zinc-100 text-zinc-600 ring-zinc-500/10",
                    withdrawn: "bg-zinc-50 text-zinc-500 ring-zinc-400/10",
                  };
                  return (
                    <tr key={o.id} className="border-b border-line last:border-0 hover:bg-canvas/40">
                      <td className="px-5 py-3 font-semibold text-ink-950">{propertyLabel(o.property)}</td>
                      <td className="px-4 py-3 text-text-muted">{customerLabel(o.customer)}</td>
                      <td className="px-4 py-3 font-bold text-ink-950">{money(Number(o.amount))}</td>
                      <td className="px-4 py-3 text-text-muted">{o.counter_amount ? money(Number(o.counter_amount)) : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${statusStyle[o.status] ?? statusStyle.draft}`}>
                          {STATUS_LABELS[o.status] ?? o.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {new Date(o.created_at).toLocaleDateString("tr-TR")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
