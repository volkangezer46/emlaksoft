"use client";

import { useTransition, useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Clock,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  updateStaffRole,
  deactivateStaff,
  reactivateStaff,
} from "@/app/actions/platform-staff";
import { PLATFORM_ROLE_LABELS, type PlatformRole } from "@/lib/platform-access";
import { Badge } from "@/components/ui/badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { daysAgoIso } from "@/lib/clock";
import { relativeTimeTR } from "@/lib/admin-format";
import { staffKpi } from "./staff-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type StaffRow = {
  id: string;
  email: string;
  full_name: string;
  role: PlatformRole;
  is_active: boolean;
  created_at: string;
  last_sign_in_at?: string | null;
};

type StatusFilter = "all" | "active" | "passive" | "recent" | "never";

// ---------------------------------------------------------------------------
// Role badge colours
// ---------------------------------------------------------------------------
const roleCls: Record<PlatformRole, string> = {
  super_admin: "bg-amber-400/15 text-amber-600",
  ops: "bg-brand-600/12 text-brand-600",
  support: "bg-cyan-400/12 text-cyan-600",
  billing: "bg-mint-500/12 text-mint-600",
};

// ---------------------------------------------------------------------------
// Staff row — inline role change + deactivate
// ---------------------------------------------------------------------------
function StaffRow({ member, onDone }: { member: StaffRow; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function changeRole(e: React.ChangeEvent<HTMLSelectElement>) {
    const fd = new FormData();
    fd.set("id", member.id);
    fd.set("role", e.target.value);
    setErr(null);
    startTransition(async () => {
      const res = await updateStaffRole(fd);
      if (res.error) setErr(res.error);
      else onDone();
    });
  }

  // Pasifleştirme ConfirmDialog üzerinden gelir (dialog kendi transition'ını yönetir)
  async function deactivate() {
    const fd = new FormData();
    fd.set("id", member.id);
    setErr(null);
    const res = await deactivateStaff(fd);
    if (res.error) setErr(res.error);
    else onDone();
  }

  function reactivate() {
    const fd = new FormData();
    fd.set("id", member.id);
    setErr(null);
    startTransition(async () => {
      const res = await reactivateStaff(fd);
      if (res.error) setErr(res.error);
      else onDone();
    });
  }

  return (
    <TR>
      <TD>
        <Link
          href={`/admin/personel/${member.id}`}
          title="Personel detayı ve aktivitesi"
          className="font-semibold text-ink-950 transition hover:text-brand-600"
        >
          {member.full_name}
        </Link>
        <p className="text-xs text-text-faint">{member.email}</p>
        {err ? <p className="mt-0.5 text-xs font-medium text-danger-600" role="alert">{err}</p> : null}
      </TD>
      <TD>
        <div className="relative">
          <select
            defaultValue={member.role}
            onChange={changeRole}
            disabled={pending || !member.is_active}
            aria-label={`${member.full_name} rolü`}
            className={`focus-ring appearance-none rounded-[var(--radius-control)] border border-hairline bg-canvas py-1.5 pl-2.5 pr-8 text-xs font-semibold outline-none disabled:opacity-50 ${roleCls[member.role]}`}
          >
            {(Object.entries(PLATFORM_ROLE_LABELS) as [PlatformRole, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-current opacity-60" />
        </div>
      </TD>
      <TD>
        <Badge variant={member.is_active ? "success" : "outline"} size="sm">
          {member.is_active ? "Aktif" : "Pasif"}
        </Badge>
      </TD>
      <TD align="right" className="text-xs text-text-muted">
        {member.last_sign_in_at ? relativeTimeTR(member.last_sign_in_at) : "Hiç giriş yok"}
      </TD>
      <TD align="right" className="text-xs text-text-muted">
        {new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium" }).format(new Date(member.created_at))}
      </TD>
      <TD align="right">
        {member.is_active ? (
          <ConfirmDialog
            trigger={
              <button
                type="button"
                disabled={pending}
                className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-danger-500/30 bg-surface px-2.5 py-1.5 text-xs font-semibold text-danger-600 shadow-[var(--elev-1)] transition hover:bg-danger-500/8 disabled:opacity-50"
              >
                <UserMinus className="h-3 w-3" /> Pasif yap
              </button>
            }
            title={`${member.full_name} pasif yapılsın mı?`}
            description="Pasif personel admin paneline giriş yapamaz. Kayıt silinmez; daha sonra tekrar aktif edilebilir."
            confirmLabel="Pasif yap"
            onConfirm={deactivate}
          />
        ) : (
          <button
            type="button"
            onClick={reactivate}
            disabled={pending}
            className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-mint-500/30 bg-surface px-2.5 py-1.5 text-xs font-semibold text-mint-700 shadow-[var(--elev-1)] transition hover:bg-mint-500/8 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><UserPlus className="h-3 w-3" /> Aktif yap</>}
          </button>
        )}
      </TD>
    </TR>
  );
}

/** İki tabloda (aktif/pasif) aynı başlıklar — tek yerde tutuluyor. */
function StaffTable({ rows, onDone }: { rows: StaffRow[]; onDone: () => void }) {
  return (
    <TableFrame minWidth={780} className="rounded-none border-0 shadow-none">
      <Table>
        <THead>
          <TR>
            <TH>Personel</TH>
            <TH>Rol</TH>
            <TH>Durum</TH>
            <TH align="right">Son giriş</TH>
            <TH align="right">Katılım</TH>
            <TH align="right">İşlem</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((m) => <StaffRow key={m.id} member={m} onDone={onDone} />)}
        </TBody>
      </Table>
    </TableFrame>
  );
}

// ---------------------------------------------------------------------------
// Page — client component, veriyi /api/admin/personel üzerinden çeker
// ---------------------------------------------------------------------------
/** Yükleme iskeleti — "Yükleniyor…" metni yerine tablonun kendi ritmi. */
function StaffSkeleton() {
  return (
    <div className="animate-pulse space-y-2 px-5 py-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-9 flex-1 rounded-[var(--radius-control)] bg-ink-950/8" />
          <div className="h-9 w-28 rounded-[var(--radius-control)] bg-ink-950/8" />
          <div className="h-9 w-20 rounded-[var(--radius-control)] bg-ink-950/8" />
        </div>
      ))}
    </div>
  );
}

