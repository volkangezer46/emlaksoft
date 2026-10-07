import Link from "next/link";
import { daysAgoIso, daysFromNowIso, isPast } from "@/lib/clock";
import { formatDateTr } from "@/lib/format";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Database,
  Hourglass,
  PieChart,
  Plus,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid, computeTrend } from "@/components/ui/kpi-card";
import { ChartCard } from "@/components/ui/chart-frame";
import { BarColumns } from "@/components/ui/viz/bar-columns";
import { DonutBreakdown } from "@/components/ui/viz/donut-breakdown";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { officeAdminCan } from "@/lib/admin/office-admin-access";
import { OFFICE_STATUS_LABELS } from "@/lib/admin/office-create-rules";
import { embeddedCount } from "@/lib/admin/platform-metrics";
import { exportTenantsCsv } from "@/app/actions/platform-export";
import { ExportButton } from "@/components/admin/export-button";
import { AdminActiveFilters, AdminChip, AdminInfo, AdminListCard, AdminListSearch } from "@/components/admin/admin-list";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { fetchAllPaged } from "@/lib/cron-run";
import { Pagination, PAGE_SIZE, pageRange } from "@/app/admin/_components/pagination";
import { isPlanId } from "@/lib/billing/plans";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import {
  DISTRIBUTION_LABELS,
  TENANT_STATUS_KEYS,
  activeChips,
  activityHealth,
  isFiltered,
  parseTenantFilters,
  tenantInventory,
  tenantsHref,
  toggleFilter,
  type InventoryRow,
} from "./tenants-model";
import { TenantTable, type TenantRowData } from "./tenant-table";

/** Durum renkleri (halka + lejant): token, iki temada çözülür. */
const STATUS_COLOR: Record<string, string> = {
  active: "var(--viz-pos)",
  trial: "var(--viz-gold)",
  past_due: "var(--viz-5)",
  suspended: "var(--viz-neg)",
  cancelled: "var(--viz-neutral)",
};

/** Hızlı süzgeç çipleri (filtre kontratı: her çip URL'i değiştirir, sunucu sorgusu buna göre daralır). */
const QUICK = [
  { key: "risk", label: "Riskli", param: "durum" as const, value: "risk" as const },
  { key: "bitiyor", label: "Denemesi bitiyor", param: "deneme" as const, value: "bitiyor" as const },
  { key: "yeni", label: "Son 30 gün kayıt", param: "yeni" as const, value: "30" as const },
  { key: "demo", label: "Demo veride", param: "veri" as const, value: "demo" as const },
  { key: "gercek", label: "Gerçek veride", param: "veri" as const, value: "gercek" as const },
];

