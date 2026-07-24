import { Coins, TrendingUp, AlertTriangle } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { listDues } from "@/app/actions/dues";
import { DuesClient } from "./dues-client";

export const metadata = { title: "Aidat & Ortak Gider" };

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

export default async function AidatPage() {
  const { perms } = await requireModulePage("expenses");
  const canCreate = perms.expenses?.includes("create") ?? false;

  const supabase = await createClient();
  const [dues, { data: propData }] = await Promise.all([
    listDues(),
    supabase
      .from("properties")
      .select("id, property_code, title")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const properties = (propData ?? []).map((p) => ({ id: p.id as string, property_code: p.property_code as string, title: p.title as string | null }));

  const total = dues.reduce((s, d) => s + Number(d.amount), 0);
  const unpaid = dues.filter((d) => d.status !== "paid").reduce((s, d) => s + Number(d.amount), 0);
  const overdue = dues.filter((d) => d.status !== "paid" && d.due_date && new Date(d.due_date) < new Date()).length;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-amber-400/20 blur-[70px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-300"><Coins className="h-4 w-4" /> Aidat & ortak gider</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Aidat takibi</h1>
            <p className="mt-1 text-sm text-white/70">Portföy bazlı aidat/ortak gider ve ödeme durumu tek yerde.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <TrendingUp className="mx-auto h-4 w-4 text-cyan-400" />
              <p className="mt-1 font-display text-lg font-extrabold text-white">{money(total)}</p>
              <p className="text-[10px] text-white/60">Toplam</p>
            </div>
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <Coins className="mx-auto h-4 w-4 text-amber-300" />
              <p className="mt-1 font-display text-lg font-extrabold text-white">{money(unpaid)}</p>
              <p className="text-[10px] text-white/60">Bekleyen</p>
            </div>
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <AlertTriangle className="mx-auto h-4 w-4 text-danger-400" />
              <p className="mt-1 font-display text-lg font-extrabold text-white">{overdue}</p>
              <p className="text-[10px] text-white/60">Gecikmiş</p>
            </div>
          </div>
        </div>
      </section>

      <DuesClient dues={dues as Parameters<typeof DuesClient>[0]["dues"]} properties={properties} canCreate={canCreate} />
    </div>
  );
}
