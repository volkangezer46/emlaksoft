import Link from "next/link";
import { ArrowUpRight, PieChart } from "lucide-react";
import { Widget } from "../dashboard-widgets";
import { loadDeals, loadDemandCounts, type HomeCtx } from "./data";
import { pipelineStats } from "./helpers";

export async function Huni({ ctx }: { ctx: HomeCtx }) {
  const [demand, deals] = await Promise.all([loadDemandCounts(ctx), loadDeals(ctx)]);
  const { dealWon, openDeals, conversion } = pipelineStats(demand, deals);
  // /app/talepler mevcut ?status= paramını kullanıyor (new|active|matched)
  const pipeline = [
    { label: "Yeni talep", value: demand.new, color: "bg-brand-600", href: "/app/talepler?status=new" },
    { label: "Aktif talep", value: demand.active, color: "bg-cyan-400", href: "/app/talepler?status=active" },
    { label: "Eşleşen", value: demand.matched, color: "bg-mint-500", href: "/app/talepler?status=matched" },
    { label: "Kazanılan anlaşma", value: dealWon, color: "bg-amber-400", href: "/app/anlasmalar" },
  ];
  const pipeMax = Math.max(1, ...pipeline.map((p) => p.value));

  return (
    <Widget id="huni" className="h-full">
      <section className="pm-bx h-full p-5 md:p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
              <PieChart className="h-4 w-4" /> Canlı satış hattı
            </p>
            <h2 className="mt-1 font-display text-lg font-bold text-ink-950">Talep → anlaşma hunisi</h2>
          </div>
          <Link href="/app/anlasmalar" className="focus-ring rounded-[var(--radius-control)] text-xs font-semibold text-brand-600">
            Board
          </Link>
        </div>
        <div className="mt-6 space-y-4">
          {pipeline.map((stage, index) => (
            <Link
              key={stage.label}
              href={stage.href}
              className="focus-ring group -mx-1 block rounded-[var(--radius-control)] px-1 py-0.5 transition hover:bg-brand-600/[0.04]"
            >
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-medium text-text-muted transition group-hover:text-brand-600">{stage.label}</span>
                <span className="flex items-center gap-1.5 font-display font-bold text-ink-950">
                  {stage.value}
                  <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-canvas">
                <div
                  className={`pipeline-fill h-full rounded-full ${stage.color}`}
                  style={{ width: `${Math.max(6, (stage.value / pipeMax) * 100)}%`, animationDelay: `${index * 100}ms` }}
                />
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-4">
          <Link href="/app/anlasmalar" className="focus-ring group -m-1 block rounded-[var(--radius-control)] p-1 transition hover:bg-brand-600/[0.04]">
            <p className="text-xs text-text-faint transition group-hover:text-brand-600">Kazanma oranı</p>
            <p className="font-display text-xl font-extrabold text-ink-950">%{conversion}</p>
          </Link>
          <Link href="/app/anlasmalar" className="focus-ring group -m-1 block rounded-[var(--radius-control)] p-1 transition hover:bg-brand-600/[0.04]">
            <p className="text-xs text-text-faint transition group-hover:text-brand-600">Açık anlaşma</p>
            <p className="font-display text-xl font-extrabold text-ink-950">{openDeals}</p>
          </Link>
        </div>
      </section>
    </Widget>
  );
}