export default async function AdminTenantsPage({
  searchParams,
}: {
  // Açık tip: link kontratı denetimi (check:links) okunan parametreleri buradan görür.
  searchParams?: Promise<{ q?: string; durum?: string; plan?: string; veri?: string; yeni?: string; deneme?: string; gun?: string; dagilim?: string; sayfa?: string; audit?: string }>;
}) {
  const staff = await requirePlatformModule("tenants");
  const canCreate = officeAdminCan(staff.role, "create");
  const perms = {
    // Satır içi durum/paket: mevcut eylem `updateTenantPlanStatus` billing modülü ister (aynı kapı).
    canEdit: officeAdminCan(staff.role, "plan_status") && platformCanAccess(staff.role, "billing"),
    canImpersonate: staff.role === "super_admin" || staff.role === "ops" || staff.role === "support",
    canResend: officeAdminCan(staff.role, "resend_access"),
  };
  const raw = (await searchParams) ?? {};
  const f = parseTenantFilters(raw, isPlanId);
  const page = f.sayfa ?? 1;
  const filtered = isFiltered(f);
  const auditFailed = raw.audit === "failed";
  const admin = createAdminClient();

  let listQuery = admin
    .from("tenants")
    .select("id, name, slug, plan, status, trial_ends_at, created_at, updated_at, sample_seeded_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(...pageRange(page));
  if (f.q) listQuery = listQuery.ilike("name", `%${f.q}%`);
  if (f.durum === "risk") listQuery = listQuery.in("status", ["past_due", "suspended"]);
  else if (f.durum) listQuery = listQuery.eq("status", f.durum);
  if (f.yeni) listQuery = listQuery.gte("created_at", daysAgoIso(Number(f.yeni)));
  if (f.deneme === "bitiyor") listQuery = listQuery.eq("status", "trial").gte("trial_ends_at", daysAgoIso(0)).lte("trial_ends_at", daysFromNowIso(7));
  if (f.deneme === "bitti") listQuery = listQuery.gte("trial_ends_at", daysAgoIso(Number(f.gun ?? "30"))).lte("trial_ends_at", daysAgoIso(0));
  if (f.plan) listQuery = listQuery.eq("plan", f.plan);
  if (f.veri === "demo") listQuery = listQuery.not("sample_seeded_at", "is", null);
  if (f.veri === "gercek") listQuery = listQuery.is("sample_seeded_at", null);

  // Envanter (KPI + grafikler) TÜM ofisleri anlatır; PostgREST 1000 satır sınırı için sıralı sayfalı okunur.
  const [{ data: tenants, count: tenantCount, error: listError }, inventoryRes, planDefs] = await Promise.all([
    listQuery,
    fetchAllPaged<InventoryRow>(
      (from, to) => admin.from("tenants").select("plan, status, sample_seeded_at, trial_ends_at, created_at").order("id").range(from, to),
      1000,
      50,
    ),
    getPlanDefinitions(),
  ]);

  const rows = tenants ?? [];
  const ids = rows.map((t) => t.id);
  const since14 = daysAgoIso(14);
  // Sayfadaki ofisler için gömülü sayımlar (DB'de sayılır; satır çekilmez → 1000 sınırına takılmaz).
  // Ayrı sorgular: biri hata verirse yalnız o sütun "—" olur, liste düşmez.
  const [membersRes, activityRes, ownersRes] = ids.length
    ? await Promise.all([
        admin.from("tenants").select("id, profiles!profiles_tenant_id_fkey(count)").in("id", ids),
        admin.from("tenants").select("id, audit_logs!audit_logs_tenant_id_fkey(count)").in("id", ids).gte("audit_logs.created_at", since14),
        admin.from("profiles").select("tenant_id, is_active").eq("role", "owner").in("tenant_id", ids),
      ])
    : [null, null, null];

  const memberCount = new Map<string, number>();
  if (membersRes && !membersRes.error) for (const r of membersRes.data ?? []) memberCount.set(r.id, embeddedCount((r as Record<string, unknown>).profiles));
  const activity = new Map<string, number>();
  if (activityRes && !activityRes.error) for (const r of activityRes.data ?? []) activity.set(r.id, embeddedCount((r as Record<string, unknown>).audit_logs));
  const owners = new Map<string, "active" | "inactive">();
  if (ownersRes && !ownersRes.error) {
    for (const o of ownersRes.data ?? []) {
      if (o.is_active) owners.set(o.tenant_id, "active");
      else if (!owners.has(o.tenant_id)) owners.set(o.tenant_id, "inactive");
    }
  }

  const inv = tenantInventory(inventoryRes.rows, { nowIso: daysAgoIso(0), ago30Iso: daysAgoIso(30), in7Iso: daysFromNowIso(7) });
  const inventoryPartial = Boolean(inventoryRes.error);
  const planName = (id: string) => planDefs.find((p) => p.id === id)?.name ?? id;
  const statusName = (id: string) => OFFICE_STATUS_LABELS[id] ?? id;
  const riskCount = inv.byStatus.past_due + inv.byStatus.suspended;
  const activeRate = inv.total ? Math.round((inv.byStatus.active / inv.total) * 100) : 0;
  const distribution = f.dagilim === "aktif" ? inv.byPlanActive : inv.byPlan;
  // Gizli planlar (örn. Business) yalnız bu planda ofis varsa listelenir.
  const planBars = [...planDefs]
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .filter((p) => !p.hidden || (inv.byPlan[p.id] ?? 0) > 0)
    .map((p) => ({
      label: p.name,
      value: distribution[p.id] ?? 0,
      href: f.dagilim === "aktif" ? tenantsHref({ ...f, sayfa: undefined, plan: f.plan === p.id ? undefined : p.id, durum: "active" }) : toggleFilter(f, "plan", p.id),
      active: f.plan === p.id,
      title: f.plan === p.id ? "Paket süzgecini kaldır" : `Yalnız ${p.name} paketini göster`,
    }));
  const chips = activeChips(f, planName, statusName);

  const tableRows: TenantRowData[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    plan: t.plan,
    status: t.status,
    updatedAt: t.updated_at ?? null,
    createdLabel: formatDateTr(t.created_at),
    trialLabel: t.trial_ends_at && (t.status === "trial" || isPast(t.trial_ends_at)) ? formatDateTr(t.trial_ends_at) : null,
    trialOver: Boolean(t.trial_ends_at && isPast(t.trial_ends_at)),
    members: membersRes && !membersRes.error ? (memberCount.get(t.id) ?? 0) : null,
    health: activityHealth(activityRes && !activityRes.error ? (activity.get(t.id) ?? 0) : null),
    sample: Boolean(t.sample_seeded_at),
    owner: ownersRes && !ownersRes.error ? (owners.get(t.id) ?? "none") : null,
    dataHref: toggleFilter(f, "veri", t.sample_seeded_at ? "demo" : "gercek"),
  }));

  const kpiHref = (durum: "active" | "trial" | "risk") => toggleFilter(f, "durum", durum);

  return (
    <div className="space-y-5">
      {auditFailed ? (
        <div role="alert" className="flex items-start justify-between gap-4 rounded-[var(--radius-card)] border border-danger-500/25 bg-danger-500/8 px-4 py-3 text-sm text-danger-600">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-bold">Destek oturumu kapatıldı ancak denetim kaydı doğrulanamadı.</p>
              <p className="mt-0.5 text-xs text-danger-600/85">Güvenlik ekibi hata kayıtlarını kontrol etmelidir; yeni destek oturumu başlatmadan önce olay kaydını doğrulayın.</p>
            </div>
          </div>
          <Link href="/admin/tenants" aria-label="Uyarıyı kapat" className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] hover:bg-danger-500/10">
            <X className="h-4 w-4" />
          </Link>
        </div>
      ) : null}

      <AdminPageHeader
        eyebrow="Ofis yönetimi"
        icon={Building2}
        title="Tüm ofisler"
        art="office"
        note={
          inv.newLast30 > 0 ? (
            <>
              Son 30 günde <strong>{inv.newLast30} yeni ofis</strong> katıldı.{" "}
              <Link href={tenantsHref({ yeni: "30" })}>Göster</Link>
            </>
          ) : inv.trialEnding7 > 0 ? (
            <>
              <strong>{inv.trialEnding7} ofisin</strong> denemesi 7 gün içinde bitiyor.{" "}
              <Link href={tenantsHref({ deneme: "bitiyor" })}>Göster</Link>
            </>
          ) : undefined
        }
        description={`${filtered ? `${tenantCount ?? rows.length} / ${inv.total} ofis · süzgeç etkin` : `${inv.total} ofis`} · paket ve durum burada yönetilir`}
        actions={
          <>
            {canCreate ? (
              <ButtonLink href="/admin/tenants/yeni" size="lg" variant="primary" icon={Plus}>
                Yeni ofis
              </ButtonLink>
            ) : null}
            <ExportButton action={exportTenantsCsv} label="Excel'e aktar" />
          </>
        }
      >
        <KpiGrid label="Ofis göstergeleri">
          <KpiCard
            layout="inline"
            label="Toplam ofis"
            value={inv.total}
            href={tenantsHref({})}
            icon={Building2}
            tone="brand"
            tinted={!filtered}
            trend={inv.totalPrev30 > 0 ? computeTrend(inv.total, inv.totalPrev30) : undefined}
            hint={inv.totalPrev30 > 0 ? "30 gün öncesine göre" : inv.newLast30 > 0 ? `Son 30 günde ${inv.newLast30} yeni` : "Tüm kayıtlı ofisler"}
          />
          <KpiCard
            layout="inline"
            label="Aktif"
            value={inv.byStatus.active}
            href={kpiHref("active")}
            icon={CheckCircle2}
            tone="success"
            tinted={f.durum === "active"}
            hint={inv.total ? `Ofislerin %${activeRate}'i aktif abone` : "Henüz ofis yok"}
          />
          <KpiCard
            layout="inline"
            label="Denemede"
            value={inv.byStatus.trial}
            href={kpiHref("trial")}
            icon={Hourglass}
            tone="gold"
            tinted={f.durum === "trial"}
            hint={inv.trialEnding7 > 0 ? `${inv.trialEnding7} tanesi 7 gün içinde bitiyor` : "7 gün içinde biten yok"}
          />
          <KpiCard
            layout="inline"
            label="Demo veri var"
            value={inv.demo}
            href={toggleFilter(f, "veri", "demo")}
            icon={Database}
            tone="neutral"
            tinted={f.veri === "demo"}
            hint="Gerçek kullanıma geçmedi"
          />
          <KpiCard
            layout="inline"
            label="Askıda / gecikmiş"
            value={riskCount}
            href={kpiHref("risk")}
            icon={AlertTriangle}
            tone="danger"
            tinted={f.durum === "risk"}
            attention={riskCount > 0}
            hint={`Gecikmiş ${inv.byStatus.past_due} · askıda ${inv.byStatus.suspended}`}
          />
        </KpiGrid>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <ChartCard
            title="Paket dağılımı"
            subtitle={f.dagilim === "aktif" ? "Aktif abonelerin paketlere göre dağılımı" : "Ofislerin paket türlerine göre dağılımı"}
            icon={BarChart3}
            tone="gold"
            height={0}
            action={
              <SegmentedControl
                label="Dağılım tabanı"
                value={f.dagilim ?? "tum"}
                options={(["tum", "aktif"] as const).map((k) => ({
                  value: k,
                  label: DISTRIBUTION_LABELS[k],
                  href: tenantsHref({ ...f, dagilim: k === "aktif" ? "aktif" : undefined }),
                }))}
              />
            }
            empty={inv.total === 0}
            emptyText="Henüz ofis yok; ilk ofis açıldığında paket dağılımı burada görünür."
          >
            <BarColumns data={planBars} ariaLabel="Pakete göre ofis sayısı (sütuna tıklayınca liste süzülür)" height={208} />
          </ChartCard>

          <ChartCard title="Ofis durumu" subtitle="Tüm ofislerin mevcut durum dağılımı" icon={PieChart} tone="success" height={0}>
            <DonutBreakdown
              ariaLabel="Duruma göre ofis dağılımı"
              size={164}
              stroke={22}
              empty="Henüz ofis yok"
              center={
                <div>
                  <p className="font-display text-2xl font-extrabold leading-none text-heading">%{activeRate}</p>
                  <p className="mt-1 text-xs text-text-muted">aktif</p>
                </div>
              }
              items={TENANT_STATUS_KEYS.map((k) => ({
                key: k,
                label: statusName(k),
                value: inv.byStatus[k],
                color: STATUS_COLOR[k],
                href: toggleFilter(f, "durum", k),
                active: f.durum === k,
                title: f.durum === k ? "Durum süzgecini kaldır" : `Yalnız "${statusName(k)}" ofisleri göster`,
              }))}
            />
          </ChartCard>
        </div>
        {inventoryPartial ? (
          <p role="status" className="mt-2 text-xs text-[var(--pm-warn-text)]">
            Envanter tam okunamadı ({inventoryRes.rows.length} ofis sayıldı); göstergeler eksik olabilir.
          </p>
        ) : null}
      </AdminPageHeader>

      <AdminListCard
        label="Ofis listesi"
        toolbar={
          <>
            <AdminListSearch
              action="/admin/tenants"
              defaultValue={f.q}
              placeholder="Ofis adı ara…"
              hidden={{ durum: f.durum, plan: f.plan, veri: f.veri, yeni: f.yeni, deneme: f.deneme, gun: f.gun && f.gun !== "30" ? f.gun : undefined, dagilim: f.dagilim }}
            />
            <nav aria-label="Hızlı süzgeçler" className="flex flex-wrap items-center gap-1.5">
              {QUICK.map((c) => (
                <AdminChip
                  key={c.key}
                  href={toggleFilter(f, c.param, c.value)}
                  on={f[c.param] === c.value}
                  count={c.key === "risk" ? riskCount : c.key === "bitiyor" ? inv.trialEnding7 : c.key === "yeni" ? inv.newLast30 : c.key === "demo" ? inv.demo : inv.total - inv.demo}
                  icon={c.key === "risk" ? <AlertTriangle aria-hidden="true" /> : c.key === "yeni" ? <Sparkles aria-hidden="true" /> : undefined}
                >
                  {c.label}
                </AdminChip>
              ))}
            </nav>
            <AdminInfo>Değişiklikler kaydedilince anında ofisin paneline yansır. Askıya alma erişimi keser.</AdminInfo>
          </>
        }
        filters={<AdminActiveFilters chips={chips} clearHref={tenantsHref({ dagilim: f.dagilim })} />}
      >
        {listError ? (
          <div role="alert" className="px-5 py-10 text-center text-sm text-[var(--pm-danger-text)]">
            Ofis listesi okunamadı. Sayfayı yenileyin; sorun sürerse Sistem &gt; Hatalar ekranına bakın.
          </div>
        ) : tableRows.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState
              illustration={filtered ? "aramaYok" : "baslangic"}
              title={filtered ? "Süzgeçle eşleşen ofis yok" : "Henüz kayıtlı ofis yok"}
              description={filtered ? "Arama terimini değiştirin ya da süzgeçleri kaldırın." : "İlk ofisi açın; paket ve durum burada yönetilir."}
              action={filtered ? { href: tenantsHref({ dagilim: f.dagilim }), label: "Süzgeçleri temizle" } : canCreate ? { href: "/admin/tenants/yeni", label: "İlk ofisi aç" } : undefined}
            />
          </div>
        ) : (
          <TenantTable rows={tableRows} plans={planDefs.map((p, i) => ({ id: p.id, name: p.name, order: p.order ?? i, hidden: Boolean(p.hidden) }))} perms={perms} />
        )}
      </AdminListCard>

      <Pagination page={page} total={tenantCount ?? 0} pageSize={PAGE_SIZE} hrefFor={(p) => tenantsHref({ ...f, sayfa: p })} />
    </div>
  );
}
