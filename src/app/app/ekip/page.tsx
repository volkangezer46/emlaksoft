import Link from "next/link";
import {
  Building2,
  Crown,
  Fingerprint,
  Layers,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { setMemberActive, setMemberRole } from "@/app/actions/team";
import { AddBranchDialog, AddMemberDialog } from "./team-dialogs";
import { BranchCard } from "./branch-card";
import { formatTurkishPhone } from "@/lib/phone";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

type Rel = { name?: string } | { name?: string }[] | null;

type Member = {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  branch_id: string | null;
  branch: Rel;
};

const roleMeta: Record<string, { label: string; cls: string }> = {
  owner: { label: "Ofis sahibi", cls: "bg-amber-400/15 text-amber-600" },
  gm: { label: "Genel müdür", cls: "bg-brand-600/10 text-brand-600" },
  branch_manager: { label: "Şube müdürü", cls: "bg-brand-600/10 text-brand-600" },
  team_lead: { label: "Takım lideri", cls: "bg-cyan-400/12 text-cyan-600" },
  advisor: { label: "Danışman", cls: "bg-mint-500/12 text-mint-600" },
  call_center: { label: "Çağrı merkezi", cls: "bg-cyan-400/12 text-cyan-600" },
  accounting: { label: "Muhasebe", cls: "bg-amber-400/15 text-amber-600" },
  readonly: { label: "Salt okunur", cls: "bg-ink-950/8 text-text-muted" },
};

const assignableRoles = ["advisor", "team_lead", "branch_manager", "gm", "call_center", "accounting", "readonly"];

function relName(value: Rel) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.name ?? null) : value.name;
}

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase();
}

