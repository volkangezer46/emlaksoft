"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Power, Trash2, UserRound, Users } from "lucide-react";
import { createTeam, deleteTeam, setMemberTeam, updateTeam } from "@/app/actions/teams";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";

export type TeamRow = { id: string; name: string; branchId: string | null; leadUserId: string | null; isActive: boolean; memberCount: number };
export type MemberRow = { id: string; name: string; roleLabel: string; branchId: string | null; teamId: string | null };
type Branch = { id: string; name: string };

function Fields({ idPrefix, team, members, branches }: { idPrefix: string; team?: TeamRow; members: MemberRow[]; branches: Branch[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <FormField label="Takım adı" htmlFor={`${idPrefix}-name`} required>
        <FormInput id={`${idPrefix}-name`} name="name" required maxLength={80} defaultValue={team?.name ?? ""} placeholder="Örn. Kuzey Ekibi" />
      </FormField>
      <FormField label="Takım lideri" htmlFor={`${idPrefix}-lead`} hint="Portal uyarıları 4 saat sonra bu kişiye yükselir.">
        <FormSelect id={`${idPrefix}-lead`} name="lead_user_id" defaultValue={team?.leadUserId ?? ""}>
          <option value="">Atanmadı</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name} · {m.roleLabel}</option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Şube" htmlFor={`${idPrefix}-branch`}>
        <FormSelect id={`${idPrefix}-branch`} name="branch_id" defaultValue={team?.branchId ?? ""}>
          <option value="">Şubesiz</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </FormSelect>
      </FormField>
    </div>
  );
}

/** Takımlar: ekle, düzenle, aktif/pasif, sil ve üye-takım eşleşmesi (sayfa içi, popup yok). */
export function TeamManager({ teams, members, branches, canManage }: { teams: TeamRow[]; members: MemberRow[]; branches: Branch[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  function run(action: () => Promise<{ error?: string }>, okText: string, after?: () => void) {
    startTransition(async () => {
      const res = await action();
      if (res.error) setMessage({ tone: "danger", text: res.error });
      else {
        setMessage({ tone: "success", text: okText });
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      {canManage ? (
        adding ? (
          <form
            action={(fd) => run(() => createTeam({}, fd), "Takım eklendi.", () => setAdding(false))}
            className="space-y-3 rounded-[var(--radius-card)] border border-brand-300 bg-canvas/60 p-4"
          >
            <p className="flex items-center gap-2 text-sm font-bold text-ink-950"><Users className="h-4 w-4 text-brand-600" /> Yeni takım</p>
            <Fields idPrefix="new" members={members} branches={branches} />
            <div className="flex gap-2">
              <Button type="submit" icon={Check} loading={pending}>Takımı ekle</Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Vazgeç</Button>
            </div>
          </form>
        ) : (
          <Button type="button" icon={Plus} onClick={() => setAdding(true)}>Takım ekle</Button>
        )
      ) : null}

      {teams.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
          Henüz takım tanımlanmadı. Takım tanımlamazsanız uyarılar doğrudan şube müdürüne ve ofis sahibine yükselir.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) =>
            editingId === t.id ? (
              <form
                key={t.id}
                action={(fd) => {
                  fd.set("id", t.id);
                  fd.set("is_active", String(t.isActive));
                  run(() => updateTeam(fd), "Takım güncellendi.", () => setEditingId(null));
                }}
                className="space-y-3 rounded-[var(--radius-card)] border border-brand-300 bg-canvas/60 p-4 md:col-span-2 xl:col-span-3"
              >
                <Fields idPrefix={`e-${t.id}`} team={t} members={members} branches={branches} />
                <div className="flex gap-2">
                  <Button type="submit" icon={Check} loading={pending}>Kaydet</Button>
                  <Button type="button" variant="secondary" onClick={() => setEditingId(null)}>Vazgeç</Button>
                </div>
              </form>
            ) : (
              <article key={t.id} className={`rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4 ${t.isActive ? "" : "opacity-70"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600"><Users className="h-4 w-4" /></span>
                  <span className="flex items-center gap-1.5">
                    {!t.isActive ? <span className="rounded-full bg-ink-950/8 px-2 py-0.5 text-xs font-semibold text-text-muted">Pasif</span> : null}
                    <a href="#uyeler" className="rounded-full bg-mint-500/10 px-2 py-0.5 text-xs font-bold text-mint-700 hover:bg-mint-500/20">{t.memberCount} üye</a>
                  </span>
                </div>
                <p className="mt-3 font-display font-bold text-ink-950">{t.name}</p>
                <p className="text-xs text-text-muted">{t.branchId ? (branchName.get(t.branchId) ?? "Şube") : "Şubesiz"}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
                  <UserRound className="h-3.5 w-3.5" />
                  {t.leadUserId ? (memberName.get(t.leadUserId) ?? "Lider (pasif veya silinmiş)") : "Lider atanmadı"}
                </p>
                {canManage ? (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Button type="button" size="sm" variant="secondary" icon={Pencil} onClick={() => { setEditingId(t.id); setMessage(null); }}>Düzenle</Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={Power}
                      loading={pending}
                      onClick={() => {
                        const fd = new FormData();
                        fd.set("id", t.id);
                        fd.set("name", t.name);
                        fd.set("branch_id", t.branchId ?? "");
                        fd.set("lead_user_id", t.leadUserId ?? "");
                        fd.set("is_active", String(!t.isActive));
                        run(() => updateTeam(fd), t.isActive ? "Takım pasife alındı." : "Takım aktifleştirildi.");
                      }}
                    >
                      {t.isActive ? "Pasife al" : "Aktifleştir"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      loading={pending}
                      onClick={() => {
                        if (!window.confirm(`"${t.name}" takımı silinsin mi? Üyesi olan takım silinemez.`)) return;
                        const fd = new FormData();
                        fd.set("id", t.id);
                        run(() => deleteTeam(fd), "Takım silindi.");
                      }}
                    >
                      Sil
                    </Button>
                  </div>
                ) : null}
              </article>
            ),
          )}
        </div>
      )}

      <section id="uyeler" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950"><UserRound className="h-4 w-4 text-brand-600" /> Üye takım eşleşmesi</h2>
        <ul className="mt-3 divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-ink-950">{m.name} <span className="text-xs text-text-muted">· {m.roleLabel}</span></span>
              <FormSelect
                aria-label={`${m.name} takımı`}
                className="max-w-56"
                value={m.teamId ?? ""}
                disabled={!canManage || pending}
                onChange={(e) => {
                  const fd = new FormData();
                  fd.set("member_id", m.id);
                  fd.set("team_id", e.target.value);
                  run(() => setMemberTeam(fd), "Üyenin takımı güncellendi.");
                }}
              >
                <option value="">Takımsız</option>
                {teams.filter((t) => t.isActive || t.id === m.teamId).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </FormSelect>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
