import Link from "@/components/ui/smart-link";
import { AlertTriangle, CreditCard, FileText, TrendingUp, Wallet, Receipt, Clock } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyState } from "@/components/ui/empty-state";
import { DashboardHero } from "@/components/ui/dashboard-hero";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { ChartCard } from "@/components/ui/chart-frame";
import { Ring } from "@/components/ui/console/ring";
import { DataFreshness } from "@/components/ui/data-freshness";
import { DAY_MS, TR_OFFSET_MS, msSince, now, trParts } from "@/lib/clock";
import { exactArr } from "@/lib/reporting/platform";
import { adminEyebrow, adminGreeting, firstNameOf } from "./shared";
import { PLANS } from "@/lib/billing/plans";

const invStatusLabel: Record<string, string> = {
  draft: "Taslak",
  open: "Açık",
  paid: "Ödendi",
  void: "İptal",
  uncollectible: "Tahsil edilemez",
};

/** Fatura durumu → ton (metin her zaman var; renk tek başına anlam taşımaz). */
const invStatusTone: Record<string, string> = {
  paid: "success",
  open: "warn",
  draft: "neutral",
  void: "neutral",
  uncollectible: "danger",
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

/** Faturalama rolünün açılış paneli (tasarım sistemi v4: DashboardHero + KpiGrid + ChartCard). */
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
  const overdue = invRows.filter((i) => i.status === "open" && i.due_at && new Date(i.due_at).getTime() < nowMs);
  const overdueTotal = overdue.reduce((sum, i) => sum + Number(i.total_try || 0), 0);
  const openTotal = invRows.filter((i) => i.status === "open").reduce((sum, i) => sum + Number(i.total_try || 0), 0);

  // Plan bazlı gelir dağılımı (aktif abonelikler)
  const planRevenue = PLANS.map((plan) => ({
    key: plan.id,
    label: plan.name,
    value: subRows.filter((s) => s.status === "active" && s.plan === plan.id).reduce((sum, s) => sum + Number(s.amount_try || 0), 0),
  }));
  const maxPlan = Math.max(1, ...planRevenue.map((p) => p.value));

  const overdueQueue = [...overdue].sort((a, b) => new Date(a.due_at as string).getTime() - new Date(b.due_at as string).getTime());
  const paidTotal = invRows.filter((i) => i.status === "paid").reduce((sum, i) => sum + Number(i.total_try || 0), 0);
  const oldest = overdueQueue[0];
  const oldestTenantId = oldest ? idOf(oldest.tenant as Rel) : null;

  return (
    <div className="space-y-5">
      <DashboardHero
        eyebrow={adminEyebrow(nowMs, "Finans")}
        title={`${adminGreeting(nowMs)}${firstNameOf(staffName) ? `, ${firstNameOf(staffName)}` : ""}`}
        summary={
          oldest ? (
            <p>
              Tahsilat önceliği: en eski geciken fatura{" "}
              <Link href={oldestTenantId ? `/admin/tenants/${oldestTenantId}` : "/admin/billing?durum=open"} className="focus-ring rounded-sm font-semibold text-accent-text hover:underline">
                {nameOf(oldest.tenant as Rel)}
              </Link>{" "}
              ({Math.max(1, Math.floor(msSince(oldest.due_at as string) / DAY_MS))} gündür bekliyor).
            </p>
          ) : (
            <p>Tahsilat kuyruğu temiz: vadesi geçmiş açık fatura yok.</p>
          )
        }
        freshness={<DataFreshness asOf={nowMs} />}
      />

      <KpiGrid label="Finans özet göstergeleri">
        <KpiCard layout="inline" label="Aylık yinelenen gelir" value={money(mrr)} href="/admin/billing" icon={TrendingUp} tone="gold" hint={`Yıllık ${money(exactArr(mrr))}`} />
        <KpiCard layout="inline" label="Aktif abonelik" value={activeCount} href="/admin/billing?durum=active" icon={CreditCard} tone="brand" hint={`${trialing} deneme aboneliği`} />
        <KpiCard layout="inline" label="Bu ay tahsilat" value={money(collectedThisMonth)} href="/admin/billing?durum=paid" icon={Wallet} tone="success" hint="Ödenen faturalar" />
        <KpiCard
          layout="inline"
          tinted={overdue.length > 0}
          label="Gecikmiş fatura"
          value={money(overdueTotal)}
          href="/admin/billing?durum=open"
          icon={AlertTriangle}
          tone={overdue.length > 0 ? "danger" : "success"}
          attention={overdue.length > 0}
          hint={overdue.length > 0 ? `${overdue.length} fatura` : "Gecikme yok"}
        />
        <KpiCard
          layout="inline"
          label="Gecikmiş abonelik"
          value={pastDue}
          href="/admin/billing?durum=past_due"
          icon={Clock}
          tone={pastDue > 0 ? "warn" : "success"}
          attention={pastDue > 0}
          hint={pastDue > 0 ? "Tahsilat takibi gerekli" : "Gecikmiş abonelik yok"}
        />
        <KpiCard layout="inline" label="Açık bakiye" value={money(openTotal)} href="/admin/billing?durum=open" icon={Receipt} tone="warn" hint="Ödenmemiş açık faturalar" />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
        <ChartCard
          as="h2"
          className="md:col-span-6 xl:col-span-7"
          title="Geciken faturalar"
          subtitle="Tahsilat kuyruğu · en eski başta"
          icon={AlertTriangle}
          tone="danger"
          href="/admin/billing?durum=open"
          hrefLabel="Tümü"
          height={0}
        >
          {overdueQueue.length === 0 ? (
            <EmptyState variant="compact" illustration="basari" title="Geciken fatura yok" description="Vadesi geçen açık fatura olursa en eskisi burada başa gelir." />
          ) : (
            <ul className="ds-sep -mx-1.5">
              {overdueQueue.slice(0, 6).map((i) => {
                const tenantId = idOf(i.tenant as Rel);
                const days = Math.max(1, Math.floor(msSince(i.due_at as string) / DAY_MS));
                return (
                  <li key={i.id}>
                    <Link href={tenantId ? `/admin/tenants/${tenantId}` : "/admin/billing?durum=open"} className="ds-row focus-ring">
                      <span className="ds-row-ico pm-t-danger" aria-hidden="true">
                        <AlertTriangle />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text">{nameOf(i.tenant as Rel)}</span>
                        <span className="block truncate text-xs text-text-muted">
                          {i.invoice_no ?? "Fatura"} · {days} gün gecikti
                        </span>
                      </span>
                      <span className="ds-num shrink-0 text-sm">{money(Number(i.total_try || 0))}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartCard>
        <ChartCard as="h2" className="md:col-span-6 xl:col-span-5" title="Tahsilat durumu" subtitle={`Son ${invRows.length} fatura`} icon={Wallet} tone="success" height={0}>
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
              </div>
            </div>
          ) : (
            <EmptyState variant="compact" illustration="komisyon" title="Henüz fatura tutarı yok" description="Fatura kesildikçe tahsilat oranı burada görünür." />
          )}
        </ChartCard>

        <ChartCard as="h2" className="md:col-span-6 xl:col-span-5" title="Gelir dağılımı" subtitle="Plan bazlı aylık gelir" icon={TrendingUp} tone="gold" height={0}>
          <ul className="space-y-3">
            {planRevenue.map((p) => (
              <li key={p.key}>
                <Link href={`/admin/tenants?plan=${p.key}`} className="focus-ring group block rounded-[var(--radius-control)]">
                  <span className="flex items-center justify-between text-sm">
                    <span className="font-medium text-text group-hover:text-accent-text">{p.label}</span>
                    <span className="tabular-nums text-text-muted">{money(p.value)}</span>
                  </span>
                  <span className="ds-bar pm-t-gold mt-1.5">
                    <span className="motion-progress-fill" style={{ width: `${Math.max((p.value / maxPlan) * 100, p.value > 0 ? 3 : 0)}%` }} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </ChartCard>

        <ChartCard as="h2" className="md:col-span-6 xl:col-span-7" title="Son faturalar" subtitle="Fatura akışı" icon={FileText} tone="brand" href="/admin/billing" hrefLabel="Tümü" height={0}>
          {invRows.length === 0 ? (
            <EmptyState variant="compact" illustration="belge" title="Henüz fatura yok" description="Kesilen faturalar burada listelenir." />
          ) : (
            <ul className="ds-sep -mx-1.5">
              {invRows.slice(0, 7).map((i) => {
                const isOverdue = i.status === "open" && i.due_at && new Date(i.due_at).getTime() < nowMs;
                const tenantId = idOf(i.tenant as Rel);
                return (
                  <li key={i.id}>
                    <Link href={tenantId ? `/admin/tenants/${tenantId}` : "/admin/billing"} className="ds-row focus-ring min-h-11">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text">{nameOf(i.tenant as Rel)}</span>
                        <span className="block text-xs text-text-muted">
                          {i.invoice_no ?? "—"} · {new Date(i.created_at).toLocaleDateString("tr-TR")}
                        </span>
                      </span>
                      <span className="ds-num shrink-0 text-sm">{money(Number(i.total_try || 0))}</span>
                      <span className={`ds-pill pm-t-${isOverdue ? "danger" : (invStatusTone[i.status] ?? "neutral")}`}>
                        {isOverdue ? "Gecikmiş" : (invStatusLabel[i.status] ?? i.status)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