export default async function TeamPage() {
  const { perms } = await requireModulePage("team");
  const canManage = (perms.team ?? []).includes("create");
  const supabase = await createClient();

  const [{ data: membersData }, { data: branchesData }, { data: provincesData }, { data: customersData }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, phone, role, is_active, created_at, branch_id, branch:branches(name)").order("created_at", { ascending: true }),
    supabase.from("branches").select("id, name, is_active, province_id, province:geo_provinces(name)").order("created_at", { ascending: true }),
    supabase.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    supabase.from("customers").select("assigned_to").is("deleted_at", null),
  ]);

  const members = (membersData ?? []) as Member[];
  const branches = (branchesData ?? []) as { id: string; name: string; is_active: boolean; province_id: string | null; province: Rel }[];
  const provinces = provincesData ?? [];

  const assignedCount = new Map<string, number>();
  (customersData ?? []).forEach((c: { assigned_to: string | null }) => {
    if (c.assigned_to) assignedCount.set(c.assigned_to, (assignedCount.get(c.assigned_to) ?? 0) + 1);
  });

  const activeCount = members.filter((m) => m.is_active).length;
  const advisorCount = members.filter((m) => ["advisor", "team_lead", "branch_manager"].includes(m.role)).length;
  const activeRate = members.length ? activeCount / members.length : 0;

  const roleOrder = ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"];
  const roleMix = roleOrder
    .map((r) => ({
      key: r,
      label: roleMeta[r]?.label ?? r,
      count: members.filter((m) => m.role === r).length,
      color:
        r === "owner" || r === "accounting"
          ? "var(--amber-400)"
          : r === "advisor" || r === "team_lead"
            ? "var(--mint-500)"
            : r === "readonly"
              ? "rgba(10,18,36,0.2)"
              : "var(--brand-500)",
    }))
    .filter((r) => r.count > 0);
  const maxRole = Math.max(1, ...roleMix.map((r) => r.count));

  const loadRows = members
    .filter((m) => m.is_active)
    .map((m) => ({ id: m.id, name: m.full_name, count: assignedCount.get(m.id) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const maxLoad = Math.max(1, ...loadRows.map((r) => r.count));

  const kpis = [
    { label: "Ekip üyesi", value: members.length, icon: Users },
    { label: "Aktif", value: activeCount, icon: ShieldCheck },
    { label: "Saha danışmanı", value: advisorCount, icon: UserRound },
    { label: "Şube", value: branches.length, icon: Building2 },
  ];

  return (
    <div className="space-y-6">
      {/* premium header */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-600/30 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.25fr_1fr] lg:items-center">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Layers className="h-4 w-4" /> Ekip & yetkiler</span>
                <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Çalışan yönetimi</h1>
                <p className="mt-1 max-w-lg text-sm text-white/60">Danışmanları davet edin, rol ve şube atayın; herkes yalnızca yetkili olduğu müşteri ve portföyleri görür.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/app/ayarlar/roller" className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                  <Fingerprint className="h-4 w-4" /> İzin matrisi
                </Link>
                {canManage ? <AddMemberDialog branches={branches.map((b) => ({ id: b.id, name: b.name }))} /> : null}
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {kpis.map((k) => (
                <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
                  <k.icon className="h-4 w-4 text-mint-400" />
                  <p className="mt-2 font-display text-xl font-extrabold text-white">{k.value}</p>
                  <p className="text-[10px] text-white/45 sm:text-xs">{k.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--mint-400), var(--brand-500), var(--mint-400))" }}
              />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--mint-400)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  className="ring-sweep"
                  style={{ "--circ": RING_C, "--dash": RING_C * (1 - activeRate) } as CSSProperties}
                />
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-xl font-extrabold text-white">%{Math.round(activeRate * 100)}</p>
                <p className="text-[9px] text-white/45">aktif</p>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Rol karışımı</p>
              {roleMix.slice(0, 4).map((r, i) => (
                <div key={r.key}>
                  <div className="mb-0.5 flex justify-between text-[10px] text-white/60">
                    <span>{r.label}</span>
                    <span className="font-bold text-white">{r.count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="bar-live h-full rounded-full"
                      style={{
                        width: `${(r.count / maxRole) * 100}%`,
                        background: r.color,
                        animationDelay: `${i * 0.08}s`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {!canManage ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-sm text-ink-950">
          <ShieldCheck className="h-5 w-5 text-amber-500" /> Ekibi yalnızca ofis sahibi ve yöneticiler düzenleyebilir. Görüntüleme modundasınız.
        </div>
      ) : null}

      {loadRows.length > 0 ? (
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><UserRound className="h-4 w-4" /> İş yükü</p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Müşteri dağılımı</h2>
          <div className="mt-4 space-y-3">
            {loadRows.map((r, i) => (
              <div key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-semibold text-ink-950">{r.name}</span>
                    <span className="tabular-nums text-text-muted">{r.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-canvas">
                    <div
                      className="bar-live h-full rounded-full bg-[image:var(--grad-brand)]"
                      style={{ width: `${Math.max((r.count / maxLoad) * 100, 4)}%`, animationDelay: `${i * 0.07}s` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* team list */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950"><Users className="h-4 w-4 text-brand-600" /> Ekip üyeleri</h2>
            <p className="text-xs text-text-muted">{members.length} kişi · {activeCount} aktif</p>
          </div>
        </div>

        <div className="divide-y divide-line">
          {members.map((m) => {
            const meta = roleMeta[m.role] ?? { label: m.role, cls: "bg-ink-950/8 text-text-muted" };
            const isOwner = m.role === "owner";
            const custCount = assignedCount.get(m.id) ?? 0;
            return (
              <article key={m.id} className={`grid gap-4 px-5 py-4 transition hover:bg-brand-600/[0.02] lg:grid-cols-[1.4fr_1fr_0.8fr_auto] lg:items-center ${!m.is_active ? "opacity-60" : ""}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-[image:var(--grad-brand)] text-xs font-bold text-white">
                    {initials(m.full_name)}
                    {isOwner ? <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-amber-400 text-ink-950"><Crown className="h-2.5 w-2.5" /></span> : null}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-950">{m.full_name}</p>
                    <p className="mt-0.5 truncate text-xs text-text-muted">{m.phone ? formatTurkishPhone(m.phone) : "Telefon yok"}{relName(m.branch) ? ` · ${relName(m.branch)}` : ""}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>
                  {!m.is_active ? <span className="rounded-full bg-ink-950/8 px-2 py-0.5 text-[10px] font-semibold text-text-muted">Pasif</span> : null}
                </div>

                <div className="text-xs text-text-muted">
                  <span className="font-display text-base font-extrabold text-ink-950">{custCount}</span> müşteri
                </div>

                <div className="flex items-center justify-end gap-2">
                  {canManage && !isOwner ? (
                    <>
                      <form action={setMemberRole} className="flex flex-wrap items-center gap-1.5">
                        <input type="hidden" name="id" value={m.id} />
                        <select name="role" defaultValue={m.role} className="rounded-[9px] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold text-ink-950 outline-none focus:border-brand-400">
                          {assignableRoles.map((r) => <option key={r} value={r}>{roleMeta[r].label}</option>)}
                        </select>
                        {branches.length > 0 ? (
                          <select name="branch_id" defaultValue={m.branch_id ?? ""} className="rounded-[9px] border border-line bg-canvas px-2 py-1.5 text-xs font-semibold text-ink-950 outline-none focus:border-brand-400">
                            <option value="">Şubesiz</option>
                            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        ) : null}
                        <button type="submit" className="rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300">Uygula</button>
                      </form>
                      <form action={setMemberActive}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="is_active" value={(!m.is_active).toString()} />
                        <button type="submit" className={`rounded-[9px] border px-2.5 py-1.5 text-xs font-semibold transition ${m.is_active ? "border-line text-text-muted hover:border-danger-500/40 hover:text-danger-500" : "border-mint-500/30 text-mint-600 hover:bg-mint-500/8"}`}>
                          {m.is_active ? "Pasifleştir" : "Aktifleştir"}
                        </button>
                      </form>
                    </>
                  ) : (
                    <span className="text-[11px] text-text-faint">{isOwner ? "Ofis sahibi" : "—"}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* branches */}
      <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950"><Building2 className="h-4 w-4 text-brand-600" /> Şubeler</h2>
          {canManage ? <AddBranchDialog provinces={provinces} /> : null}
        </div>
        {branches.length === 0 ? (
          <p className="mt-4 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">Henüz şube tanımlanmadı. Tek ofis olarak da çalışabilirsiniz.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {branches.map((b) => (
              <BranchCard
                key={b.id}
                branch={{ id: b.id, name: b.name, province_id: b.province_id }}
                memberCount={members.filter((m) => m.branch_id === b.id).length}
                provinceName={relName(b.province) ?? null}
                provinces={provinces}
                canManage={canManage}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
