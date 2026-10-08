"use client";

import { Input } from "@/components/ui/input";
import { KpiGrid } from "@/components/ui/dashboard-grid";
import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "@/components/ui/smart-link";
import {
  Clock,
  Crown,
  Eye,
  Headphones,
  Plus,
  Receipt,
  Search,
  Settings2,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";
import { InlineSelect, type InlineSelectOption } from "@/components/ui/inline-select";
import { RowSaveActions, rowDraftProps } from "@/components/ui/row-save-actions";
import { DraftTable } from "@/components/ui/draft-table";
import { ButtonLink } from "@/components/ui/button";
import { useRowDraft } from "@/lib/ui/use-row-draft";
import {
  updateStaffRole,
  deactivateStaff,
  reactivateStaff,
} from "@/app/actions/platform-staff";
import { PLATFORM_ROLE_LABELS, type PlatformRole } from "@/lib/platform-access";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { daysAgoIso } from "@/lib/clock";
import { relativeTimeTR } from "@/lib/admin-format";
import { staffKpi } from "./staff-model";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

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
// Rol / durum seçenekleri (satır içi kaydetme standardı: docs/DESIGN_SYSTEM.md)
// ---------------------------------------------------------------------------
const ROLE_META: Record<PlatformRole, Pick<InlineSelectOption, "icon" | "tone">> = {
  super_admin: { icon: Crown, tone: "gold" },
  ops: { icon: Settings2, tone: "brand" },
  support: { icon: Headphones, tone: "brand" },
  billing: { icon: Receipt, tone: "success" },
};
const ROLE_OPTIONS: InlineSelectOption[] = (Object.entries(PLATFORM_ROLE_LABELS) as [PlatformRole, string][]).map(([value, label]) => ({
  value,
  label,
  ...ROLE_META[value],
}));
const ACTIVE_OPTIONS: InlineSelectOption[] = [
  { value: "1", label: "Aktif", icon: UserCheck, tone: "success" },
  { value: "0", label: "Pasif", icon: UserX, tone: "neutral", hint: "Admin paneline giriş yapamaz" },
];

type StaffDraft = { role: string; active: string };

/** Saf kurallar: pasif personelin rolü (aynı kayıtta aktif edilmeden) değiştirilmez; pasifleştirme risklidir. */
function validateStaffRow(d: StaffDraft, s: StaffDraft) {
  if (d.role !== s.role && d.active === "0") return { ok: false as const, reason: "Pasif personelin rolü değiştirilemez; önce aktif edin." };
  return { ok: true as const };
}
function staffRisk(d: StaffDraft, s: StaffDraft) {
  if (d.active === "0" && s.active === "1") return "Personel admin paneline giriş yapamayacak.";
  if (d.role !== s.role && s.role === "super_admin") return "Süper admin yetkisi kaldırılıyor.";
  return null;
}

// ---------------------------------------------------------------------------
// Staff row — rol + durum taslağı, tek Kaydet
// ---------------------------------------------------------------------------
function StaffRow({ member, onDone }: { member: StaffRow; onDone: () => Promise<void> | void }) {
  const draft = useRowDraft<StaffDraft>({
    id: member.id,
    label: member.full_name,
    saved: { role: member.role, active: member.is_active ? "1" : "0" },
    validate: validateStaffRow,
    risk: staffRisk,
    save: async (d, { saved }) => {
      const fd = new FormData();
      fd.set("id", member.id);
      // Aktifleştirme önce (pasif personelin rolü değişmez), pasifleştirme en son.
      if (d.active === "1" && saved.active === "0") {
        const r = await reactivateStaff(fd);
        if (r.error) return { error: r.error };
      }
      if (d.role !== saved.role) {
        fd.set("role", d.role);
        const r = await updateStaffRole(fd);
        if (r.error) {
          await onDone();
          return { error: r.error };
        }
      }
      if (d.active === "0" && saved.active === "1") {
        const r = await deactivateStaff(fd);
        if (r.error) {
          await onDone();
          return { error: r.error };
        }
      }
      await onDone();
      return { ok: true };
    },
  });

  return (
    <TR {...rowDraftProps(draft)}>
      <TD>
        <Link
          href={`/admin/personel/${member.id}`}
          title="Personel detayı ve aktivitesi"
          className="font-semibold text-ink-950 transition hover:text-brand-600"
        >
          {member.full_name}
        </Link>
        <p className="text-xs text-text-faint">{member.email}</p>
      </TD>
      <TD>
        <InlineSelect
          value={draft.draft.role}
          onValueChange={(v) => draft.set("role", v)}
          options={ROLE_OPTIONS}
          label={`${member.full_name} rolü`}
          changed={draft.changed.has("role")}
          disabled={draft.locked}
          className="w-[11rem]"
        />
      </TD>
      <TD>
        <InlineSelect
          value={draft.draft.active}
          onValueChange={(v) => draft.set("active", v)}
          options={ACTIVE_OPTIONS}
          label={`${member.full_name} durumu`}
          changed={draft.changed.has("active")}
          disabled={draft.locked}
          className="w-[7.5rem]"
        />
      </TD>
      <TD align="right" className="text-xs text-text-muted">
        {member.last_sign_in_at ? relativeTimeTR(member.last_sign_in_at) : "Hiç giriş yok"}
      </TD>
      <TD align="right" className="text-xs text-text-muted">
        {new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium" }).format(new Date(member.created_at))}
      </TD>
      <TD align="right">
        <RowSaveActions draft={draft} confirmLabel="Onayla">
          <ButtonLink href={`/admin/personel/${member.id}`} size="sm" variant="outline" icon={Eye} aria-label={`Ayrıntı: ${member.full_name}`}>
            Ayrıntı
          </ButtonLink>
        </RowSaveActions>
      </TD>
    </TR>
  );
}

/** İki tabloda (aktif/pasif) aynı başlıklar — tek yerde tutuluyor. */
function StaffTable({ rows, onDone }: { rows: StaffRow[]; onDone: () => Promise<void> | void }) {
  return (
    <DraftTable>
      <TableFrame minWidth={860} className="rounded-none border-0 shadow-none">
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
    </DraftTable>
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
      <AdminPageHeader
        eyebrow="Platform personeli"
        icon={ShieldCheck}
        title="Personel yönetimi"
        description="EmlakSoft çalışanları · departman rolü, erişim ve durum yönetimi."
        art="shield"
        actions={
          <ButtonLink href="/admin/personel/yeni" size="lg" variant="primary" icon={Plus}>
            Yeni personel
          </ButtonLink>
        }
      >
        {/* Rol dağılımı — her kart o rolü filtreler */}
        <KpiGrid>
          {roleCounts.map((r) => {
            const isActive = roleFilter === r.role;
            return (
              <button
                key={r.role}
                type="button"
                onClick={() => setRoleFilter(isActive ? "all" : r.role)}
                aria-pressed={isActive}
                title={isActive ? "Rol filtresini kaldır" : `Yalnızca ${r.label} rolünü göster`}
                className={`pm-card pm-t-${isActive ? "gold" : "brand"} focus-ring text-left ${isActive ? "pm-card-tint" : ""}`}
              >
                <span className="pm-card-head">
                  <span className="pm-ico" aria-hidden="true">
                    <Users />
                  </span>
                  <span className="pm-card-title">{r.label}</span>
                </span>
                <span className="pm-value mt-2">{loading ? "—" : r.count}</span>
              </button>
            );
          })}
        </KpiGrid>
      </AdminPageHeader>

      {/* KPI şeridi — her kart listeyi süzer */}
      <KpiGrid>
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
      </KpiGrid>

      {/* Arama + filtre çubuğu */}
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ad soyad veya e-posta ara…"
            aria-label="Personel ara"
            className="w-full pl-8"
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