/** Türkçe duyarsız arama: "sisli" → "Şişli", "OZGUR" → "Özgür". */
function normalizeTr(v: string) {
  return v
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export default function PersonelPage() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<PlatformRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const load = useCallback(() => {
    // Durum güncellemeleri bilinçli olarak `.then()` içinde: `async/await`
    // gövdesinde yazıldığında React Compiler bunu efektten senkron setState
    // sayıyor. Baştaki `setLoading(true)` de kaldırıldı — `loading` zaten
    // `true` başlıyor; manuel yenilemelerde liste yerinde güncellenir.
    return fetch("/api/admin/personel")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StaffRow[] | null) => {
        if (data) setStaff(data);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Rol dağılımı arama/filtreden bağımsız: özet her zaman tüm kadroyu anlatır.
  const roleCounts = useMemo(
    () =>
      (Object.keys(PLATFORM_ROLE_LABELS) as PlatformRole[]).map((r) => ({
        role: r,
        label: PLATFORM_ROLE_LABELS[r],
        count: staff.filter((s) => s.is_active && s.role === r).length,
      })),
    [staff],
  );

  // KPI'lar gerçek satırlardan; "son 30 gün" eşiği clock.ts'ten.
  const since = useMemo(() => daysAgoIso(30), []);
  const kpi = useMemo(() => staffKpi(staff, since), [staff, since]);

  const filtered = useMemo(() => {
    const needle = normalizeTr(query.trim());
    return staff.filter((s) => {
      if (roleFilter !== "all" && s.role !== roleFilter) return false;
      if (statusFilter === "active" && !s.is_active) return false;
      if (statusFilter === "passive" && s.is_active) return false;
      if (statusFilter === "never" && (!s.is_active || s.last_sign_in_at)) return false;
      if (statusFilter === "recent" && (!s.is_active || !s.last_sign_in_at || s.last_sign_in_at < since)) return false;
      if (!needle) return true;
      return normalizeTr(`${s.full_name} ${s.email}`).includes(needle);
    });
  }, [staff, query, roleFilter, statusFilter, since]);

  const active = filtered.filter((s) => s.is_active);
  const passive = filtered.filter((s) => !s.is_active);
  const totalActive = kpi.active;
  const searching = Boolean(query.trim()) || roleFilter !== "all" || statusFilter !== "all";

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-amber-400/20 blur-[90px]" />
        <div className="relative">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-300">
                <ShieldCheck className="h-3.5 w-3.5" /> Platform personeli
              </p>
              <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Personel yönetimi</h1>
              <p className="mt-1.5 max-w-2xl text-sm text-white/65">
                EmlakSoft çalışanları · departman rolü, erişim ve durum yönetimi.
              </p>
            </div>
            <Link
              href="/admin/personel/yeni"
              className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-amber-400 px-4 py-2.5 text-sm font-bold text-ink-950"
            >
              <Plus className="h-4 w-4" /> Personel ekle
            </Link>
          </div>

          {/* Rol dağılımı — her kart o rolü filtreler */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {roleCounts.map((r) => {
              const isActive = roleFilter === r.role;
              return (
                <button
                  key={r.role}
                  type="button"
                  onClick={() => setRoleFilter(isActive ? "all" : r.role)}
                  aria-pressed={isActive}
                  title={isActive ? "Rol filtresini kaldır" : `Yalnızca ${r.label} rolünü göster`}
                  className={`focus-ring press group relative block rounded-[var(--radius-card)] border p-3.5 text-left transition ${
                    isActive
                      ? "border-amber-300/50 bg-white/15"
                      : "border-white/12 bg-white/8 backdrop-blur hover:border-white/25 hover:bg-white/12"
                  }`}
                >
                  <Users className="h-4 w-4 text-amber-300" />
                  <p className="numeric mt-2 font-display text-xl font-extrabold tabular-nums text-white">
                    {loading ? "—" : r.count}
                  </p>
                  <p className="text-xs text-white/70">{r.label}</p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* KPI şeridi — her kart listeyi süzer */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            { key: "active", label: "Aktif personel", value: kpi.active, icon: UserCheck },
            { key: "passive", label: "Pasif personel", value: kpi.passive, icon: UserX },
            { key: "recent", label: "Son 30 günde giriş", value: kpi.recentLogin, icon: Clock },
            { key: "never", label: "Hiç giriş yapmadı", value: kpi.neverLoggedIn, icon: UserPlus },
          ] as const
        ).map((k) => {
          const on = statusFilter === k.key;
          const Icon = k.icon;
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => setStatusFilter(on ? "all" : k.key)}
              aria-pressed={on}
              title={on ? "Filtreyi kaldır" : `${k.label}: listeyi süz`}
              className={`focus-ring press rounded-[var(--radius-card)] border bg-surface p-4 text-left transition hover:border-brand-300 ${
                on ? "border-brand-500 ring-2 ring-brand-500/25" : "border-line"
              }`}
            >
              <Icon className="h-4 w-4 text-brand-600" />
              <p className="numeric mt-2 font-display text-2xl font-extrabold tabular-nums text-ink-950">{loading ? "—" : k.value}</p>
              <p className="text-xs text-text-muted">{k.label}</p>
            </button>
          );
        })}
      </div>

      {/* Arama + filtre çubuğu */}
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ad soyad veya e-posta ara…"
            aria-label="Personel ara"
            className="focus-ring w-full rounded-[var(--radius-control)] border border-line bg-canvas px-8 py-2 text-sm outline-none transition focus:border-brand-400"
          />
        </div>
        {searching ? (
          <button
            type="button"
            onClick={() => { setQuery(""); setRoleFilter("all"); setStatusFilter("all"); }}
            className="focus-ring press inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600 transition hover:bg-brand-600/15"
          >
            Filtreleri temizle
          </button>
        ) : null}
        <p className="ml-auto text-xs text-text-faint">
          {loading ? "Kadro yükleniyor…" : `${totalActive} aktif personel · ${staff.length} kayıt`}
        </p>
      </div>

      {/* Aktif personel */}
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <ShieldCheck className="h-4 w-4 text-amber-600" />
          <h2 className="font-display font-bold text-ink-950">Aktif personel</h2>
          <span className="ml-auto rounded-full bg-brand-600/10 px-2.5 py-0.5 text-xs font-bold text-brand-600">{active.length}</span>
        </div>
        {loading ? (
          <StaffSkeleton />
        ) : active.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-semibold text-ink-950">
              {searching ? "Filtreyle eşleşen personel yok" : "Aktif personel yok"}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {searching
                ? "Arama terimini değiştirin ya da rol filtresini kaldırın."
                : "Sağ üstteki “Personel ekle” ile ilk EmlakSoft çalışanını ekleyin."}
            </p>
          </div>
        ) : (
          <StaffTable rows={active} onDone={load} />
        )}
      </section>

      {/* Pasif personel */}
      {passive.length > 0 ? (
        <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface opacity-70">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <UserMinus className="h-4 w-4 text-text-faint" />
            <h2 className="font-display font-bold text-ink-950">Pasif personel</h2>
            <span className="ml-auto rounded-full bg-canvas px-2.5 py-0.5 text-xs font-bold text-text-faint">{passive.length}</span>
          </div>
          <StaffTable rows={passive} onDone={load} />
        </section>
      ) : null}
    </div>
  );
}
