import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CreditCard, FileText, TrendingUp, Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { CountUp } from "@/components/admin/count-up";
import { now } from "@/lib/clock";

const planLabel: Record<string, string> = {
  advisor: "Danışman",
  office: "Ofis",
  professional: "Profesyonel",
  enterprise: "Kurumsal",
};

const invStatusLabel: Record<string, string> = {
  draft: "Taslak",
  open: "Açık",
  paid: "Ödendi",
  void: "İptal",
  uncollectible: "Tahsil edilemez",
};

const invStatusColor: Record<string, string> = {
  paid: "bg-mint-500/12 text-mint-600",
  open: "bg-amber-400/15 text-amber-600",
  draft: "bg-ink-950/5 text-text-muted",
  void: "bg-ink-950/5 text-text-faint",
  uncollectible: "bg-danger-500/10 text-danger-500",
};

type Rel = { name?: string } | { name?: string }[] | null;
function nameOf(v: Rel) {
  if (!v) return "—";
  return Array.isArray(v) ? (v[0]?.name ?? "—") : (v.name ?? "—");
}

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

export async function BillingHome({ staffName }: { staffName: string }) {
  const admin = createAdminClient();

  const [{ data: subs }, { data: invoices }] = await Promise.all([
    admin
      .from("subscriptions")
      .select("id, plan, status, amount_try, current_period_end, created_at")
      .order("created_at", { ascending: false }),
    admin
      .from("invoices")
      .select("id, invoice_no, status, total_try, due_at, paid_at, created_at, tenant:tenants(name)")
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const subRows = subs ?? [];
  const invRows = invoices ?? [];

  const mrr = subRows.filter((s) => s.status === "active").reduce((sum, s) => sum + Number(s.amount_try || 0), 0);
  const activeCount = subRows.filter((s) => s.status === "active").length;
  const trialing = subRows.filter((s) => s.status === "trialing").length;
  const pastDue = subRows.filter((s) => s.status === "past_due").length;

  const nowMs = now();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const collectedThisMonth = invRows
    .filter((i) => i.status === "paid" && i.paid_at && new Date(i.paid_at).getTime() >= monthStart)
    .reduce((sum, i) => sum + Number(i.total_try || 0), 0);
  const overdue = invRows.filter(
    (i) => i.status === "open" && i.due_at && new Date(i.due_at).getTime() < nowMs,
  );
  const overdueTotal = overdue.reduce((sum, i) => sum + Number(i.total_try || 0), 0);
  const openTotal = invRows
    .filter((i) => i.status === "open")
    .reduce((sum, i) => sum + Number(i.total_try || 0), 0);

  // Plan bazlı gelir dağılımı (aktif abonelikler)
  const planRevenue = ["advisor", "office", "professional", "enterprise"].map((p) => ({
    key: p,
    label: planLabel[p],
    value: subRows
      .filter((s) => s.status === "active" && s.plan === p)
      .reduce((sum, s) => sum + Number(s.amount_try || 0), 0),
  }));
  const maxPlan = Math.max(1, ...planRevenue.map((p) => p.value));

  const kpis = [
    { label: "Aylık yinelenen gelir", value: mrr, money: true, icon: TrendingUp, tone: "text-mint-400" },
    { label: "Aktif abonelik", value: activeCount, money: false, icon: CreditCard, tone: "text-amber-400" },
    { label: "Bu ay tahsilat", value: collectedThisMonth, money: true, icon: Wallet, tone: "text-cyan-400" },
    { label: "Gecikmiş fatura", value: overdueTotal, money: true, icon: AlertTriangle, tone: "text-danger-400" },
  ];

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-64 w-64 rounded-full bg-mint-500/20 blur-[90px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <span className="status-pulse h-2 w-2 rounded-full bg-mint-400" /> EmlakSoft · Muhasebe
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Finans kontrol paneli</h1>
          <p className="mt-1 max-w-lg text-sm text-white/75">
            Merhaba {staffName}. Abonelik geliri, tahsilat ve gecikmiş faturalar tek ekranda.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-[14px] border border-white/12 bg-white/8 p-3 backdrop-blur">
                <k.icon className={`h-4 w-4 ${k.tone}`} />
                <p className="mt-2 font-display text-lg font-extrabold tabular-nums text-white"><CountUp value={k.value} money={k.money} /></p>
                <p className="text-[10px] text-white/70">{k.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        {/* Plan bazlı gelir */}
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <TrendingUp className="h-4 w-4" /> Plan bazlı aylık gelir
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Gelir dağılımı</h2>
          <div className="mt-5 space-y-3">
            {planRevenue.map((p, i) => (
              <div key={p.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-950">{p.label}</span>
                  <span className="tabular-nums text-text-muted">{money(p.value)}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-950/5">
                  <div
                    className="bar-live h-full rounded-full bg-[image:var(--grad-brand)]"
                    style={{ width: `${Math.max((p.value / maxPlan) * 100, 3)}%`, animationDelay: `${i * 0.08}s` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
            <div>
              <p className="font-display text-lg font-extrabold text-ink-950">{trialing}</p>
              <p className="text-[10px] text-text-muted">Deneme</p>
            </div>
            <div>
              <p className="font-display text-lg font-extrabold text-danger-500">{pastDue}</p>
              <p className="text-[10px] text-text-muted">Gecikmiş abonelik</p>
            </div>
            <div>
              <p className="font-display text-lg font-extrabold text-amber-600">{money(openTotal)}</p>
              <p className="text-[10px] text-text-muted">Açık bakiye</p>
            </div>
          </div>
        </section>

        {/* Son faturalar */}
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
                <FileText className="h-4 w-4" /> Fatura akışı
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Son faturalar</h2>
            </div>
            <Link href="/admin/billing" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
              Tümü <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {invRows.slice(0, 7).map((i) => {
              const isOverdue = i.status === "open" && i.due_at && new Date(i.due_at).getTime() < nowMs;
              return (
                <div key={i.id} className="flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-950">{nameOf(i.tenant as Rel)}</p>
                    <p className="text-[10px] text-text-faint">
                      {i.invoice_no ?? "—"} · {new Date(i.created_at).toLocaleDateString("tr-TR")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums text-sm font-semibold text-ink-950">{money(Number(i.total_try || 0))}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${isOverdue ? "bg-danger-500/10 text-danger-500" : invStatusColor[i.status] ?? "bg-ink-950/5 text-text-muted"}`}>
                      {isOverdue ? "Gecikmiş" : invStatusLabel[i.status] ?? i.status}
                    </span>
                  </div>
                </div>
              );
            })}
            {invRows.length === 0 ? <p className="py-6 text-center text-sm text-text-muted">Henüz fatura yok.</p> : null}
          </div>
        </section>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {[
          { href: "/admin/billing", title: "Abonelik & fatura", desc: `${activeCount} aktif abonelik · ${money(mrr)} aylık gelir`, icon: CreditCard, tone: "bg-amber-400/15 text-amber-600" },
          { href: "/admin/tenants", title: "Ofis defteri", desc: "Ofislerin plan ve durum bilgisi", icon: Wallet, tone: "bg-brand-600/10 text-brand-600" },
        ].map((card) => (
          <Link key={card.title} href={card.href} className="lift group relative overflow-hidden rounded-[16px] border border-line bg-surface p-4 transition hover:border-brand-300">
            <span className={`grid h-10 w-10 place-items-center rounded-[12px] ${card.tone}`}>
              <card.icon className="h-5 w-5" />
            </span>
            <p className="mt-3 font-display font-bold text-ink-950">{card.title}</p>
            <p className="mt-0.5 text-xs text-text-muted">{card.desc}</p>
            <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-text-faint transition group-hover:text-brand-600" />
          </Link>
        ))}
      </section>
    </div>
  );
}
