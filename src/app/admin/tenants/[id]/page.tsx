import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CreditCard,
  Gauge,
  History,
  KeyRound,
  LifeBuoy,
  ReceiptText,
  ScrollText,
  Settings2,
  Users,
  Wallet,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { stopImpersonation } from "@/app/actions/platform";
import { getPlan, planLabel, PLANS } from "@/lib/billing/plans";
import { DAY_MS, daysAgoIso, daysFromNowIso, now } from "@/lib/clock";
import { relativeTimeTR } from "@/lib/admin-format";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { MorphNav } from "@/components/ui/morph-tab-parts";
import { countByCategory, filterByCategory, resolveCategory } from "@/lib/activity-timeline";
import {
  TIMELINE_CATEGORIES,
  buildLimitRows,
  buildOfficeTimeline,
  limitText,
  loadOfficeKpis,
  loadOfficeTeam,
  loadOfficeTimeline,
  officeAccess,
  resolveOfficeTab,
  subscriptionEnd,
  tl,
  visibleTabs,
  type OfficeTab,
} from "@/lib/admin/office-360";
import { loadOfficeManagement, officeAdminCanMap } from "@/lib/admin/office-management";
import { OfficeManagement } from "./office-management";
import { ModulePanel } from "./module-panel";
import { loadTenantModuleState } from "@/lib/modules/state";
import { SubscriptionPanel } from "./subscription-panel";
import { CORE_MODULES, moduleForAction } from "./module-map";
import {
  BillingProfileTab,
  ExportVault,
  LegalTab,
  LimitsPanel,
  SubscriptionTab,
  SupportTab,
  TeamTab,
} from "./office-360-panels";

const tenantStatusLabel: Record<string, string> = {
  trial: "Deneme",
  active: "Aktif",
  past_due: "Ödeme gecikmiş",
  suspended: "Askıda",
  cancelled: "İptal",
};

const TAB_META: Record<OfficeTab, { label: string; icon: typeof History }> = {
  zaman: { label: "Zaman çizelgesi", icon: History },
  yonetim: { label: "Yönetim", icon: Settings2 },
  abonelik: { label: "Abonelik ve ödemeler", icon: CreditCard },
  destek: { label: "Destek", icon: LifeBuoy },
  kullanim: { label: "Kullanım ve limitler", icon: Gauge },
  ekip: { label: "Ekip ve oturumlar", icon: KeyRound },
  yasal: { label: "Yasal ve onaylar", icon: ScrollText },
  fatura: { label: "Fatura profili", icon: ReceiptText },
};

const TIMELINE_PAGE = 40;

type SP = Record<string, string | string[] | undefined>;

