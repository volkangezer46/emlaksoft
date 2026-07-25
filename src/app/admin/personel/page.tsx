"use client";

import { useTransition, useState, useRef, useEffect, useCallback } from "react";
import {
  ChevronDown,
  Loader2,
  Plus,
  ShieldCheck,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import {
  addPlatformStaff,
  updateStaffRole,
  deactivateStaff,
  reactivateStaff,
  PLATFORM_ROLE_LABELS,
} from "@/app/actions/platform-staff";
import type { PlatformRole } from "@/lib/platform-access";

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
};

// ---------------------------------------------------------------------------
// Role badge colours
// ---------------------------------------------------------------------------
const roleCls: Record<PlatformRole, string> = {
  super_admin: "bg-amber-400/15 text-amber-600",
  ops: "bg-brand-600/12 text-brand-600",
  support: "bg-cyan-400/12 text-cyan-600",
  billing: "bg-mint-500/12 text-mint-600",
};

const field =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400";

// ---------------------------------------------------------------------------
// Add staff dialog
// ---------------------------------------------------------------------------
function AddStaffDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await addPlatformStaff(fd);
      if (res.error) { setError(res.error); return; }
      setSuccess(true);
      formRef.current?.reset();
      setTimeout(() => { setOpen(false); setSuccess(false); onDone(); }, 1200);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-shine inline-flex items-center gap-2 rounded-[11px] bg-amber-400 px-4 py-2.5 text-sm font-bold text-ink-950"
      >
        <Plus className="h-4 w-4" /> Personel ekle
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[20px] border border-line bg-surface p-6 shadow-[var(--shadow-modal)]">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-ink-950">Yeni personel ekle</h2>
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-full text-text-muted hover:text-ink-950">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Auth’da kayıtlı e-posta varsa doğrudan eklenir; yoksa davet e-postası gönderilir.
            </p>
            <form ref={formRef} onSubmit={submit} className="mt-5 grid gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="ps-email">
                  E-posta <span className="text-danger-500">*</span>
                </label>
                <input id="ps-email" name="email" type="email" required className={field} placeholder="ornek@emlaksoft.com" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="ps-name">
                  Ad Soyad <span className="text-danger-500">*</span>
                </label>
                <input id="ps-name" name="full_name" required className={field} placeholder="Ahmet Yılmaz" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="ps-role">Rol</label>
                <div className="relative">
                  <select id="ps-role" name="role" defaultValue="support" className={`${field} appearance-none pr-9`}>
                    {(Object.entries(PLATFORM_ROLE_LABELS) as [PlatformRole, string][]).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>

              {error ? <p className="rounded-[10px] bg-danger-500/8 px-3 py-2 text-sm text-danger-500" role="alert">{error}</p> : null}
              {success ? <p className="rounded-[10px] bg-mint-500/10 px-3 py-2 text-sm font-semibold text-mint-600">Personel eklendi ✓</p> : null}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted">İptal</button>
                <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  {pending ? "Ekleniyor…" : "Ekle"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

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

  function toggle() {
    const fd = new FormData();
    fd.set("id", member.id);
    setErr(null);
    startTransition(async () => {
      const res = member.is_active ? await deactivateStaff(fd) : await reactivateStaff(fd);
      if (res.error) setErr(res.error);
      else onDone();
    });
  }

  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-5 py-3.5">
        <p className="font-semibold text-ink-950">{member.full_name}</p>
        <p className="text-xs text-text-faint">{member.email}</p>
        {err ? <p className="mt-0.5 text-xs text-danger-500">{err}</p> : null}
      </td>
      <td className="px-4 py-3.5">
        <div className="relative">
          <select
            defaultValue={member.role}
            onChange={changeRole}
            disabled={pending || !member.is_active}
            className={`appearance-none rounded-[9px] border border-line bg-canvas py-1.5 pl-2.5 pr-8 text-xs font-semibold outline-none focus:border-brand-400 disabled:opacity-50 ${roleCls[member.role]}`}
          >
            {(Object.entries(PLATFORM_ROLE_LABELS) as [PlatformRole, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-current opacity-60" />
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className={`text-xs font-semibold ${member.is_active ? "text-mint-600" : "text-text-faint"}`}>
          {member.is_active ? "Aktif" : "Pasif"}
        </span>
      </td>
      <td className="px-4 py-3.5 text-xs text-text-muted">
        {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(member.created_at))}
      </td>
      <td className="px-4 py-3.5">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={`inline-flex items-center gap-1 rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
            member.is_active
              ? "border-danger-500/30 text-danger-500 hover:bg-danger-500/8"
              : "border-mint-500/30 text-mint-600 hover:bg-mint-500/8"
          }`}
        >
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : member.is_active ? (
            <><UserMinus className="h-3 w-3" /> Pasif yap</>
          ) : (
            <><UserPlus className="h-3 w-3" /> Aktif yap</>
          )}
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page — client component, veriyi /api/admin/personel üzerinden çeker
// ---------------------------------------------------------------------------
export default function PersonelPage() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  const active = staff.filter((s) => s.is_active);
  const passive = staff.filter((s) => !s.is_active);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-amber-400/20 blur-[90px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-300">
              <ShieldCheck className="h-3.5 w-3.5" /> Platform personeli
            </p>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Personel yönetimi</h1>
            <p className="mt-1.5 text-sm text-white/60">EmlakSoft çalışanları · rol ve erişim yönetimi</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-center">
              <p className="font-display text-2xl font-extrabold">{active.length}</p>
              <p className="text-[10px] text-white/50">Aktif</p>
            </div>
            <AddStaffDialog onDone={load} />
          </div>
        </div>
      </section>

      {/* Aktif personel */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <ShieldCheck className="h-4 w-4 text-amber-500" />
          <h2 className="font-display font-bold text-ink-950">Aktif personel</h2>
          <span className="ml-auto rounded-full bg-brand-600/10 px-2.5 py-0.5 text-[10px] font-bold text-brand-600">{active.length}</span>
        </div>
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-text-muted">Yükleniyor…</div>
        ) : active.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-text-muted">Aktif personel yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-line bg-canvas/80 text-text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Personel</th>
                  <th className="px-4 py-3 font-medium">Rol</th>
                  <th className="px-4 py-3 font-medium">Durum</th>
                  <th className="px-4 py-3 font-medium">Katılım</th>
                  <th className="px-4 py-3 font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {active.map((m) => <StaffRow key={m.id} member={m} onDone={load} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pasif personel */}
      {passive.length > 0 ? (
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface opacity-70">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <UserMinus className="h-4 w-4 text-text-faint" />
            <h2 className="font-display font-bold text-ink-950">Pasif personel</h2>
            <span className="ml-auto rounded-full bg-canvas px-2.5 py-0.5 text-[10px] font-bold text-text-faint">{passive.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-line bg-canvas/80 text-text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Personel</th>
                  <th className="px-4 py-3 font-medium">Rol</th>
                  <th className="px-4 py-3 font-medium">Durum</th>
                  <th className="px-4 py-3 font-medium">Katılım</th>
                  <th className="px-4 py-3 font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {passive.map((m) => <StaffRow key={m.id} member={m} onDone={load} />)}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
