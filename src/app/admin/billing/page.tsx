import { Activity, CreditCard, FileText, TrendingUp } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { exportSubscriptionsCsv } from "@/app/actions/platform-export";
import { ExportButton } from "@/components/admin/export-button";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

const planLabel: Record<string, string> = {
  advisor: "Danışman",
  office: "Ofis",
  professional: "Profesyonel",
  enterprise: "Kurumsal",
};

const subStatus: Record<string, string> = {
  trialing: "Deneme",
  active: "Aktif",
  past_due: "Gecikmiş",
  cancelled: "İptal",
  paused: "Duraklatıldı",
};

const invStatus: Record<string, string> = {
  draft: "Taslak",
  open: "Açık",
  paid: "Ödendi",
  void: "İptal",
  uncollectible: "Tahsil edilemez",
};

const statusColor: Record<string, string> = {
  trialing: "var(--amber-400)",
  active: "var(--mint-500)",
  past_due: "var(--danger-500)",
  cancelled: "rgba(10,18,36,0.25)",
  paused: "var(--cyan-400)",
};

type Rel = { name?: string } | { name?: string }[] | null;
function nameOf(v: Rel) {
  if (!v) return "—";
  return Array.isArray(v) ? (v[0]?.name ?? "—") : (v.name ?? "—");
}

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

