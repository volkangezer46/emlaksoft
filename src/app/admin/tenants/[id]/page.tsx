import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTry } from "@/lib/format";
import Link from "@/components/ui/smart-link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Building2,
  ClipboardList,
  CreditCard,
  Gauge,
  History,
  KeyRound,
  LifeBuoy,
  Megaphone,
  ReceiptText,
  ScrollText,
  Settings2,
  Users,
  Wallet,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { AccountCreditPanel, type CreditGrantOption, type CreditMovementRow } from "./account-credit-panel";
import { tryBalance } from "@/lib/try-credits/wallet";
import { requirePlatformModule } from "@/lib/platform";
import { stopImpersonation } from "@/app/actions/platform";
import { adminAssignablePlans, getPlan, planLabelIn } from "@/lib/billing/plans";
import { DAY_MS, daysAgoIso, now, trDayKey } from "@/lib/clock";
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
import { OfficeSecurityPanel } from "./office-security-panel";
import { OfficeFlagsPanel } from "./office-flags-panel";
import { DemoDataPanel } from "./demo-data-panel";
import { loadTenantDemoState } from "@/lib/admin/demo-data";
import { loadOfficePolicyForm, policyIsActive } from "@/lib/office-security/read";
import { canChangeTrial } from "@/lib/billing/admin-billing-fixes";
import { isExpiredActive } from "@/lib/admin/platform-metrics";
import { platformCan, platformCanAccess } from "@/lib/platform-access";
import { ModulePanel } from "./module-panel";
import { loadTenantModuleState } from "@/lib/modules/state";
import { SubscriptionOpsConsole, SubscriptionPanel, type LimitView } from "./subscription-panel";
import { PaymentProfilePanel } from "./payment-profile-panel";
import { loadPaymentProfile, loadSubscriptionOps } from "@/lib/billing/subscription-ops";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { OfficeFinanceCard } from "@/app/admin/billing/muhasebe/office-finance-card";
import { SeatInfoCard, loadAdminSeatInfo } from "./seat-info";
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
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { CrmHeaderStrip, CrmRelationTab } from "./crm-panel";
import { effectiveStage, loadCrmCatalog, loadOfficeCrm, noteView, taskView } from "@/lib/admin/platform-crm";
import { HEALTH_DEFAULT_RISK_THRESHOLD } from "@/lib/admin/health-score";
import { officeAdminCan } from "@/lib/admin/office-admin-access";
import { CRM_SETTING_KEYS } from "@/lib/settings/registry/crm";
import { getSetting } from "@/lib/settings/read";
import { loadOfficeProgress } from "@/lib/admin/onboarding-progress";
import { OfficeProgressCard } from "../kurulum/office-progress";

const tenantStatusLabel: Record<string, string> = {
  trial: "Deneme",
  active: "Aktif",
  past_due: "Ödeme gecikmiş",
  suspended: "Askıda",
  cancelled: "İptal",
};

