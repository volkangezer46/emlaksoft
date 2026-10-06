import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CreditCard, FileText, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { GlassKpi, HeroBanner, KpiCard } from "@/components/ui/premium";
import { Bento, Bx } from "@/components/ui/console/bento";
import { Ring } from "@/components/ui/console/ring";
import { DAY_MS, TR_OFFSET_MS, msSince, now, trParts } from "@/lib/clock";
import { adminEyebrow, adminGreeting, firstNameOf } from "./shared";
import { PLANS } from "@/lib/billing/plans";

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

type Rel = { id?: string; name?: string } | { id?: string; name?: string }[] | null;
function nameOf(v: Rel) {
  if (!v) return "—";
  return Array.isArray(v) ? (v[0]?.name ?? "—") : (v.name ?? "—");
}
function idOf(v: Rel) {
  if (!v) return null;
  return Array.isArray(v) ? (v[0]?.id ?? null) : (v.id ?? null);
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
      .select("id, invoice_no, status, total_try, due_at, paid_at, created_at, tenant:tenants(id, name)")
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
  const tp = trParts(nowMs);
  const monthStart = Date.UTC(tp.year, tp.month, 1) - TR_OFFSET_MS;
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
  const planRevenue = PLANS.map((plan) => ({
    key: plan.id,
    label: plan.name,
    value: subRows
      .filter((s) => s.status === "active" && s.plan === plan.id)
      .reduce((sum, s) => sum + Number(s.amount_try || 0), 0),
  }));
  const maxPlan = Math.max(1, ...planRevenue.map((p) => p.value));

  const overdueQueue = [...overdue].sort((a, b) => new Date(a.due_at as string).getTime() - new Date(b.due_at as string).getTime());
  const paidTotal = invRows.filter((i) => i.status === "paid").reduce((sum, i) => sum + Number(i.total_try || 0), 0);

  const heroKpis = [
    { label: "Aylık yinelenen gelir", href: "/admin/billing", value: money(mrr), sub: `Yıllık ${money(mrr * 12)}`, icon: TrendingUp },
    { label: "Aktif abonelik", href: "/admin/billing?durum=active", value: String(activeCount), sub: `${trialing} deneme`, icon: CreditCard },
    { label: "Bu ay tahsilat", href: "/admin/billing?durum=paid", value: money(collectedThisMonth), sub: "Ödenen faturalar", icon: Wallet },
    {
      label: "Gecikmiş fatura",
      href: "/admin/billing?durum=open",
      value: money(overdueTotal),
      sub: overdue.length > 0 ? `${overdue.length} fatura` : "Gecikme yok",
      subTone: overdue.length > 0 ? ("danger" as const) : undefined,
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="space-y-6">
      <HeroBanner
        eyebrow={adminEyebrow(nowMs, "Finans")}
        title={adminGreeting(nowMs)}
        highlight={firstNameOf(staffName)}
        summary={
          <p>
            {activeCount} aktif abonelik, {money(mrr)} aylık gelir. Bu ay {money(collectedThisMonth)} tahsil edildi
            {overdue.length > 0 ? `, ${overdue.length} fatura gecikmiş.` : "; gecikmiş fatura yok."}
          </p>
        }
      >
        {heroKpis.map((k) => (
          <GlassKpi key={k.label} label={k.label} value={k.value} sub={k.sub} subTone={k.subTone} href={k.href} icon={k.icon} />
        ))}
      </HeroBanner>

      <Bento>
        <Bx className="md:col-span-6 xl:col-span-7" eyebrow="Tahsilat kuyruğu" icon={AlertTriangle} title="Geciken faturalar" href="/admin/billing?durum=open">
          {overdueQueue.length === 0 ? (
            <EmptyStateV3 variant="compact" title="Geciken fatura yok" description="Vadesi geçen açık fatura olursa en eskisi burada başa gelir." />
          ) : (
            <ul className="-mx-1 space-y-0.5">
              {overdueQueue.slice(0, 6).map((i) => {
                const tenantId = idOf(i.tenant as Rel);
                const days = Math.max(1, Math.floor(msSince(i.due_at as string) / DAY_MS));
                return (
                  <li key={i.id}>
                    <Link href={tenantId ? `/admin/tenants/${tenantId}` : "/admin/billing?durum=open"} className="qrow focus-ring group">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-danger-600" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text">{nameOf(i.tenant as Rel)}</span>
                        <span className="block truncate text-xs text-text-muted">{i.invoice_no ?? "Fatura"} · {days} gün gecikti</span>
                      </span>
                      <span className="num text-sm text-text">{money(Number(i.total_try || 0))}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Bx>
        <Bx className="md:col-span-6 xl:col-span-5" eyebrow="Tahsilat durumu" icon={Wallet} title="Ödenen ve açık tutar">
          {paidTotal + openTotal > 0 ? (
            <div className="flex flex-wrap items-center gap-5">
              <Ring value={paidTotal} max={paidTotal + openTotal} tone="success" size={104} ariaLabel={`Son ${invRows.length} faturanın ödenen payı`}>
                <span>
                  <span className="num block text-xl text-text">%{Math.round((paidTotal / (paidTotal + openTotal)) * 100)}</span>
                  <span className="block text-xs text-text-muted">ödendi</span>
                </span>
              </Ring>
              <div className="min-w-0 flex-1 basis-40 space-y-1">
                <Link href="/admin/billing?durum=paid" className="qrow focus-ring justify-between">
                  <span className="text-sm text-text-muted">Ödenen</span>
                  <span className="num text-sm text-text">{money(paidTotal)}</span>
                </Link>
                <Link href="/admin/billing?durum=open" className="qrow focus-ring justify-between">
                  <span className="text-sm text-text-muted">Açık</span>
                  <span className="num text-sm text-text">{money(openTotal)}</span>
                </Link>
                <p className="px-3 text-xs text-text-faint">Son {invRows.length} fatura üzerinden</p>
              </div>
            </div>
          ) : (
            <EmptyStateV3 variant="compact" title="Henüz fatura tutarı yok" description="Fatura kesildikçe tahsilat oranı burada görünür." />
          )}
        </Bx>
      </Bento>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Deneme abonelik" value={trialing} href="/admin/billing?durum=trialing" icon={Sparkles} tone="brand" hint="Ödemeye dönüşmeyi bekleyen" />
        <KpiCard label="Gecikmiş abonelik" value={pastDue} href="/admin/billing?durum=past_due" icon={AlertTriangle} tone={pastDue > 0 ? "danger" : "success"} attention={pastDue > 0} hint={pastDue > 0 ? "Tahsilat takibi gerekli" : "Gecikmiş abonelik yok"} />
        <KpiCard label="Açık bakiye" value={money(openTotal)} href="/admin/billing?durum=open" icon={Wallet} tone="warn" hint="Ödenmemiş açık faturalar" />
        <KpiCard label="Yıllık yinelenen gelir" value={money(mrr * 12)} href="/admin/billing" icon={TrendingUp} tone="gold" hint="Aylık gelirin 12 katı" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        {/* Plan bazlı gelir */}
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <TrendingUp className="h-4 w-4" /> Plan bazlı aylık gelir
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Gelir dağılımı</h2>
          <div className="mt-5 space-y-3">
            {planRevenue.map((p, i) => (
              <Link key={p.key} href={`/admin/tenants?plan=${p.key}`} className="focus-ring group block rounded-[var(--radius-control)]">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-950 transition group-hover:text-brand-600">{p.label}</span>
                  <span className="tabular-nums text-text-muted">{money(p.value)}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-950/5">
                  <div
                    className="h-full rounded-full bg-[image:var(--grad-brand)] transition group-hover:brightness-110"
                    style={{ width: `${Math.max((p.value / maxPlan) * 100, 3)}%`, animationDelay: `${i * 0.08}s` }}
                  />
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Son faturalar */}
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
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
              const tenantId = idOf(i.tenant as Rel);
              const inner = (
                <>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-950 transition group-hover:text-brand-600">{nameOf(i.tenant as Rel)}</p>
                    <p className="text-xs text-text-faint">
                      {i.invoice_no ?? "—"} · {new Date(i.created_at).toLocaleDateString("tr-TR")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums text-sm font-semibold text-ink-950">{money(Number(i.total_try || 0))}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${isOverdue ? "bg-danger-500/10 text-danger-500" : invStatusColor[i.status] ?? "bg-ink-950/5 text-text-muted"}`}>
                      {isOverdue ? "Gecikmiş" : invStatusLabel[i.status] ?? i.status}
                    </span>
                  </div>
                </>
              );
              return tenantId ? (
                <Link key={i.id} href={`/admin/tenants/${tenantId}`} className="focus-ring group flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5 transition hover:border-brand-300">
                  {inner}
                </Link>
              ) : (
                <div key={i.id} className="flex items-center justify-between rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
                  {inner}
                </div>
              );
            })}
            {invRows.length === 0 ? <EmptyStateV3 variant="compact" title="Henüz fatura yok" description="Kesilen faturalar burada listelenir." /> : null}
          </div>
        </section>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {[
          { href: "/admin/billing", title: "Abonelik & fatura", desc: `${activeCount} aktif abonelik · ${money(mrr)} aylık gelir`, icon: CreditCard, tone: "bg-amber-400/15 text-amber-600" },
          { href: "/admin/tenants", title: "Ofis defteri", desc: "Ofislerin plan ve durum bilgisi", icon: Wallet, tone: "bg-brand-600/10 text-brand-600" },
        ].map((card) => (
          <Link key={card.title} href={card.href} className="lift group relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-300">
            <span className={`grid h-10 w-10 place-items-center rounded-[var(--radius-card)] ${card.tone}`}>
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
