import Link from "next/link";
import { Activity, ArrowUpRight, CreditCard, FileText, TrendingUp, X } from "lucide-react";
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

/** `?from=&to=` — yalnızca geçerli YYYY-AA-GG kabul edilir; bozuk değer yok sayılır. */
function parseDateParam(raw: string | undefined): string | undefined {
  const v = (raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

function billingHref(p: { durum?: string; from?: string; to?: string }) {
  const sp = new URLSearchParams();
  if (p.durum) sp.set("durum", p.durum);
  if (p.from) sp.set("from", p.from);
  if (p.to) sp.set("to", p.to);
  const s = sp.toString();
  return s ? `/admin/billing?${s}` : "/admin/billing";
}

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; from?: string; to?: string }>;
}) {
  await requirePlatformModule("billing");
  const sp = (await searchParams) ?? {};
  const durum = sp.durum && subStatus[sp.durum] ? sp.durum : undefined;
  const from = parseDateParam(sp.from);
  const to = parseDateParam(sp.to);
  const dateFiltered = Boolean(from || to);

  const admin = createAdminClient();

  let subsQuery = admin
    .from("subscriptions")
    .select("id, plan, status, billing_cycle, amount_try, trial_ends_at, current_period_end, created_at, tenant:tenants(id, name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (durum) subsQuery = subsQuery.eq("status", durum);
  if (from) subsQuery = subsQuery.gte("created_at", from);
  if (to) subsQuery = subsQuery.lte("created_at", `${to}T23:59:59.999`);

  let invQuery = admin
    .from("invoices")
    .select("id, invoice_no, status, total_try, due_at, paid_at, created_at, reminder_count, last_reminder_at, tenant:tenants(id, name)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (from) invQuery = invQuery.gte("created_at", from);
  if (to) invQuery = invQuery.lte("created_at", `${to}T23:59:59.999`);

  // Halka, trend ve hero sayıları filtreden bağımsız — liste sorguları ayrı daralır
  const [{ data: subs }, { data: statRows }, { data: invoices }] = await Promise.all([
    subsQuery,
    admin.from("subscriptions").select("status, amount_try, created_at").limit(1000),
    invQuery,
  ]);

  const listRows = subs ?? [];
  const subRows = statRows ?? [];
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
              {[
                { key: "active", value: money(mrr), label: "Aktif aylık gelir", tone: "text-white" },
                { key: "trialing", value: String(trialing), label: "Deneme", tone: "text-amber-300" },
                { key: "past_due", value: String(pastDue), label: "Gecikmiş", tone: "text-danger-400" },
              ].map((k) => {
                const active = durum === k.key;
                return (
                  <Link
                    key={k.key}
                    href={billingHref({ durum: active ? undefined : k.key, from, to })}
                    aria-current={active ? "page" : undefined}
                    className={`focus-ring press group relative block rounded-[14px] border p-3 transition ${
                      active
                        ? "border-amber-300/50 bg-white/15"
                        : "border-white/12 bg-white/8 hover:border-white/25 hover:bg-white/12"
                    }`}
                  >
                    <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/40 opacity-0 transition group-hover:text-amber-300 group-hover:opacity-100" />
                    <p className={`font-display text-xl font-extrabold ${k.tone}`}>{k.value}</p>
                    <p className="text-[11px] text-white/70">{k.label}</p>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75">
                <TrendingUp className="h-3.5 w-3.5 text-amber-400" /> Aylık gelir trendi · 8 ay
              </p>
              <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-[11px] font-bold text-mint-300">{money(mrr)}</span>
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
              {/* Nokta başına native tooltip: ay + o ayki kümülatif gelir */}
              {pts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="8" fill="transparent" className="cursor-help">
                  <title>{`${months[i]?.label ?? ""}: ${money(trendVals[i] ?? 0)}`}</title>
                </circle>
              ))}
            </svg>
            <div className="mt-1 flex justify-between text-[10px] text-white/35">
              {trend.map((m) => (
                <span key={m.key}>{m.label}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tarih aralığı — yalnızca abonelik ve fatura LİSTELERİNİ daraltır */}
      <form
        action="/admin/billing"
        className="flex flex-wrap items-end gap-3 rounded-[16px] border border-line bg-surface p-3"
      >
        {durum ? <input type="hidden" name="durum" value={durum} /> : null}
        <label className="text-xs font-semibold text-text-muted">
          Başlangıç
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="mt-1 block rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink-950 outline-none focus:border-brand-400"
          />
        </label>
        <label className="text-xs font-semibold text-text-muted">
          Bitiş
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="mt-1 block rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink-950 outline-none focus:border-brand-400"
          />
        </label>
        <button
          type="submit"
          className="focus-ring press rounded-[9px] bg-ink-950 px-3 py-2 text-xs font-semibold text-white"
        >
          Uygula
        </button>
        {dateFiltered ? (
          <Link
            href={billingHref({ durum })}
            className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/15"
          >
            Tarih: {from ?? "…"} → {to ?? "…"} <X className="h-3 w-3" />
          </Link>
        ) : null}
        <p className="ml-auto text-[11px] text-text-faint">
          Aralık, abonelik ve fatura listelerine uygulanır; özet kartlar tüm veriyi gösterir.
        </p>
      </form>

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
                <p className="text-[10px] text-text-faint">abonelik</p>
              </div>
            </div>
            <div className="space-y-1 text-xs">
              {statusCounts.filter((s) => s.count > 0 || ["active", "trialing"].includes(s.key)).map((s) => {
                const active = durum === s.key;
                return (
                  <Link
                    key={s.key}
                    href={billingHref({ durum: active ? undefined : s.key, from, to })}
                    aria-current={active ? "page" : undefined}
                    title={active ? "Durum filtresini kaldır" : `Yalnızca "${s.label}" abonelikleri listele`}
                    className={`focus-ring flex items-center gap-2 rounded-[7px] px-1.5 py-0.5 transition ${
                      active ? "bg-brand-600/10 text-ink-950" : "text-text-muted hover:bg-canvas hover:text-ink-950"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    <span className={`flex-1 ${active ? "font-bold" : ""}`}>{s.label}</span>
                    <span className="font-bold text-ink-950">{s.count}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <CreditCard className="h-4 w-4 text-brand-600" /> Abonelikler
            </h2>
            {durum ? (
              <Link
                href={billingHref({ from, to })}
                className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/15"
              >
                Durum: {subStatus[durum]} <X className="h-3 w-3" />
              </Link>
            ) : null}
          </div>
          <div className="divide-y divide-line">
            {listRows.map((s) => {
              const tenantId = idOf(s.tenant as Rel);
              return (
              <div key={s.id} className="group relative grid gap-2 px-5 py-3 transition hover:bg-brand-600/[0.02] sm:grid-cols-[1.2fr_.8fr_.7fr_.7fr] sm:items-center">
                {tenantId ? (
                  <Link href={`/admin/tenants/${tenantId}`} className="absolute inset-0" aria-label={`${nameOf(s.tenant as Rel)} kaydını aç`} />
                ) : null}
                <p className="text-sm font-semibold text-ink-950">{nameOf(s.tenant as Rel)}</p>
                <p className="text-xs text-text-muted">{planLabel[s.plan] ?? s.plan} · {s.billing_cycle}</p>
                <p className="text-xs font-semibold text-ink-950">{money(Number(s.amount_try))}</p>
                <span className="w-fit rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-bold text-amber-600">
                  {subStatus[s.status] ?? s.status}
                </span>
              </div>
              );
            })}
            {listRows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-text-muted">
                {durum || dateFiltered ? "Filtreyle eşleşen abonelik yok." : "Abonelik kaydı yok."}
              </p>
            ) : null}
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
            {dateFiltered
              ? "Seçili tarih aralığında fatura yok."
              : "Henüz fatura yok. iyzico bağlandığında otomatik oluşacak; şimdilik abonelik iskeleti üzerinden takip edebilirsiniz."}
          </p>
        ) : (
          <div className="divide-y divide-line">
            {invRows.map((inv) => {
              const tenantId = idOf(inv.tenant as Rel);
              return (
              <div key={inv.id} className="group relative grid gap-2 px-5 py-3 transition hover:bg-brand-600/[0.02] sm:grid-cols-[1fr_.7fr_.7fr_.7fr] sm:items-center">
                {tenantId ? (
                  <Link href={`/admin/tenants/${tenantId}`} className="absolute inset-0" aria-label={`${inv.invoice_no} faturasının müşterisini aç`} />
                ) : null}
                <div>
                  <p className="text-sm font-semibold text-ink-950">{inv.invoice_no}</p>
                  <p className="text-xs text-text-muted">{nameOf(inv.tenant as Rel)}</p>
                </div>
                <p className="text-xs font-semibold">{money(Number(inv.total_try))}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-fit rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">
                    {invStatus[inv.status] ?? inv.status}
                  </span>
                  {Number(inv.reminder_count) > 0 ? (
                    // Dunning cron'unun bıraktığı iz: kaç hatırlatma gitti?
                    <span
                      className="w-fit rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-bold text-amber-600"
                      title={
                        inv.last_reminder_at
                          ? `Son hatırlatma: ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(inv.last_reminder_at))}`
                          : undefined
                      }
                    >
                      {inv.reminder_count} hatırlatma
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-text-faint">
                  {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(inv.created_at))}
                </p>
              </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
