import { BarChart3, Building2, UserCheck, UserMinus, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { formatTurkishPhone } from "@/lib/phone";
import { orIlike } from "@/lib/pgrst";
import { formatDateTr } from "@/lib/format";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminActiveFilters, AdminChip, AdminInfo, AdminListCard, AdminListSearch } from "@/components/admin/admin-list";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { ChartCard } from "@/components/ui/chart-frame";
import { BarColumns } from "@/components/ui/viz/bar-columns";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { ROLE_LABELS } from "@/lib/role-labels";
import { loadAvatarMap } from "@/lib/avatar-read";
import { MembersTable, type MemberRowData } from "./members-table";

/** Rol sırası (grafik + süzgeç): tek kaynak ROLE_LABELS anahtarları. */
const ROLE_KEYS = Object.keys(ROLE_LABELS);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Filters = { tenant?: string; q?: string; durum?: "aktif" | "pasif"; rol?: string; sayfa?: number };

function buildMembersHref(p: Filters) {
  const sp = new URLSearchParams();
  if (p.tenant) sp.set("tenant", p.tenant);
  if (p.q) sp.set("q", p.q);
  if (p.durum) sp.set("durum", p.durum);
  if (p.rol) sp.set("rol", p.rol);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  const s = sp.toString();
  return s ? `/admin/members?${s}` : "/admin/members";
}

type Rel = { name?: string } | { name?: string }[] | null;

