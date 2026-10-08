"use client";

import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useParams } from "next/navigation";
import { ArrowLeft, Clock, Loader2, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { auditActionLabel, relativeTimeTR } from "@/lib/admin-format";
import { deactivateStaff, reactivateStaff, updateStaffRole } from "@/app/actions/platform-staff";
import { PLATFORM_ROLE_LABELS, type PlatformRole } from "@/lib/platform-access";
import { PLATFORM_ROLES, roleSummary } from "../staff-model";
import { StaffAccountPanel } from "./staff-account-panel";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

type Member = {
  id: string;
  email: string;
  full_name: string;
  role: PlatformRole;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  must_change_password?: boolean;
};
type Activity = {
  id: string;
  action: string;
  entity_type: string | null;
  actor_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  direction: "by" | "about";
};

const dateFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });

/** Denetim kaydının meta alanından okunur özet (parola/kişisel veri taşımaz). */
function metaText(m: Activity["meta"]): string | null {
  if (!m) return null;
  const parts: string[] = [];
  const role = (v: unknown) => (typeof v === "string" ? (PLATFORM_ROLE_LABELS[v as PlatformRole] ?? v) : null);
  if (m.old_role || m.new_role) parts.push(`${role(m.old_role) ?? "—"} → ${role(m.new_role) ?? "—"}`);
  else if (m.role) parts.push(`Rol: ${role(m.role)}`);
  if (m.temp_password) parts.push("Geçici parola ile açıldı");
  if (m.must_change_password) parts.push("İlk girişte parola değişimi zorunlu");
  return parts.length ? parts.join(" · ") : null;
}

export default function PersonelDetayPage() {
  const { id } = useParams<{ id: string }>();
  const [member, setMember] = useState<Member | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/admin/personel?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { member: Member; activity: Activity[] } | null) => {
        if (!d) {
          setState("missing");
          return;
        }
        setMember(d.member);
        setActivity(d.activity);
        setState("ready");
      });
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function run(action: (fd: FormData) => Promise<{ error?: string }>, extra?: Record<string, string>) {
    const fd = new FormData();
    fd.set("id", id);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    setErr(null);
    startTransition(async () => {
      const res = await action(fd);
      if (res.error) setErr(res.error);
      else await load();
    });
  }

  if (state === "loading") {
    return <div className="animate-pulse space-y-4" aria-busy><div className="h-32 rounded-[var(--radius-panel)] bg-ink-950/8" /><div className="h-64 rounded-[var(--radius-panel)] bg-ink-950/8" /></div>;
  }
  if (state === "missing" || !member) {
    return (
      <div className="rounded-[var(--radius-panel)] border border-line bg-surface px-5 py-12 text-center">
        <p className="text-sm font-semibold text-ink-950">Personel bulunamadı</p>
        <Link href="/admin/personel" className="mt-2 inline-block text-xs font-semibold text-brand-600 hover:underline">Personel listesine dön</Link>
      </div>
    );
  }

  const rs = roleSummary(member.role);

  return (
    <div className="space-y-6">
      <Link href="/admin/personel" className="focus-ring inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted transition hover:text-ink-950">
        <ArrowLeft className="h-3.5 w-3.5" /> Personel
      </Link>

      <AdminPageHeader
        eyebrow={rs.label}
        icon={ShieldCheck}
        title={member.full_name}
        description={member.email}
        actions={
          <>
            <Badge variant={member.is_active ? "success" : "outline"} size="sm">{member.is_active ? "Aktif" : "Pasif"}</Badge>
            {member.is_active ? (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm" type="button" disabled={pending} className="text-danger-600">
                    <UserMinus className="h-3.5 w-3.5" aria-hidden /> Pasif yap
                  </Button>
                }
                title={`${member.full_name} pasif yapılsın mı?`}
                description="Pasif personel admin paneline giriş yapamaz. Kayıt silinmez; daha sonra tekrar aktif edilebilir."
                confirmLabel="Pasif yap"
                onConfirm={async () => {
                  const fd = new FormData();
                  fd.set("id", id);
                  const res = await deactivateStaff(fd);
                  if (res.error) setErr(res.error);
                  else await load();
                }}
              />
            ) : (
              <button type="button" onClick={() => run(reactivateStaff)} disabled={pending} className="focus-ring press inline-flex min-h-10 items-center gap-1 rounded-[var(--radius-control)] bg-accent px-3 text-xs font-semibold text-accent-fg disabled:opacity-50">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UserPlus className="h-3.5 w-3.5" aria-hidden />} Aktif yap
              </button>
            )}
          </>
        }
      />

      {err ? <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">{err}</p> : null}

      <StaffAccountPanel
        id={id}
        fullName={member.full_name}
        email={member.email}
        mustChangePassword={member.must_change_password === true}
        onChanged={load}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 className="font-display font-bold text-ink-950">Rol ve erişim</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {PLATFORM_ROLES.map((r) => {
              const on = member.role === r;
              return (
                <button
                  key={r}
                  type="button"
                  disabled={pending || !member.is_active || on}
                  onClick={() => run(updateStaffRole, { role: r })}
                  aria-pressed={on}
                  className={`focus-ring press rounded-[var(--radius-card)] border p-3 text-left transition disabled:cursor-default ${
                    on ? "border-brand-500 bg-brand-600/[0.06] ring-2 ring-brand-500/25" : "border-line bg-canvas hover:border-brand-300 disabled:opacity-60"
                  }`}
                >
                  <span className="block text-sm font-bold text-ink-950">{PLATFORM_ROLE_LABELS[r]}</span>
                  <span className="block text-xs text-text-muted">{roleSummary(r).tagline}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-xs font-semibold text-ink-950">Açık ekranlar ({rs.allowed.length})</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {rs.allowed.map((m) => <span key={m} className="rounded-full bg-mint-500/10 px-2 py-0.5 text-xs font-medium text-mint-700">{m}</span>)}
          </div>
          {rs.denied.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {rs.denied.map((m) => <span key={m} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-text-faint line-through ring-1 ring-line">{m}</span>)}
            </div>
          ) : null}
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-xs">
            <div>
              <dt className="text-text-faint">Son giriş</dt>
              <dd className="mt-0.5 flex items-center gap-1 font-semibold text-ink-950"><Clock className="h-3 w-3" />{member.last_sign_in_at ? relativeTimeTR(member.last_sign_in_at) : "Hiç giriş yapmadı"}</dd>
            </div>
            <div>
              <dt className="text-text-faint">Katılım</dt>
              <dd className="mt-0.5 font-semibold text-ink-950">{dateFmt.format(new Date(member.created_at))}</dd>
            </div>
          </dl>
        </section>

        <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-display font-bold text-ink-950">Aktivite</h2>
            <Link href="/admin/aktivite?kaynak=platform" className="text-xs font-semibold text-brand-600 hover:underline">Tüm platform kaydı</Link>
          </div>
          {activity.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-text-muted">Bu personelle ilgili denetim kaydı yok.</p>
          ) : (
            <ol className="divide-y divide-line">
              {activity.map((a) => {
                const detail = metaText(a.meta);
                return (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${a.direction === "by" ? "bg-brand-500" : "bg-amber-400"}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink-950">{auditActionLabel(a.action)}</p>
                      <p className="text-xs text-text-muted">
                        {a.direction === "by" ? "Personelin yaptığı işlem" : "Personel üzerinde yapılan işlem"}
                        {detail ? ` · ${detail}` : ""}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-text-faint" dateTime={a.created_at} title={dateFmt.format(new Date(a.created_at))}>
                      {relativeTimeTR(a.created_at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