export default async function AdminBillingPage() {
  await requirePlatformModule("billing");
  const admin = createAdminClient();

  const [{ data: subs }, { data: invoices }] = await Promise.all([
    admin
      .from("subscriptions")
      .select("id, plan, status, billing_cycle, amount_try, trial_ends_at, current_period_end, created_at, tenant:tenants(name)")
      .order("created_at", { ascending: false })
      .limit(500),
    admin
      .from("invoices")
      .select("id, invoice_no, status, total_try, due_at, paid_at, created_at, tenant:tenants(name)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const subRows = subs ?? [];
  const invRows = invoices ?? [];
  const mrr = subRows.filter((s) => s.status === "active").reduce((sum, s) => sum + Number(s.amount_try || 0), 0);
  const trialing = subRows.filter((s) => s.status === "trialing").length;
  const pastDue = subRows.filter((s) => s.status === "past_due").length;

  // Synthetic MRR trend from subscription created_at buckets (8 months)
  const now = new Date();
  const months = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (7 - i), 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("tr-TR", { month: "short" }), value: 0 };
  });
  subRows.forEach((s) => {
    const d = new Date(s.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const bucket = months.find((m) => m.key === key);
    if (bucket && (s.status === "active" || s.status === "trialing")) {
      bucket.value += Number(s.amount_try || 0);
    }
  });
  // Cumulative-ish display for visual continuity
  let running = 0;
  const trend = months.map((m) => {
    running = Math.max(running, m.value) || running + m.value * 0.3;
    if (m.value > 0) running = Math.max(running, mrr * ((months.indexOf(m) + 1) / 8));
    return { ...m, display: m.value > 0 ? m.value : Math.round(running * 0.85) };
  });
  // Prefer real cumulative active MRR approximation
  const trendVals = months.map((m, i) => {
    const cutoff = new Date(now.getFullYear(), now.getMonth() - (7 - i) + 1, 0);
    return subRows
      .filter((s) => s.status === "active" && new Date(s.created_at) <= cutoff)
      .reduce((sum, s) => sum + Number(s.amount_try || 0), 0);
  });
  const maxTrend = Math.max(1, ...trendVals, mrr);
  const pts = trendVals.map((v, i) => ({
    x: (i / 7) * 280,
    y: 72 - (v / maxTrend) * 52 - 8,
  }));
  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `0,80 ${line} 280,80`;
  const last = pts[pts.length - 1] ?? { x: 280, y: 40 };

  const statusKeys = ["active", "trialing", "past_due", "cancelled", "paused"] as const;
  const statusCounts = statusKeys.map((k) => ({
    key: k,
    label: subStatus[k],
    count: subRows.filter((s) => s.status === k).length,
    color: statusColor[k],
  }));
  const totalSubs = Math.max(1, subRows.length);
  let offset = 0;
  const arcs = statusCounts.map((s) => {
    const len = (s.count / totalSubs) * RING_C;
    const item = { ...s, dash: len, offset };
    offset += len;
    return item;
  });

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-amber-400/20 blur-[80px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-400">
              <CreditCard className="h-4 w-4" /> Abonelik & fatura
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white">Gelir operasyonu</h1>
            <p className="mt-1 text-sm text-white/75">Altyapı hazır · iyzico bağlanınca tahsilat otomatikleşecek</p>
            <div className="mt-4">
              <ExportButton action={exportSubscriptionsCsv} label="Abonelikleri indir" />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-[14px] border border-white/12 bg-white/8 p-3">
                <p className="font-display text-xl font-extrabold text-white">{money(mrr)}</p>
                <p className="text-[10px] text-white/70">Aktif aylık gelir</p>
              </div>
              <div className="rounded-[14px] border border-white/12 bg-white/8 p-3">
                <p className="font-display text-xl font-extrabold text-amber-300">{trialing}</p>
                <p className="text-[10px] text-white/70">Deneme</p>
              </div>
              <div className="rounded-[14px] border border-white/12 bg-white/8 p-3">
                <p className="font-display text-xl font-extrabold text-danger-400">{pastDue}</p>
                <p className="text-[10px] text-white/70">Gecikmiş</p>
              </div>
            </div>
          </div>

          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75">
                <TrendingUp className="h-3.5 w-3.5 text-amber-400" /> Aylık gelir trendi · 8 ay
              </p>
              <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-[10px] font-bold text-mint-300">{money(mrr)}</span>
            </div>
            <svg viewBox="0 0 280 80" className="mt-3 h-24 w-full overflow-visible" preserveAspectRatio="none">
              <defs>
                <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--mint-400)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--mint-400)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={area} fill="url(#mrrFill)" />
              <polyline
                className="chart-draw"
                style={{ "--len": 420 } as CSSProperties}
                points={line}
                fill="none"
                stroke="var(--mint-400)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline className="flow-line" points={line} fill="none" stroke="rgba(52,211,153,0.45)" strokeWidth="1.5" />
              <circle cx={last.x} cy={last.y} r="4" fill="var(--mint-400)" opacity="0.35" className="glow-halo" />
              <circle cx={last.x} cy={last.y} r="3" fill="#fff" />
            </svg>
            <div className="mt-1 flex justify-between text-[9px] text-white/35">
              {trend.map((m) => (
                <span key={m.key}>{m.label}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
            <Activity className="h-4 w-4" /> Abonelik durumu
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Durum halkası</h2>
          <div className="mt-5 flex items-center gap-4">
            <div className="relative grid h-28 w-28 place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--mint-500), var(--amber-400), var(--mint-500))" }}
              />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="10" />
                {arcs.filter((a) => a.count > 0).map((a) => (
                  <circle
                    key={a.key}
                    cx="50"
                    cy="50"
                    r="42"
                    fill="none"
                    stroke={a.color}
                    strokeWidth="10"
                    strokeDasharray={`${a.dash} ${RING_C - a.dash}`}
                    strokeDashoffset={-a.offset}
                  />
                ))}
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-lg font-extrabold text-ink-950">{subRows.length}</p>
                <p className="text-[9px] text-text-faint">abonelik</p>
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              {statusCounts.filter((s) => s.count > 0 || ["active", "trialing"].includes(s.key)).map((s) => (
                <div key={s.key} className="flex items-center gap-2 text-text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1">{s.label}</span>
                  <span className="font-bold text-ink-950">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <CreditCard className="h-4 w-4 text-brand-600" /> Abonelikler
            </h2>
          </div>
          <div className="divide-y divide-line">
            {subRows.map((s) => (
              <div key={s.id} className="grid gap-2 px-5 py-3 transition hover:bg-brand-600/[0.02] sm:grid-cols-[1.2fr_.8fr_.7fr_.7fr] sm:items-center">
                <p className="text-sm font-semibold text-ink-950">{nameOf(s.tenant as Rel)}</p>
                <p className="text-xs text-text-muted">{planLabel[s.plan] ?? s.plan} · {s.billing_cycle}</p>
                <p className="text-xs font-semibold text-ink-950">{money(Number(s.amount_try))}</p>
                <span className="w-fit rounded-full bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold text-amber-600">
                  {subStatus[s.status] ?? s.status}
                </span>
              </div>
            ))}
            {subRows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-text-muted">Abonelik kaydı yok.</p> : null}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <FileText className="h-4 w-4 text-brand-600" /> Faturalar
          </h2>
        </div>
        {invRows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">
            Henüz fatura yok. iyzico bağlandığında otomatik oluşacak; şimdilik abonelik iskeleti üzerinden takip edebilirsiniz.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {invRows.map((inv) => (
              <div key={inv.id} className="grid gap-2 px-5 py-3 sm:grid-cols-[1fr_.7fr_.7fr_.7fr] sm:items-center">
                <div>
                  <p className="text-sm font-semibold text-ink-950">{inv.invoice_no}</p>
                  <p className="text-xs text-text-muted">{nameOf(inv.tenant as Rel)}</p>
                </div>
                <p className="text-xs font-semibold">{money(Number(inv.total_try))}</p>
                <span className="w-fit rounded-full bg-brand-600/10 px-2.5 py-1 text-[10px] font-bold text-brand-600">
                  {invStatus[inv.status] ?? inv.status}
                </span>
                <p className="text-xs text-text-faint">
                  {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(inv.created_at))}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
