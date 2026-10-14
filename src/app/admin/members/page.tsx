import { BarChart3, Building2, KeyRound, ShieldCheck, UserCheck, UserMinus, Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { formatTurkishPhone } from "@/lib/phone";
import { orIlike } from "@/lib/pgrst";
import { formatDateTr } from "@/lib/format";
import { relativeTimeTR } from "@/lib/admin-format";
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

type LoginFilter = "never" | "recent" | "stale";
type Filters = {
  tenant?: string;
  q?: string;
  durum?: "aktif" | "pasif";
  rol?: string;
  sube?: string;
  giris?: LoginFilter;
  tfa?: "acik" | "kapali";
  sayfa?: number;
};

const LOGIN_LABEL: Record<LoginFilter, string> = { recent: "Son 7 günde girdi", stale: "30+ gündür girmedi", never: "Hiç giriş yapmadı" };

function buildMembersHref(p: Filters) {
  const sp = new URLSearchParams();
  if (p.tenant) sp.set("tenant", p.tenant);
  if (p.q) sp.set("q", p.q);
  if (p.durum) sp.set("durum", p.durum);
  if (p.rol) sp.set("rol", p.rol);
  if (p.sube) sp.set("sube", p.sube);
  if (p.giris) sp.set("giris", p.giris);
  if (p.tfa) sp.set("tfa", p.tfa);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  const s = sp.toString();
  return s ? `/admin/members?${s}` : "/admin/members";
}

/** platform_member_search satırı (20261013004500). */
type SearchRow = {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  tenant_id: string | null;
  tenant_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  email: string | null;
  last_sign_in_at: string | null;
  two_factor_sms: boolean;
  total_count: number;
};

const missingFn = (e: { message?: string; code?: string } | null) => Boolean(e && /could not find|schema cache|PGRST202/i.test(`${e.message ?? ""}${e.code ?? ""}`));

type Rel = { name?: string } | { name?: string }[] | null;

function tenantName(value: Rel) {
  if (!value) return "—";
  return Array.isArray(value) ? (value[0]?.name ?? "—") : (value.name ?? "—");
}

type ListResult = { rows: SearchRow[]; total: number; error: boolean; legacy: boolean };

/**
 * Liste tek RPC turunda (profil + ofis + şube + auth e-posta/son giriş/2FA). RPC henüz uygulanmamışsa eski profil
 * sorgusuna düşer: e-posta araması ve giriş/2FA/şube süzgeçleri o yolda uygulanamaz (ekranda "kurulum bekliyor").
 */
async function loadMembers(admin: ReturnType<typeof createAdminClient>, f: Filters, page: number): Promise<ListResult> {
  const [from, to] = pageRange(page);
  const rpc = await admin.rpc("platform_member_search", {
    p_q: f.q ?? null,
    p_tenant: f.tenant ?? null,
    p_active: f.durum ? f.durum === "aktif" : null,
    p_role: f.rol ?? null,
    p_branch: f.sube ?? null,
    p_two_factor: f.tfa ? f.tfa === "acik" : null,
    p_login: f.giris ?? null,
    p_limit: to - from + 1,
    p_offset: from,
  });
  if (!rpc.error) {
    const rows = (rpc.data ?? []) as SearchRow[];
    if (rows.length === 0 && page > 1) {
      // Son sayfanın ötesi: toplamı ilk satırdan okuyamayız; head sayımı yerine boş liste + 0 doğru davranış.
      return { rows, total: 0, error: false, legacy: false };
    }
    return { rows, total: Number(rows[0]?.total_count ?? 0), error: false, legacy: false };
  }
  if (!missingFn(rpc.error)) return { rows: [], total: 0, error: true, legacy: false };

  let q = admin
    .from("profiles")
    .select("id, full_name, phone, role, is_active, created_at, tenant_id, branch_id, two_factor_sms, tenant:tenants!profiles_tenant_id_fkey(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (f.tenant) q = q.eq("tenant_id", f.tenant);
  if (f.q) q = q.or(orIlike(["full_name", "phone"], f.q));
  if (f.durum) q = q.eq("is_active", f.durum === "aktif");
  if (f.rol) q = q.eq("role", f.rol);
  if (f.sube) q = q.eq("branch_id", f.sube);
  if (f.tfa) q = q.eq("two_factor_sms", f.tfa === "acik");
  const { data, count, error } = await q;
  const rows: SearchRow[] = (data ?? []).map((m) => ({
    id: m.id,
    full_name: m.full_name,
    phone: m.phone ?? null,
    role: m.role,
    is_active: Boolean(m.is_active),
    created_at: m.created_at,
    tenant_id: m.tenant_id ?? null,
    tenant_name: tenantName(m.tenant as Rel),
    branch_id: m.branch_id ?? null,
    branch_name: null,
    email: null,
    last_sign_in_at: null,
    two_factor_sms: Boolean(m.two_factor_sms),
    total_count: count ?? 0,
  }));
  return { rows, total: count ?? 0, error: Boolean(error), legacy: true };
}

export const metadata = { title: "Üyeler" };

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams?: Promise<{ tenant?: string; q?: string; durum?: string; rol?: string; sube?: string; giris?: string; tfa?: string; sayfa?: string }>;
}) {
  const staff = await requirePlatformModule("members");
  const sp = (await searchParams) ?? {};
  const f: Filters = {
    tenant: sp.tenant && UUID_RE.test(sp.tenant.trim()) ? sp.tenant.trim() : undefined,
    q: (sp.q ?? "").trim().slice(0, 80) || undefined,
    durum: sp.durum === "aktif" || sp.durum === "pasif" ? sp.durum : undefined,
    rol: sp.rol && ROLE_KEYS.includes(sp.rol) ? sp.rol : undefined,
    sube: sp.sube && UUID_RE.test(sp.sube.trim()) ? sp.sube.trim() : undefined,
    giris: sp.giris === "never" || sp.giris === "recent" || sp.giris === "stale" ? sp.giris : undefined,
    tfa: sp.tfa === "acik" || sp.tfa === "kapali" ? sp.tfa : undefined,
  };
  const page = parsePage(sp.sayfa);
  const filtered = Boolean(f.tenant || f.q || f.durum || f.rol || f.sube || f.giris || f.tfa);
  const toggle = <K extends keyof Filters>(key: K, value: Filters[K]) => buildMembersHref({ ...f, [key]: f[key] === value ? undefined : value, sayfa: undefined });

  const admin = createAdminClient();

  // Özet kartlar ve rol grafiği filtreden bağımsız — tüm platformu anlatır (head sayımı: satır çekilmez).
  const roleCount = (role: string) => admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", role).eq("is_active", true);
  const [list, filterTenantRes, branchesRes, filterBranchRes, { count: allMembers }, { count: activeMembers }, { count: officeCount }, ...roleRes] =
    await Promise.all([
      loadMembers(admin, f, page),
      f.tenant ? admin.from("tenants").select("id, name").eq("id", f.tenant).maybeSingle() : Promise.resolve({ data: null as { id: string; name: string } | null }),
      // Şube süzgeci ofis seçilince açılır (platformda yüzlerce şube adı tek şeritte anlamsız).
      f.tenant
        ? admin.from("branches").select("id, name").eq("tenant_id", f.tenant).eq("is_active", true).order("name", { ascending: true }).limit(30)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      f.sube ? admin.from("branches").select("id, name").eq("id", f.sube).maybeSingle() : Promise.resolve({ data: null as { id: string; name: string } | null }),
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
      admin.from("tenants").select("id", { count: "exact", head: true }),
      ...ROLE_KEYS.map(roleCount),
    ]);

  const rows = list.rows;
  const memberTotal = list.total;
  const listError = list.error;
  const filterTenant = filterTenantRes.data;
  const filterBranch = filterBranchRes.data;
  const branches = (branchesRes.data ?? []) as { id: string; name: string }[];
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
    email: m.email,
    phone: m.phone ?? null,
    phoneDisplay: m.phone ? formatTurkishPhone(m.phone) : null,
    tenantId: m.tenant_id ?? null,
    tenantName: m.tenant_name ?? "—",
    branchName: m.branch_name,
    role: m.role,
    active: Boolean(m.is_active),
    twoFactor: Boolean(m.two_factor_sms),
    lastLoginLabel: list.legacy ? null : m.last_sign_in_at ? relativeTimeTR(m.last_sign_in_at) : "Hiç giriş yok",
    createdLabel: formatDateTr(m.created_at),
  }));

  const chips = [
    ...(f.q ? [{ key: "q", label: `Arama: ${f.q}`, removeHref: buildMembersHref({ ...f, q: undefined }) }] : []),
    ...(f.durum ? [{ key: "durum", label: `Durum: ${f.durum === "aktif" ? "Aktif" : "Pasif"}`, removeHref: buildMembersHref({ ...f, durum: undefined }) }] : []),
    ...(f.rol ? [{ key: "rol", label: `Rol: ${ROLE_LABELS[f.rol]}`, removeHref: buildMembersHref({ ...f, rol: undefined }) }] : []),
    ...(filterTenant ? [{ key: "tenant", label: `Ofis: ${filterTenant.name}`, removeHref: buildMembersHref({ ...f, tenant: undefined, sube: undefined }) }] : []),
    ...(f.sube ? [{ key: "sube", label: `Şube: ${filterBranch?.name ?? "—"}`, removeHref: buildMembersHref({ ...f, sube: undefined }) }] : []),
    ...(f.giris ? [{ key: "giris", label: LOGIN_LABEL[f.giris], removeHref: buildMembersHref({ ...f, giris: undefined }) }] : []),
    ...(f.tfa ? [{ key: "tfa", label: `SMS 2FA: ${f.tfa === "acik" ? "açık" : "kapalı"}`, removeHref: buildMembersHref({ ...f, tfa: undefined }) }] : []),
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
            <AdminListSearch
              action="/admin/members"
              defaultValue={f.q}
              placeholder={list.legacy ? "Ad soyad veya telefon ara…" : "Ad, e-posta veya telefon ara…"}
              hidden={{ tenant: f.tenant, durum: f.durum, rol: f.rol, sube: f.sube, giris: f.giris, tfa: f.tfa }}
            />
            <nav aria-label="Hızlı süzgeçler" className="flex flex-wrap items-center gap-1.5">
              <AdminChip href={toggle("rol", "owner")} on={f.rol === "owner"}>
                Ofis sahipleri
              </AdminChip>
              <AdminChip href={toggle("durum", "pasif")} on={f.durum === "pasif"} count={totalMembers - active}>
                Pasif
              </AdminChip>
              {list.legacy ? null : (
                <>
                  {(["recent", "stale", "never"] as const).map((g) => (
                    <AdminChip key={g} href={toggle("giris", g)} on={f.giris === g} icon={<KeyRound aria-hidden="true" />}>
                      {LOGIN_LABEL[g]}
                    </AdminChip>
                  ))}
                </>
              )}
              <AdminChip href={toggle("tfa", "acik")} on={f.tfa === "acik"} icon={<ShieldCheck aria-hidden="true" />}>
                2FA açık
              </AdminChip>
              <AdminChip href={toggle("tfa", "kapali")} on={f.tfa === "kapali"}>
                2FA kapalı
              </AdminChip>
            </nav>
            {branches.length > 0 ? (
              <nav aria-label="Şube süzgeci" className="flex flex-wrap items-center gap-1.5">
                {branches.map((b) => (
                  <AdminChip key={b.id} href={toggle("sube", b.id)} on={f.sube === b.id} icon={<Building2 aria-hidden="true" />}>
                    {b.name}
                  </AdminChip>
                ))}
              </nav>
            ) : null}
            {list.legacy ? <AdminInfo>E-posta araması ve son giriş süzgeci veritabanı güncellemesini bekliyor (20261013004500).</AdminInfo> : null}
            <AdminInfo>
              {staff.role === "super_admin" ? "Rol ve durum satırda değişir; Kaydet ile yazılır. Satır seçerek toplu pasifleştirme ve oturum kapatma yapılır." : staff.role === "ops" ? "Durum satırda değişir, satır seçimiyle toplu işlem yapılır; rol yalnız süper admin." : "Düzenleme yetkisi: süper admin ve operasyon."}
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
          <MembersTable rows={tableRows} canRole={staff.role === "super_admin"} canActive={staff.role === "super_admin" || staff.role === "ops"} showLogin={!list.legacy} />
        )}
      </AdminListCard>

      <Pagination page={page} total={memberTotal ?? 0} hrefFor={(p) => buildMembersHref({ ...f, sayfa: p })} />
    </div>
  );
}