function tenantName(value: Rel) {
  if (!value) return "—";
  return Array.isArray(value) ? (value[0]?.name ?? "—") : (value.name ?? "—");
}

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams?: Promise<{ tenant?: string; q?: string; durum?: string; rol?: string; sayfa?: string }>;
}) {
  const staff = await requirePlatformModule("members");
  const sp = (await searchParams) ?? {};
  const f: Filters = {
    tenant: sp.tenant && UUID_RE.test(sp.tenant.trim()) ? sp.tenant.trim() : undefined,
    q: (sp.q ?? "").trim().slice(0, 80) || undefined,
    durum: sp.durum === "aktif" || sp.durum === "pasif" ? sp.durum : undefined,
    rol: sp.rol && ROLE_KEYS.includes(sp.rol) ? sp.rol : undefined,
  };
  const page = parsePage(sp.sayfa);
  const filtered = Boolean(f.tenant || f.q || f.durum || f.rol);
  const toggle = <K extends keyof Filters>(key: K, value: Filters[K]) => buildMembersHref({ ...f, [key]: f[key] === value ? undefined : value, sayfa: undefined });

  const admin = createAdminClient();

  let memberQuery = admin
    .from("profiles")
    .select("id, full_name, phone, role, is_active, created_at, tenant_id, tenant:tenants!profiles_tenant_id_fkey(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(...pageRange(page));
  if (f.tenant) memberQuery = memberQuery.eq("tenant_id", f.tenant);
  // Ad + telefon birlikte taranır: destek ekibi çoğu zaman elinde numarayla gelir.
  if (f.q) memberQuery = memberQuery.or(orIlike(["full_name", "phone"], f.q));
  if (f.durum) memberQuery = memberQuery.eq("is_active", f.durum === "aktif");
  if (f.rol) memberQuery = memberQuery.eq("role", f.rol);

  // Özet kartlar ve rol grafiği filtreden bağımsız — tüm platformu anlatır (head sayımı: satır çekilmez).
  const roleCount = (role: string) => admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", role).eq("is_active", true);
  const [{ data, count: memberTotal, error: listError }, filterTenantRes, { count: allMembers }, { count: activeMembers }, { count: officeCount }, ...roleRes] =
    await Promise.all([
      memberQuery,
      f.tenant ? admin.from("tenants").select("id, name").eq("id", f.tenant).maybeSingle() : Promise.resolve({ data: null as { id: string; name: string } | null }),
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
      admin.from("tenants").select("id", { count: "exact", head: true }),
      ...ROLE_KEYS.map(roleCount),
    ]);

  const rows = data ?? [];
  const filterTenant = filterTenantRes.data;
  const totalMembers = allMembers ?? 0;
  const active = activeMembers ?? 0;
  const roleBars = ROLE_KEYS.map((r, i) => ({
    label: ROLE_LABELS[r] ?? r,
    value: roleRes[i]?.count ?? 0,
    href: toggle("rol", r),
    active: f.rol === r,
    title: f.rol === r ? "Rol süzgecini kaldır" : `Yalnız ${ROLE_LABELS[r]} rolündekileri göster`,
  })).filter((b) => b.value > 0 || b.active);

  const memberAvatars = await loadAvatarMap(rows.map((m) => m.id), admin);
  const tableRows: MemberRowData[] = rows.map((m) => ({
    avatarUrl: memberAvatars.get(m.id)?.avatar_url ?? null,
    avatarPreset: memberAvatars.get(m.id)?.avatar_preset ?? null,
    id: m.id,
    name: m.full_name,
    phone: m.phone ?? null,
    phoneDisplay: m.phone ? formatTurkishPhone(m.phone) : null,
    tenantId: m.tenant_id ?? null,
    tenantName: tenantName(m.tenant as Rel),
    role: m.role,
    active: Boolean(m.is_active),
    createdLabel: formatDateTr(m.created_at),
  }));

  const chips = [
    ...(f.q ? [{ key: "q", label: `Arama: ${f.q}`, removeHref: buildMembersHref({ ...f, q: undefined }) }] : []),
    ...(f.durum ? [{ key: "durum", label: `Durum: ${f.durum === "aktif" ? "Aktif" : "Pasif"}`, removeHref: buildMembersHref({ ...f, durum: undefined }) }] : []),
    ...(f.rol ? [{ key: "rol", label: `Rol: ${ROLE_LABELS[f.rol]}`, removeHref: buildMembersHref({ ...f, rol: undefined }) }] : []),
    ...(filterTenant ? [{ key: "tenant", label: `Ofis: ${filterTenant.name}`, removeHref: buildMembersHref({ ...f, tenant: undefined }) }] : []),
  ];

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="Üye envanteri"
        icon={Users}
        title="Tüm platform kullanıcıları"
        art="users"
        description={filtered ? `${memberTotal ?? rows.length} sonuç · toplam ${totalMembers} profil içinde süzülüyor` : `${totalMembers} profil · ofis bazlı görünüm`}
      >
        <KpiGrid label="Kullanıcı göstergeleri">
          <KpiCard layout="inline" label="Toplam kullanıcı" value={totalMembers || "—"} href="/admin/members" icon={Users} tone="gold" tinted={!filtered} hint={totalMembers ? undefined : "Henüz kullanıcı yok"} />
          <KpiCard layout="inline" label="Aktif" value={totalMembers ? active : "—"} href={toggle("durum", "aktif")} icon={UserCheck} tone="success" tinted={f.durum === "aktif"} hint={totalMembers ? `%${Math.round((active / totalMembers) * 100)} aktif` : "Henüz kullanıcı yok"} />
          <KpiCard layout="inline" label="Pasif" value={totalMembers ? totalMembers - active : "—"} href={toggle("durum", "pasif")} icon={UserMinus} tone="danger" tinted={f.durum === "pasif"} hint={totalMembers ? "Giriş yapamaz" : "Henüz kullanıcı yok"} />
          <KpiCard layout="inline" label="Ofis" value={officeCount ?? "—"} href="/admin/tenants" icon={Building2} tone="brand" hint={officeCount ? `ofis başına ~${Math.round(totalMembers / officeCount)} kullanıcı` : "Henüz ofis yok"} />
        </KpiGrid>
        {roleBars.length > 0 ? (
          <ChartCard className="mt-4" title="Rol dağılımı" subtitle="Aktif kullanıcıların ofis rollerine göre dağılımı · sütuna tıklayınca liste süzülür" icon={BarChart3} tone="brand" height={0}>
            <BarColumns data={roleBars} ariaLabel="Role göre aktif kullanıcı sayısı" height={180} tone="brand" />
          </ChartCard>
        ) : null}
      </AdminPageHeader>

      <AdminListCard
        label="Kullanıcı listesi"
        toolbar={
          <>
            <AdminListSearch action="/admin/members" defaultValue={f.q} placeholder="Ad soyad veya telefon ara…" hidden={{ tenant: f.tenant, durum: f.durum, rol: f.rol }} />
            <nav aria-label="Hızlı süzgeçler" className="flex flex-wrap items-center gap-1.5">
              <AdminChip href={toggle("rol", "owner")} on={f.rol === "owner"}>
                Ofis sahipleri
              </AdminChip>
              <AdminChip href={toggle("durum", "pasif")} on={f.durum === "pasif"} count={totalMembers - active}>
                Pasif
              </AdminChip>
            </nav>
            <AdminInfo>
              {staff.role === "super_admin" ? "Rol ve durum satırda değişir; Kaydet ile yazılır." : staff.role === "ops" ? "Durum satırda değişir; rol yalnız süper admin." : "Düzenleme yetkisi: süper admin ve operasyon."}
            </AdminInfo>
          </>
        }
        filters={<AdminActiveFilters chips={chips} clearHref="/admin/members" />}
      >
        {listError ? (
          <div role="alert" className="px-5 py-10 text-center text-sm text-[var(--pm-danger-text)]">
            Kullanıcı listesi okunamadı. Sayfayı yenileyin.
          </div>
        ) : tableRows.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState
              illustration={filtered ? "aramaYok" : "musteri"}
              title={filtered ? "Süzgeçle eşleşen kullanıcı yok" : "Henüz kullanıcı kaydı yok"}
              description={filtered ? "Arama terimini değiştirin ya da süzgeçleri kaldırın." : "Ofisler üye davet ettiğinde burada görünür."}
              action={filtered ? { href: "/admin/members", label: "Süzgeçleri temizle" } : { href: "/admin/tenants", label: "Ofislere git" }}
            />
          </div>
        ) : (
          <MembersTable rows={tableRows} canRole={staff.role === "super_admin"} canActive={staff.role === "super_admin" || staff.role === "ops"} />
        )}
      </AdminListCard>

      <Pagination page={page} total={memberTotal ?? 0} hrefFor={(p) => buildMembersHref({ ...f, sayfa: p })} />
    </div>
  );
}