const TAB_META: Record<OfficeTab, { label: string; icon: typeof History }> = {
  zaman: { label: "Zaman çizelgesi", icon: History },
  iliski: { label: "İlişki", icon: ClipboardList },
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

export const metadata = { title: "Ofis 360" };

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
  const access = officeAccess(staff);
  const tabs = visibleTabs(access);
  const active = resolveOfficeTab(sp.sekme, tabs);
  const admin = createAdminClient();

  // Ofis satırı ve KPI okumaları yalnız `id`'ye bağlı → tek tur (önceden ardışık iki tur; ofis yoksa notFound yine kesinti).
  // CRM (AD5) başlığı da aynı turda: skor/aşama/sorumlu/etiket + "Görevlerim"; not/görev/trend yalnız İlişki sekmesinde.
  // Etkin limit (AD1 istisnası + ek koltuk) KPI şeridinde ve her sekmede gerekir: abonelik/istisna okuması da aynı turda.
  const nowMs = now();
  const [{ data: tenant }, kpiData, crm, crmCatalog, riskThreshold, catalogDefs, ops, impersonating] = await Promise.all([
    admin
      .from("tenants")
      .select("id, name, slug, plan, status, created_at, trial_ends_at, province_id, district_id, tax_office, tax_number, license_no, address_line, city, phone")
      .eq("id", id)
      .maybeSingle(),
    loadOfficeKpis(admin, id, access),
    loadOfficeCrm(admin, id, staff.id, active === "iliski"),
    loadCrmCatalog(admin),
    getSetting<number>(CRM_SETTING_KEYS.riskThreshold).catch(() => HEALTH_DEFAULT_RISK_THRESHOLD),
    getPlanDefinitions(),
    loadSubscriptionOps(admin, id, nowMs),
    // "Önizlemeyi bitir" yalnız bu personelin açık önizleme (impersonation) oturumu varken (B122; eskiden hep görünürdü).
    admin
      .from("platform_impersonation_sessions")
      .select("staff_id", { count: "exact", head: true })
      .eq("staff_id", staff.id)
      .then(({ count, error }) => !error && (count ?? 0) > 0),
  ]);
  if (!tenant) notFound();
  // Paket seçenekleri katalogdan (adminden eklenenler dahil; arşivli paket yalnız ofisin kendi paketiyse listelenir).
  // Business (gizli şablon) listede yok; ofisin kendi paketi her zaman listede (tek kural: adminAssignablePlans).
  const planOptions = adminAssignablePlans(catalogDefs, tenant.plan);

  const base = `/admin/tenants/${id}`;
  const tabHref = (t: OfficeTab) => `${base}?sekme=${t}`;
  const plan = catalogDefs.find((p) => p.id === tenant.plan) ?? getPlan(tenant.plan ?? "office");
  const limitRows = buildLimitRows(
    tenant.plan,
    { seats: kpiData.seats, properties: kpiData.properties, customers: kpiData.customers, branches: kpiData.branches },
    access.members ? tabHref("ekip") : undefined,
    catalogDefs,
    { extraSeats: ops.sub.extraSeats, overrides: ops.overrides, nowMs },
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
      value: planLabelIn(tenant.plan, catalogDefs),
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
  const staffName = (sid: string) => crmCatalog.staff.find((s) => s.id === sid)?.name ?? null;
  const crmCanEdit = officeAdminCan(staff, "note");
  const crmStage = effectiveStage(crm.stage, tenant.status ?? "trial");

  if (active === "iliski") {
    content = (
      <CrmRelationTab
        tenantId={id}
        ready={crm.ready}
        notes={crm.notes.map((n) => noteView(n, staffName))}
        tasks={crm.tasks.map((t) => taskView(t, nowMs, staffName))}
        trend={crm.trend}
        staff={crmCatalog.staff}
        meId={staff.id}
        canEdit={crmCanEdit}
        isSuper={staff.role === "super_admin"}
        threshold={riskThreshold}
      />
    );
  }

  else if (active === "yonetim") {
    const can = officeAdminCanMap(staff);
    const [mgmt, moduleState, securityPolicy, demo] = await Promise.all([
      loadOfficeManagement(admin, id, { withMembers: access.members, withNotes: can.note }),
      loadTenantModuleState(admin, id),
      loadOfficePolicyForm(admin, id),
      loadTenantDemoState(admin, id, nowMs).catch(() => null),
    ]);
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
        seatLimit={seatRow?.limit ?? plan.limits.seats}
        notes={mgmt.notes.map((n) => ({ ...n, createdLabel: relativeTimeTR(n.createdAt) }))}
        provinces={mgmt.provinces}
        plans={planOptions.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry, seats: p.limits.seats }))}
        legalHref={tabHref("yasal")}
        closureRequests={mgmt.closureRequests.map((r) => ({ ...r, dueLabel: r.dueAt.slice(0, 10) }))}
        canChangeTrial={canChangeTrial(staff)}
        canFixSubscription={platformCanAccess(staff, "billing")}
        expiredSubscription={
          kpiData.sub && isExpiredActive(kpiData.sub, now()) ? { periodEndLabel: fmtDay(kpiData.sub.current_period_end ?? null) ?? "—" } : null
        }
      />
      <ModulePanel
        tenantId={tenant.id}
        closed={moduleState.closed}
        locked={moduleState.locked}
        status={moduleState.status}
        canEdit={can.plan_status}
      />
      <OfficeSecurityPanel
        tenantId={tenant.id}
        policy={securityPolicy}
        active={policyIsActive(securityPolicy)}
        canReset={can.reset_security_policy}
      />
      <OfficeFlagsPanel tenantId={tenant.id} plan={tenant.plan ?? null} canEdit={staff.role === "super_admin" && platformCan(staff, "sistem", "write")} />
      {demo ? (
        <DemoDataPanel
          tenantId={tenant.id}
          canAct={staff.role === "super_admin"}
          view={{
            mode: demo.mode,
            seededLabel: fmtDay(demo.seededAt),
            clearedLabel: fmtDay(demo.realUseAt ?? demo.clearedAt),
            pack: demo.pack,
            locked: demo.locked,
            canReseed: demo.canReseed,
            realRecords: demo.realRecords,
            total: demo.total,
            rows: demo.rows.map((r) => ({ label: r.label, count: r.count })),
          }}
        />
      ) : null}
      </>
    );
  } else if (active === "zaman" || active === "yasal") {
    const tdata = await loadOfficeTimeline(admin, { id, name: tenant.name, created_at: tenant.created_at }, access, kpiData.sub);
    if (active === "zaman") {
      const all = buildOfficeTimeline({ ...tdata, catalog: catalogDefs });
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
    const [{ data: invoices }, { data: captures }, seatInfo, creditData, payment] = await Promise.all([
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
      // Koltuk bilgisi ve (yalnız süper admin için) hesap kredisi faturalarla birlikte, tek turda.
      loadAdminSeatInfo(admin, id, tenant.plan ?? "office", kpiData.seats),
      // Hesap kredisi yalnız süper admin: bakiye (RPC), son hareketler ve geri alma seçimi (aynı admin istemcisi).
      platformCan(staff, "billing", "approve") ? loadCreditData(admin, id) : Promise.resolve(null),
      // Ödeme profili: aynı turda (abonelik operasyon verisi `ops` sayfa başında okundu).
      loadPaymentProfile(admin, id),
    ]);
    // Konsol limit tablosu sayfa başındaki etkin limit satırlarıyla AYNI kaynaktan (çift hesap yok).
    const OPS_KEY: Record<string, LimitView["key"]> = { seats: "seats", properties: "active_properties", customers: "customers", branches: "branches" };
    const opsLimits: LimitView[] = limitRows.map((r) => ({ key: OPS_KEY[r.key]!, plan: r.planLimit ?? null, effective: r.limit, used: r.used }));
    content = (
      <div className="space-y-6">
        {access.billing ? (
          <OfficeFinanceCard admin={admin} tenantId={id} sub={kpiData.sub} subscriptionHref={billingHref} />
        ) : null}
        <SubscriptionOpsConsole
          tenantId={id}
          data={ops}
          plans={planOptions.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry }))}
          limits={opsLimits}
          todayKey={trDayKey(nowMs)}
        />
        <SeatInfoCard info={seatInfo} teamHref={access.members ? tabHref("ekip") : undefined} tenantId={id} canEdit={access.billing} />
        <PaymentProfilePanel tenantId={id} data={payment} />
        <SubscriptionTab
          sub={kpiData.sub}
          tenantStatus={tenantStatusLabel[tenant.status] ?? tenant.status}
          invoices={invoices ?? []}
          captures={captures ?? []}
          billingHref={billingHref}
        />
        {creditData ? <AccountCreditPanel tenantId={id} grants={creditData.grants} movements={creditData.movements} balance={creditData.balance} /> : null}
      </div>
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
    // Kurulum ilerlemesi (SN5) kullanım okumasıyla aynı turda.
    const [{ data: usageLogs }, onboarding] = await Promise.all([
      admin
        .from("audit_logs")
        .select("action, actor_id, created_at")
        .eq("tenant_id", id)
        .gte("created_at", daysAgoIso(30))
        .order("created_at", { ascending: false })
        .limit(USAGE_LIMIT),
      loadOfficeProgress(id).catch(() => ({ ready: true, rows: [], error: "okunamadı" })),
    ]);
    const usageRows = usageLogs ?? [];
    const usageTruncated = usageRows.length >= USAGE_LIMIT;
    const totalOps = usageRows.length;
    const activeActors = new Set(usageRows.map((r) => r.actor_id).filter(Boolean)).size;
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
        <OfficeProgressCard progress={onboarding.rows.find((r) => r.tenantId === id) ?? null} ready={onboarding.ready} />
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
              <EmptyState variant="compact" bare icon={Gauge} tone="amber" title="Son 30 günde kullanım kaydı yok" description="Kayıp riski yüksek: ofisle iletişime geçmeyi düşünün." />
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
        {/* Veri paketi kasası yalnız yetkili rolde (B122: route yalnız ops/süper admine izin veriyordu, düğme herkese görünüyordu). */}
        {officeAdminCan(staff, "export_vault") ? <ExportVault tenantId={id} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/tenants" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ofis listesi
      </Link>

      <AdminPageHeader
        art="office"
        eyebrow="Ofis 360"
        title={tenant.name}
        description={`${planLabelIn(tenant.plan, catalogDefs)} · ${tenantStatusLabel[tenant.status] ?? tenant.status} · yönetici erişimiyle güvenli okuma`}
        actions={
          <>
            {/* Abonelik durumu düzeltmesi yalnız billing:write (B122); paket değişikliği Abonelik sekmesinde (B118). */}
            {platformCan(staff, "billing", "write") ? <SubscriptionPanel tenantId={tenant.id} currentStatus={tenant.status ?? "trial"} /> : null}
            {/* Tek ofise mesaj: Toplu duyuru formu bu ofise ön dolu açılır (kanal, zaman ve önizleme orada). */}
            {platformCanAccess(staff, "broadcast") ? (
              <ButtonLink variant="outline" size="md" href={`/admin/duyuru?yeni=1&ofis=${tenant.id}`}>
                <Megaphone className="h-4 w-4" aria-hidden /> Mesaj gönder
              </ButtonLink>
            ) : null}
            {impersonating ? (
              <form action={stopImpersonation}>
                <Button variant="outline" size="md" type="submit">
                  Önizlemeyi bitir
                </Button>
              </form>
            ) : null}
          </>
        }
      >
        <KpiGrid label="Ofis göstergeleri">
          {kpis.map((k) => (
            <KpiCard key={k.label} layout="inline" label={k.label} value={k.value} href={k.href} icon={k.icon} tone="brand" hint={k.hint} />
          ))}
        </KpiGrid>
        {crm.ready ? (
          <CrmHeaderStrip
            tenantId={id}
            score={crm.score}
            threshold={riskThreshold}
            stage={crmStage.stage}
            stageAuto={crmStage.auto}
            ownerId={crm.ownerId}
            tagIds={crm.tagIds}
            tags={crmCatalog.tags}
            staff={crmCatalog.staff}
            myTasks={crm.myTasks.map((t) => taskView(t, nowMs, staffName))}
            meId={staff.id}
            canEdit={crmCanEdit}
            relationHref={tabHref("iliski")}
          />
        ) : null}
      </AdminPageHeader>

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

/**
 * Hesap kredisi verisi: bakiye (try_credit_balance), son 20 TL hareketi (account_credit_ledger, unit=try) ve geri alma
 * seçimi. Defter anahtarı `try:grant:<ofis>:<idem>`; geri alma eylemi `original_idem` olarak <idem> bekler.
 * Hata/tablo yoksa boş (form genel geri almayla çalışır).
 */
async function loadCreditData(admin: ReturnType<typeof createAdminClient>, tenantId: string) {
  const [balance, { data, error }] = await Promise.all([
    tryBalance(admin, tenantId),
    admin
      .from("account_credit_ledger")
      .select("idempotency_key, amount, entry_type, feature, created_at")
      .eq("tenant_id", tenantId)
      .eq("unit", "try")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const rows = error || !data ? [] : (data as { idempotency_key: string; amount: number | string; entry_type: string; feature: string | null; created_at: string }[]);
  const prefix = `try:grant:${tenantId}:`;
  const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" });
  const movements: CreditMovementRow[] = rows.map((r) => ({
    entryType: r.entry_type,
    amount: Number(r.amount),
    dateLabel: fmt.format(new Date(r.created_at)),
    grantIdem: r.entry_type === "grant" && r.idempotency_key.startsWith(prefix) ? r.idempotency_key.slice(prefix.length) : null,
  }));
  const grants: CreditGrantOption[] = rows
    .filter((r) => r.feature?.startsWith("try_grant:") && r.idempotency_key.startsWith(prefix))
    .map((r) => ({
      idem: r.idempotency_key.slice(prefix.length),
      label: `${fmt.format(new Date(r.created_at))} · ${formatTry(Number(r.amount))} · ${(r.feature ?? "").replace("try_grant:", "")}`,
    }));
  return { balance, movements, grants };
}
