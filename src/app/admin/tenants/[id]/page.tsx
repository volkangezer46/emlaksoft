import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, ArrowUpRight, Building2, CalendarClock, Download, LifeBuoy, ShieldAlert, Users, Wallet } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { stopImpersonation } from "@/app/actions/platform";
import { PLANS } from "@/lib/billing/plans";
import { auditActionLabel, relativeTimeTR } from "@/lib/admin-format";
import { DAY_MS, daysAgoIso, now } from "@/lib/clock";
import { SubscriptionPanel } from "./subscription-panel";
import { CORE_MODULES, moduleForAction } from "./module-map";

const planLabel: Record<string, string> = {
  advisor: "Danışman",
  office: "Ofis",
  professional: "Profesyonel",
  enterprise: "Kurumsal",
};

const tenantStatusLabel: Record<string, string> = {
  trial: "Deneme",
  active: "Aktif",
  past_due: "Ödeme gecikmiş",
  suspended: "Askıda",
  cancelled: "İptal",
};

const subStatusLabel: Record<string, string> = {
  trialing: "Deneme",
  active: "Aktif",
  past_due: "Gecikmiş",
  cancelled: "İptal",
  paused: "Duraklatıldı",
};

const ticketStatusLabel: Record<string, string> = {
  open: "Açık",
  in_progress: "İşleniyor",
  waiting: "Yanıt bekliyor",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

const priorityLabel: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

const priorityCls: Record<string, string> = {
  low: "text-text-muted",
  normal: "text-brand-600",
  high: "text-amber-600",
  urgent: "text-danger-500",
};

export default async function AdminTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformModule("tenants");
  const { id } = await params;
  const admin = createAdminClient();

  // Kullanım analitiği: tek toplu sorgu, bellekte gruplanır (5000 üstü kesilir — uyarı gösterilir)
  const USAGE_LIMIT = 5000;
  const usageSince = daysAgoIso(30);

  // Hepsi yalnızca `id`'ye bağlı — tek turda paralel (notFound ödünü küçük)
  const [
    { data: tenant },
    { count: customers },
    { count: properties },
    { data: sub },
    { count: tickets },
    { data: openTickets },
    { data: usageLogs },
    { data: firstLogRows },
    { data: lastLogRows },
    { data: criticalEvents },
  ] = await Promise.all([
    admin.from("tenants").select("id, name, plan, status, created_at").eq("id", id).maybeSingle(),
    admin.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", id).is("deleted_at", null),
    admin.from("properties").select("id", { count: "exact", head: true }).eq("tenant_id", id),
    admin
      .from("subscriptions")
      .select("status, amount_try, plan, created_at, trial_ends_at, current_period_start, cancelled_at")
      .eq("tenant_id", id)
      .maybeSingle(),
    admin.from("support_tickets").select("id", { count: "exact", head: true }).eq("tenant_id", id).in("status", ["open", "in_progress", "waiting"]),
    admin
      .from("support_tickets")
      .select("id, subject, status, priority, created_at")
      .eq("tenant_id", id)
      .in("status", ["open", "in_progress", "waiting"])
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("audit_logs")
      .select("action, actor_id, created_at")
      .eq("tenant_id", id)
      .gte("created_at", usageSince)
      .order("created_at", { ascending: false })
      .limit(USAGE_LIMIT),
    admin.from("audit_logs").select("created_at").eq("tenant_id", id).order("created_at", { ascending: true }).limit(1),
    admin.from("audit_logs").select("created_at").eq("tenant_id", id).order("created_at", { ascending: false }).limit(1),
    admin
      .from("platform_audit_logs")
      .select("id, action, created_at")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (!tenant) notFound();

  // ---- Modül ısı haritası: action öneki → modül, son 30 gün 4 haftalık kova ----
  const usageRows = usageLogs ?? [];
  const usageTruncated = usageRows.length >= USAGE_LIMIT;
  const totalOps = usageRows.length;
  const activeActors = new Set(usageRows.map((r) => r.actor_id).filter(Boolean)).size;

  const nowMs = now();
  const heat = new Map<string, { buckets: [number, number, number, number]; total: number }>();
  for (const r of usageRows) {
    const mod = moduleForAction(r.action);
    // 0 = en eski hafta (22-30 gün), 3 = son 7 gün
    const ageDays = (nowMs - new Date(r.created_at).getTime()) / DAY_MS;
    const bucket = 3 - Math.min(3, Math.max(0, Math.floor(ageDays / 7)));
    const cur = heat.get(mod) ?? { buckets: [0, 0, 0, 0] as [number, number, number, number], total: 0 };
    cur.buckets[bucket] += 1;
    cur.total += 1;
    heat.set(mod, cur);
  }
  const heatRows = [...heat.entries()]
    .map(([mod, v]) => ({ mod, ...v }))
    .sort((a, b) => b.total - a.total);
  const maxCell = Math.max(1, ...heatRows.flatMap((r) => r.buckets));
  const unusedModules = CORE_MODULES.filter((m) => !heat.has(m));
  const weekLabels = ["4 hf önce", "3 hf önce", "2 hf önce", "Son 7 gün"];

  // ---- Hesap zaman çizelgesi ----
  const firstActivity = firstLogRows?.[0]?.created_at ?? null;
  const lastActivity = lastLogRows?.[0]?.created_at ?? null;
  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";
  const timeline: { label: string; value: string; hint?: string }[] = [
    { label: "Kayıt tarihi", value: fmtDate(tenant.created_at) },
    { label: "İlk aktivite", value: firstActivity ? fmtDate(firstActivity) : "Henüz aktivite yok" },
    {
      label: "Son aktivite",
      value: lastActivity ? fmtDate(lastActivity) : "Henüz aktivite yok",
      hint: lastActivity ? relativeTimeTR(lastActivity) : undefined,
    },
  ];
  if (sub) {
    if (sub.status === "trialing") {
      timeline.push({
        label: "Deneme sürüyor",
        value: sub.trial_ends_at ? `Bitiş: ${fmtDate(sub.trial_ends_at)}` : "Bitiş tarihi tanımsız",
      });
    } else if (sub.status === "active") {
      timeline.push({
        label: "Deneme → abonelik geçişi",
        value: fmtDate(sub.current_period_start ?? sub.trial_ends_at ?? sub.created_at),
        hint: subStatusLabel[sub.status] ?? sub.status,
      });
    } else if (sub.status === "cancelled") {
      timeline.push({ label: "Abonelik iptali", value: fmtDate(sub.cancelled_at ?? null) });
    }
  }
  const criticalRows = criticalEvents ?? [];

  const openTicketRows = openTickets ?? [];

  const kpis: { label: string; value: string | number; icon: typeof Users; href: string | null }[] = [
    { label: "Müşteri", value: customers ?? 0, icon: Users, href: null },
    { label: "Portföy", value: properties ?? 0, icon: Building2, href: null },
    { label: "Açık talep", value: tickets ?? 0, icon: LifeBuoy, href: `/admin/tickets?tenant=${tenant.id}` },
    { label: "Abonelik", value: sub?.status ? (subStatusLabel[sub.status] ?? sub.status) : "—", icon: Wallet, href: "/admin/billing" },
  ];

  return (
    <div className="space-y-6">
      <Link href="/admin/tenants" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ofis listesi
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">Ofis kimliğiyle önizleme</p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">{tenant.name}</h1>
            <p className="mt-1 text-sm text-white/60">
              {planLabel[tenant.plan] ?? tenant.plan} · {tenantStatusLabel[tenant.status] ?? tenant.status} · yönetici
              erişimiyle güvenli okuma
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SubscriptionPanel
              tenantId={tenant.id}
              currentPlan={tenant.plan ?? "office"}
              currentStatus={tenant.status ?? "trial"}
              plans={PLANS.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry }))}
            />
            <form action={stopImpersonation}>
              <button type="submit" className="rounded-[10px] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950">
                Önizlemeyi bitir
              </button>
            </form>
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-4">
          {kpis.map((k) =>
            k.href ? (
              <Link
                key={k.label}
                href={k.href}
                className="focus-ring press group relative block rounded-[14px] border border-white/10 bg-white/5 p-4 transition hover:border-white/25 hover:bg-white/8"
              >
                <ArrowUpRight className="hover-action absolute right-3 top-3 h-4 w-4 text-white/40 opacity-0 transition group-hover:text-amber-300 group-hover:opacity-100" />
                <k.icon className="h-4 w-4 text-mint-400" />
                <p className="mt-2 font-display text-xl font-extrabold">{k.value}</p>
                <p className="text-[11px] text-white/45">{k.label}</p>
              </Link>
            ) : (
              <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-4">
                <k.icon className="h-4 w-4 text-mint-400" />
                <p className="mt-2 font-display text-xl font-extrabold">{k.value}</p>
                <p className="text-[11px] text-white/45">{k.label}</p>
              </div>
            ),
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* ---- Kullanım analitiği: modül × hafta ısı ızgarası ---- */}
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Activity className="h-4 w-4 text-brand-600" /> Kullanım analitiği · son 30 gün
            </h2>
            <div className="flex items-center gap-2 text-[11px] font-semibold text-text-muted">
              <span className="rounded-full bg-brand-600/8 px-2.5 py-1 text-brand-600">{totalOps} işlem</span>
              <span className="rounded-full bg-mint-500/10 px-2.5 py-1 text-mint-700">{activeActors} aktif kullanıcı</span>
            </div>
          </div>
          <div className="p-5">
            {usageTruncated ? (
              <p className="mb-3 rounded-[10px] border border-amber-400/40 bg-amber-400/8 px-3 py-2 text-[11px] font-semibold text-amber-700">
                Son 30 günde {USAGE_LIMIT}+ kayıt var; analiz ilk {USAGE_LIMIT} kayıtla sınırlı — yoğunluklar alt sınırdır.
              </p>
            ) : null}
            {heatRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-muted">Son 30 günde hiç kullanım kaydı yok — churn riski yüksek.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[440px]">
                  <div className="grid grid-cols-[minmax(96px,1.2fr)_repeat(4,minmax(56px,1fr))_52px] items-center gap-1.5 pb-1.5 text-[10px] font-bold uppercase tracking-wide text-text-faint">
                    <span>Modül</span>
                    {weekLabels.map((w) => (
                      <span key={w} className="text-center">{w}</span>
                    ))}
                    <span className="text-right">Toplam</span>
                  </div>
                  <div className="space-y-1.5">
                    {heatRows.map((r) => (
                      <div key={r.mod} className="grid grid-cols-[minmax(96px,1.2fr)_repeat(4,minmax(56px,1fr))_52px] items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-ink-950">{r.mod}</span>
                        {r.buckets.map((c, i) => (
                          <div
                            key={i}
                            title={`${r.mod} · ${weekLabels[i]}: ${c} işlem`}
                            className="h-7 cursor-help rounded-[7px] border border-line/60"
                            style={{
                              backgroundColor:
                                c > 0
                                  ? `color-mix(in srgb, var(--brand-600) ${Math.round(12 + (c / maxCell) * 88)}%, var(--surface))`
                                  : "color-mix(in srgb, var(--ink-950) 4%, var(--surface))",
                            }}
                          />
                        ))}
                        <span className="text-right text-xs font-bold tabular-nums text-text-muted">{r.total}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {unusedModules.length > 0 ? (
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-faint">Hiç kullanılmayan modüller</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unusedModules.map((m) => (
                    <span key={m} className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* ---- Hesap zaman çizelgesi ---- */}
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <CalendarClock className="h-4 w-4 text-brand-600" /> Hesap geçmişi
            </h2>
          </div>
          <div className="p-5">
            <ol className="relative space-y-4 border-l border-line pl-4">
              {timeline.map((t) => (
                <li key={t.label} className="relative">
                  <span className="absolute -left-[21.5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-brand-600" />
                  <p className="text-[11px] font-bold uppercase tracking-wide text-text-faint">{t.label}</p>
                  <p className="text-sm font-semibold text-ink-950">
                    {t.value}
                    {t.hint ? <span className="ml-1.5 text-[11px] font-normal text-text-muted">· {t.hint}</span> : null}
                  </p>
                </li>
              ))}
            </ol>
            <div className="mt-5 border-t border-line pt-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-text-faint">Son kritik olaylar</p>
              {criticalRows.length === 0 ? (
                <p className="mt-2 text-xs text-text-muted">Bu ofis için platform tarafında kritik olay kaydı yok.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {criticalRows.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate font-semibold text-ink-950">{auditActionLabel(e.action)}</span>
                      <span className="shrink-0 text-[11px] text-text-faint">{relativeTimeTR(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href="/admin/aktivite"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
              >
                Tüm aktivite kaydı <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-[20px] border border-warn-500/30 bg-warn-500/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-warn-500/15 text-warn-600">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display font-bold text-ink-950">Ayrılış & arşiv kasası</h2>
              <p className="mt-0.5 max-w-md text-xs text-text-muted">
                Sözleşme sonu / iptal durumunda tüm ofis verisini (müşteri, portföy, anlaşma, komisyon, dosya
                listesi) tek veri paketi olarak indirin — müşteriye teslim veya arşivleme için.
              </p>
            </div>
          </div>
          <a
            href={`/api/admin/tenants/${tenant.id}/export`}
            className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800"
          >
            <Download className="h-4 w-4" /> Veri paketini indir
          </a>
        </div>
      </section>

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <LifeBuoy className="h-4 w-4 text-brand-600" /> Son açık destek talepleri
          </h2>
          <Link
            href={`/admin/tickets?tenant=${tenant.id}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
          >
            Tümü <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        {openTicketRows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">Bu ofisin açık destek talebi yok.</p>
        ) : (
          <div className="divide-y divide-line">
            {openTicketRows.map((t) => (
              <div key={t.id} className="group relative flex items-center gap-3 px-5 py-3 transition hover:bg-brand-600/[0.02]">
                <Link href={`/admin/tickets/${t.id}`} className="absolute inset-0" aria-label={`${t.subject} talebini aç`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-950 transition group-hover:text-brand-600">{t.subject}</p>
                  <p className="mt-0.5 text-[11px] text-text-faint">
                    {ticketStatusLabel[t.status] ?? t.status} ·{" "}
                    <span className={`font-semibold ${priorityCls[t.priority] ?? ""}`}>{priorityLabel[t.priority] ?? t.priority}</span> ·{" "}
                    {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(t.created_at))}
                  </p>
                </div>
                <ArrowUpRight className="hover-action h-4 w-4 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
