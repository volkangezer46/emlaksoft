import Link from "next/link";
import { Handshake, TrendingUp, Trophy, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { DealBoard, type BoardDeal } from "./deal-board";
import { NewDealDialog } from "./new-deal-dialog";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

export default async function DealsPage() {
  const { perms } = await requireModulePage("commissions");
  const canCreate = (perms.commissions ?? []).includes("create");
  const canEdit = (perms.commissions ?? []).includes("edit");
  const supabase = await createClient();

  const [{ data: dealsRaw }, { data: properties }, { data: customers }, { data: members }] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, stage, deal_type, deal_value, probability, assigned_to, updated_at, property_id, customer_id, property:properties(id, title, property_code), customer:customers(id, full_name)",
      )
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase
      .from("properties")
      .select("id, property_code, title, list_price, transaction_type")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("customers")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("full_name")
      .limit(200),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const deals: BoardDeal[] = (dealsRaw ?? []).map((d) => {
    const prop = d.property as
      | { id?: string; title?: string; property_code?: string }
      | { id?: string; title?: string; property_code?: string }[]
      | null;
    const cust = d.customer as { id?: string; full_name?: string } | { id?: string; full_name?: string }[] | null;
    const p = Array.isArray(prop) ? prop[0] : prop;
    const c = Array.isArray(cust) ? cust[0] : cust;
    return {
      id: d.id,
      stage: d.stage,
      deal_type: d.deal_type,
      deal_value: d.deal_value != null ? Number(d.deal_value) : null,
      probability: d.probability != null ? Number(d.probability) : null,
      assigned_to: d.assigned_to ?? null,
      updated_at: d.updated_at,
      property_title: p?.title ?? null,
      property_code: p?.property_code ?? null,
      property_id: p?.id ?? d.property_id,
      customer_name: c?.full_name ?? null,
      customer_id: c?.id ?? d.customer_id,
    };
  });

  const open = deals.filter((d) => !["won", "lost"].includes(d.stage));
  const won = deals.filter((d) => d.stage === "won");
  const pipelineValue = open.reduce((s, d) => s + (d.deal_value || 0), 0);
  const wonValue = won.reduce((s, d) => s + (d.deal_value || 0), 0);
  const winRate = deals.length ? Math.round((won.length / deals.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-mint-500/20 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mint-400">
              <Handshake className="h-3.5 w-3.5" /> Anlaşma pipeline
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold md:text-4xl">Anlaşma tahtası</h1>
            <p className="mt-2 max-w-lg text-sm text-white/60">
              Yeni → nitelikli → müzakere → kazan/kayıp. Kazanıldığında komisyon otomatik üretilir.
            </p>
          </div>
          {canCreate ? <NewDealDialog properties={properties ?? []} customers={customers ?? []} /> : null}
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Açık pipeline", value: money(pipelineValue), icon: TrendingUp, tone: "text-cyan-300" },
            { label: "Kazanılan", value: money(wonValue), icon: Trophy, tone: "text-mint-300" },
            { label: "Açık kart", value: String(open.length), icon: Handshake, tone: "text-amber-300" },
            { label: "Kazanma oranı", value: `%${winRate}`, icon: Wallet, tone: "text-white" },
          ].map((k) => (
            <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-4 backdrop-blur">
              <k.icon className={`h-4 w-4 ${k.tone}`} />
              <p className="mt-2 truncate font-display text-xl font-extrabold">{k.value}</p>
              <p className="text-[11px] text-white/45">{k.label}</p>
            </div>
          ))}
        </div>
      </section>

      {deals.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-mint-500/12 text-mint-600">
            <Handshake className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink-950">Pipeline boş</h2>
          <p className="mt-1 max-w-md text-sm text-text-muted">
            İlk anlaşmayı ekleyin veya portföyden "Anlaşma + komisyon" ile kazanan işlem açın.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {canCreate ? <NewDealDialog properties={properties ?? []} customers={customers ?? []} /> : null}
            <Link href="/app/portfoyler" className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-brand-600">
              Portföye git
            </Link>
          </div>
        </div>
      ) : (
        <DealBoard deals={deals} canEdit={canEdit} members={members ?? []} />
      )}
    </div>
  );
}