export default async function AdminTenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SP>;
}) {
  const staff = await requirePlatformModule("tenants");
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const access = officeAccess(staff.role);
  const tabs = visibleTabs(access);
  const active = resolveOfficeTab(sp.sekme, tabs);
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug, plan, status, created_at, trial_ends_at, province_id, district_id, tax_office, tax_number, license_no, address_line, city, phone")
    .eq("id", id)
    .maybeSingle();
  if (!tenant) notFound();

  const kpiData = await loadOfficeKpis(admin, id, access);
  const base = `/admin/tenants/${id}`;
  const tabHref = (t: OfficeTab) => `${base}?sekme=${t}`;
  const plan = getPlan(tenant.plan ?? "office");
  const limitRows = buildLimitRows(
    tenant.plan,
    { seats: kpiData.seats, properties: kpiData.properties, customers: kpiData.customers, branches: kpiData.branches },
    access.members ? tabHref("ekip") : undefined,
  );
  const seatRow = limitRows[0];
  const propRow = limitRows[1];
  const endIso = subscriptionEnd(kpiData.sub);
  const fmtDay = (iso: string | null) => (iso ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(iso)) : null);
  const billingHref = `/admin/billing?q=${encodeURIComponent(tenant.name)}`;

  // ---- KPI şeridi: yalnız gerçek ve yetkili veri ----
  const kpis: { label: string; value: string; hint?: string; icon: typeof Users; href: string }[] = [
    {
      label: "Paket",
      value: planLabel(tenant.plan),
      hint: endIso ? `${kpiData.sub?.status === "trialing" ? "Deneme bitişi" : "Bitiş"} ${fmtDay(endIso)}` : undefined,
      icon: Wallet,
      href: access.billing ? tabHref("abonelik") : tabHref("kullanim"),
    },
    { label: "Kullanıcı", value: limitText(seatRow), icon: Users, href: access.members ? tabHref("ekip") : tabHref("kullanim") },
    { label: "Aktif ilan", value: limitText(propRow), icon: Building2, href: tabHref("kullanim") },
  ];
  if (access.billing) {
    kpis.push({
      label: "Ödeme toplamı",
      value: tl(kpiData.paidTotal),
      hint: `${kpiData.paidCount} başarılı ödeme`,
      icon: CreditCard,
      href: tabHref("abonelik"),
    });
  }
  if (access.tickets) {
    kpis.push({ label: "Açık destek", value: String(kpiData.openTickets), icon: LifeBuoy, href: `/admin/tickets?tenant=${id}` });
  }
  if (access.members) {
    kpis.push({
      label: "Son giriş",
      value: kpiData.lastLogin ? relativeTimeTR(kpiData.lastLogin) : "Kayıt yok",
      icon: KeyRound,
      href: tabHref("ekip"),
    });
  }

  // ---- Aktif sekmenin içeriği (yalnız gereken veri çekilir) ----
  let content: ReactNode = null;

  if (active === "yonetim") {
    const can = officeAdminCanMap(staff.role);
    const mgmt = await loadOfficeManagement(admin, id, { withMembers: access.members, withNotes: can.note });
    const moduleState = await loadTenantModuleState(admin, id);
    content = (
      <>
      <OfficeManagement
        tenant={{
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug ?? "",
          plan: tenant.plan ?? "office",
          status: tenant.status ?? "trial",
          trialEndsLabel: fmtDay(tenant.trial_ends_at ?? null),
          phone: tenant.phone,
          city: tenant.city,
          provinceId: tenant.province_id ?? null,
          districtId: tenant.district_id ?? null,
          addressLine: tenant.address_line,
          licenseNo: tenant.license_no,
          taxOffice: tenant.tax_office,
          taxNumber: tenant.tax_number,
        }}
        can={can}
        owner={mgmt.owner}
        ownerCount={mgmt.ownerCount}
        members={mgmt.members}
        activeSeats={mgmt.activeSeats}
        seatLimit={plan.limits.seats}
        notes={mgmt.notes.map((n) => ({ ...n, createdLabel: relativeTimeTR(n.createdAt) }))}
        provinces={mgmt.provinces}
        plans={PLANS.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry, seats: p.limits.seats }))}
        minTrialDate={daysFromNowIso(1).slice(0, 10)}
        legalHref={tabHref("yasal")}
        closureRequests={mgmt.closureRequests.map((r) => ({ ...r, dueLabel: r.dueAt.slice(0, 10) }))}
      />
      <ModulePanel
        tenantId={tenant.id}
        closed={moduleState.closed}
        locked={moduleState.locked}
        status={moduleState.status}
        canEdit={can.plan_status}
      />
      </>
    );
  } else if (active === "zaman" || active === "yasal") {
    const tdata = await loadOfficeTimeline(admin, { id, name: tenant.name, created_at: tenant.created_at }, access, kpiData.sub);
    if (active === "zaman") {
      const all = buildOfficeTimeline(tdata);
      const counts = countByCategory(all);
      const cats = TIMELINE_CATEGORIES.filter((c) => (counts[c.key] ?? 0) > 0).map((c) => ({ ...c, count: counts[c.key] }));
      const kategori = resolveCategory(sp.kategori, cats.map((c) => c.key));
      const showAll = sp.tum === "1";
      const events = filterByCategory(all, kategori);
      const q = (extra: Record<string, string>) => {
        const u = new URLSearchParams({ sekme: "zaman", ...extra });
        return `${base}?${u.toString()}`;
      };
      content = (
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <ActivityTimeline
            events={events}
            categories={cats}
            activeCategory={kategori}
            hrefForCategory={(key) => (key ? q({ kategori: key }) : q({}))}
            emptyTitle="Bu kategoride olay yok"
            emptyHint="Kaynaklar rolünüze göre listelenir; müşteri kişisel verisi bu akışa alınmaz."
            pageSize={showAll ? 0 : TIMELINE_PAGE}
            loadMoreHref={q({ ...(kategori ? { kategori } : {}), tum: "1" })}
          />
        </section>
      );
    } else {
      content = (
        <LegalTab
          consents={tdata.consents}
          iys={tdata.iys}
          erasureCount={tdata.erasures.length}
          names={tdata.actorNames}
          access={access}
        />
      );
    }
  } else if (active === "abonelik") {
    const [{ data: invoices }, { data: captures }] = await Promise.all([
      admin
        .from("invoices")
        .select("id, invoice_no, status, total_try, due_at, paid_at, created_at")
        .eq("tenant_id", id)
        .order("created_at", { ascending: false })
        .limit(60),
      admin
        .from("billing_payment_captures")
        .select("id, status, amount_try, captured_at, fulfilled_at, refunded_at")
        .eq("tenant_id", id)
        .order("captured_at", { ascending: false })
        .limit(60),
    ]);
    content = (
      <SubscriptionTab
        sub={kpiData.sub}
        tenantStatus={tenantStatusLabel[tenant.status] ?? tenant.status}
        invoices={invoices ?? []}
        captures={captures ?? []}
        billingHref={billingHref}
      />
    );
  } else if (active === "destek") {
    const { data: tickets } = await admin
      .from("support_tickets")
      .select("id, subject, status, priority, created_at, resolved_at")
      .eq("tenant_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    content = <SupportTab tickets={tickets ?? []} tenantId={id} />;
  } else if (active === "ekip") {
    const team = await loadOfficeTeam(admin, id);
    content = <TeamTab members={team.members} failed30d={team.failed30d} tenantId={id} />;
  } else if (active === "fatura") {
    content = (
      <BillingProfileTab
        profile={{
          name: tenant.name,
          tax_office: tenant.tax_office,
          tax_number: tenant.tax_number,
          license_no: tenant.license_no,
          address_line: tenant.address_line,
          city: tenant.city,
          phone: tenant.phone,
        }}
      />
    );
  } else if (active === "kullanim") {
    // Kullanım analitiği: tek toplu sorgu, bellekte gruplanır (5000 üstü kesilir — uyarı gösterilir)
    const USAGE_LIMIT = 5000;
    const { data: usageLogs } = await admin
      .from("audit_logs")
      .select("action, actor_id, created_at")
      .eq("tenant_id", id)
      .gte("created_at", daysAgoIso(30))
      .order("created_at", { ascending: false })
      .limit(USAGE_LIMIT);
    const usageRows = usageLogs ?? [];
    const usageTruncated = usageRows.length >= USAGE_LIMIT;
    const totalOps = usageRows.length;
    const activeActors = new Set(usageRows.map((r) => r.actor_id).filter(Boolean)).size;
    const nowMs = now();
    const heat = new Map<string, { buckets: [number, number, number, number]; total: number }>();
    for (const r of usageRows) {
      const mod = moduleForAction(r.action);
      const ageDays = (nowMs - new Date(r.created_at).getTime()) / DAY_MS;
      const bucket = 3 - Math.min(3, Math.max(0, Math.floor(ageDays / 7)));
      const cur = heat.get(mod) ?? { buckets: [0, 0, 0, 0] as [number, number, number, number], total: 0 };
      cur.buckets[bucket] += 1;
      cur.total += 1;
      heat.set(mod, cur);
    }
    const heatRows = [...heat.entries()].map(([mod, v]) => ({ mod, ...v })).sort((a, b) => b.total - a.total);
    const maxCell = Math.max(1, ...heatRows.flatMap((r) => r.buckets));
    const unusedModules = CORE_MODULES.filter((m) => !heat.has(m));
    const weekLabels = ["4 hf önce", "3 hf önce", "2 hf önce", "Son 7 gün"];

    content = (
      <div className="space-y-4">
        <LimitsPanel rows={limitRows} planName={plan.name} />
        <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Activity className="h-4 w-4 text-brand-600" /> Kullanım analitiği · son 30 gün
            </h2>
            <div className="flex items-center gap-2 text-xs font-semibold text-text-muted">
              <span className="rounded-full bg-brand-600/8 px-2.5 py-1 text-brand-600">{totalOps} işlem</span>
              <span className="rounded-full bg-mint-500/10 px-2.5 py-1 text-mint-700">{activeActors} aktif kullanıcı</span>
            </div>
          </div>
          <div className="p-5">
            {usageTruncated ? (
              <p className="mb-3 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/8 px-3 py-2 text-xs font-semibold text-amber-700">
                Son 30 günde {USAGE_LIMIT}+ kayıt var; analiz ilk {USAGE_LIMIT} kayıtla sınırlı — yoğunluklar alt sınırdır.
              </p>
            ) : null}
            {heatRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-muted">Son 30 günde hiç kullanım kaydı yok — churn riski yüksek.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[440px]">
                  <div className="grid grid-cols-[minmax(96px,1.2fr)_repeat(4,minmax(56px,1fr))_52px] items-center gap-1.5 pb-1.5 text-xs font-bold uppercase tracking-wide text-text-faint">
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
                <p className="text-xs font-bold uppercase tracking-wide text-text-faint">Hiç kullanılmayan modüller</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unusedModules.map((m) => (
                    <span key={m} className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-700">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
        <ExportVault tenantId={id} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/tenants" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ofis listesi
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-300">Ofis 360</p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">{tenant.name}</h1>
            <p className="mt-1 text-sm text-white/60">
              {planLabel(tenant.plan)} · {tenantStatusLabel[tenant.status] ?? tenant.status} · yönetici erişimiyle güvenli okuma
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
              <button type="submit" className="rounded-[var(--radius-control)] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950">
                Önizlemeyi bitir
              </button>
            </form>
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className="focus-ring press group relative block rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4 transition hover:border-white/25 hover:bg-white/8"
            >
              <ArrowUpRight className="hover-action absolute right-3 top-3 h-4 w-4 text-white/40 opacity-0 transition group-hover:text-amber-300 group-hover:opacity-100" />
              <k.icon className="h-4 w-4 text-mint-400" />
              <p className="mt-2 font-display text-lg font-extrabold">{k.value}</p>
              <p className="text-xs text-white/45">{k.label}</p>
              {k.hint ? <p className="mt-0.5 text-xs text-white/60">{k.hint}</p> : null}
            </Link>
          ))}
        </div>
      </section>

      <MorphNav
        variant="underline"
        label="Ofis 360 sekmeleri"
        activeId={active}
        scroll={false}
        items={tabs.map((t) => ({ id: t, href: tabHref(t), label: TAB_META[t].label, icon: TAB_META[t].icon }))}
      />

      {content}
    </div>
  );
}
