import Link from "next/link";
import { Activity, ArrowUpRight, Building2, ShieldAlert } from "lucide-react";
import { setTenantPlanStatus, startImpersonation } from "@/app/actions/platform";
import { exportTenantsCsv } from "@/app/actions/platform-export";
import { ExportButton } from "@/components/admin/export-button";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

const planLabel: Record<string, string> = {
  advisor: "Danışman",
  office: "Ofis",
  professional: "Profesyonel",
  enterprise: "Kurumsal",
};

const statusLabel: Record<string, string> = {
  trial: "Deneme",
  active: "Aktif",
  past_due: "Ödeme gecikmiş",
  suspended: "Askıda",
  cancelled: "İptal",
};

const statusCls: Record<string, string> = {
  trial: "bg-amber-400/15 text-amber-600",
  active: "bg-mint-500/12 text-mint-600",
  past_due: "bg-warn-500/10 text-warn-500",
  suspended: "bg-danger-500/10 text-danger-500",
  cancelled: "bg-ink-950/8 text-text-muted",
};

const statusTone: Record<string, string> = {
  trial: "var(--amber-400)",
  active: "var(--mint-500)",
  past_due: "var(--warn-500)",
  suspended: "var(--danger-500)",
  cancelled: "rgba(10,18,36,0.25)",
};

export default async function AdminTenantsPage() {
  await requirePlatformModule("tenants");
  const admin = createAdminClient();

  const [{ data: tenants }, { data: profiles }] = await Promise.all([
    admin.from("tenants").select("id, name, slug, plan, status, trial_ends_at, created_at").order("created_at", { ascending: false }).limit(500),
    admin.from("profiles").select("tenant_id").limit(2000),
  ]);

  const memberCount = new Map<string, number>();
  (profiles ?? []).forEach((p: { tenant_id: string }) => {
    memberCount.set(p.tenant_id, (memberCount.get(p.tenant_id) ?? 0) + 1);
  });

  const rows = tenants ?? [];
  const statusKeys = ["active", "trial", "past_due", "suspended", "cancelled"] as const;
  const statusCounts = statusKeys.map((k) => ({
    key: k,
    label: statusLabel[k],
    count: rows.filter((t) => t.status === k).length,
    color: statusTone[k],
  }));
  const total = Math.max(1, rows.length);
  let offset = 0;
  const arcs = statusCounts.map((s) => {
    const len = (s.count / total) * RING_C;
    const item = { ...s, dash: len, offset };
    offset += len;
    return item;
  });
  const activeRate = rows.filter((t) => t.status === "active").length / total;

  const planCounts = ["advisor", "office", "professional", "enterprise"].map((p) => ({
    key: p,
    label: planLabel[p],
    count: rows.filter((t) => t.plan === p).length,
  }));
  const maxPlan = Math.max(1, ...planCounts.map((p) => p.count));

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-amber-400/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-400">
              <Building2 className="h-4 w-4" /> Ofis envanteri
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white">Tüm ofisler</h1>
            <p className="mt-1 text-sm text-white/75">{rows.length} ofis · paket ve durum burada yönetilir</p>
            <div className="mt-4">
              <ExportButton action={exportTenantsCsv} label="Excel'e aktar" />
            </div>
            <div className="mt-5 flex h-20 items-end gap-2.5">
              {planCounts.map((p, i) => (
                <div key={p.key} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-white/80">{p.count}</span>
                  <div
                    className="bar-live w-full max-w-[26px] rounded-t-[5px] bg-gradient-to-t from-amber-500 to-amber-300"
                    style={{ height: `${Math.max((p.count / maxPlan) * 100, 10)}%`, animationDelay: `${i * 0.08}s` }}
                  />
                  <span className="text-[9px] text-white/65">{p.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
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
                    className="ring-sweep"
                    style={{ "--circ": RING_C, "--dash": RING_C - a.dash } as CSSProperties}
                  />
                ))}
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-xl font-extrabold text-white">%{Math.round(activeRate * 100)}</p>
                <p className="text-[9px] text-white/70">aktif</p>
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              {statusCounts.map((s) => (
                <div key={s.key} className="flex items-center gap-2 text-white/70">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1">{s.label}</span>
                  <span className="font-bold text-white">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-xs text-text-muted">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
          Değişiklikler anında ofisin paneline yansır. Askıya alma erişimi keser.
        </div>
        <div className="divide-y divide-line">
          {rows.map((t, i) => (
            <article
              key={t.id}
              className="grid gap-4 px-5 py-4 transition hover:bg-amber-400/[0.03] lg:grid-cols-[1.4fr_1fr_auto] lg:items-center"
              style={{ animationDelay: `${i * 0.03}s` }}
            >
              <div className="flex items-start gap-3">
                <span className="relative mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[image:var(--grad-ink)] text-amber-300">
                  <Building2 className="h-4 w-4" />
                  {t.status === "active" ? <span className="status-pulse absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-mint-500" /> : null}
                </span>
                <div>
                  <Link href={`/admin/tenants/${t.id}`} className="group inline-flex items-center gap-1 font-display text-base font-bold text-ink-950 transition hover:text-brand-600">
                    {t.name}
                    <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                  </Link>
                  <p className="mt-0.5 text-xs text-text-muted">
                    /{t.slug} · {memberCount.get(t.id) ?? 0} üye ·{" "}
                    {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(t.created_at))}
                  </p>
                  {t.trial_ends_at ? (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600">
                      <Activity className="h-3 w-3" />
                      Deneme bitiş: {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(t.trial_ends_at))}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusCls[t.status] ?? statusCls.trial}`}>
                  {statusLabel[t.status] ?? t.status}
                </span>
                <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[10px] font-bold text-brand-600">
                  {planLabel[t.plan] ?? t.plan}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <form action={setTenantPlanStatus} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <select name="plan" defaultValue={t.plan} className="rounded-[9px] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold outline-none focus:border-brand-400">
                    {Object.entries(planLabel).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <select name="status" defaultValue={t.status} className="rounded-[9px] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold outline-none focus:border-brand-400">
                    {Object.entries(statusLabel).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <button type="submit" className="rounded-[9px] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink-800">
                    Kaydet
                  </button>
                </form>
                <form action={startImpersonation}>
                  <input type="hidden" name="tenant_id" value={t.id} />
                  <button type="submit" className="rounded-[9px] border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-400/20">
                    Ofise gir
                  </button>
                </form>
              </div>
            </article>
          ))}
          {rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-text-muted">Henüz kayıtlı ofis yok.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
