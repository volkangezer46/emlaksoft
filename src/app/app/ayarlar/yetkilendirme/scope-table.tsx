"use client";

import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { Check, Pencil, RotateCcw, X } from "lucide-react";
import { resetUserScope, upsertUserScope } from "@/app/actions/access-control";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormInput, FormSelect } from "@/components/ui/form-controls";
import { ASSIGNABLE_SCOPES, SCOPE_LABELS, getDefaultScopeForRole, scopeLabel } from "@/lib/access-control/scope-rules";
import { canChangeScope, isCustomScope, minimumScopeForRole, type AssignableScope, type ScopeInput } from "@/lib/access-control/admin-rules";
import type { AccessScope } from "@/lib/access-control/types";
import type { AppRole } from "@/lib/permissions";

export type ScopeMember = {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  branchId: string | null;
  teamId: string | null;
  /** DB satırı (yoksa rol varsayılanı gösterilir). */
  scope: ScopeInput | null;
  /** Aktif kapsam istisnası sayısı (sekmeye bağlantı). */
  overrideCount: number;
};
export type NamedRef = { id: string; name: string };

const FLAGS: { key: keyof Pick<ScopeInput, "can_view_all_data" | "can_edit_team_members" | "can_override_permissions" | "can_see_earnings">; label: string; hint: string }[] = [
  { key: "can_view_all_data", label: "Tüm ofis verisi", hint: "Yalnız ofis geneli kapsamla" },
  { key: "can_edit_team_members", label: "Ekip üyesi düzenler", hint: "Takım/şube üyelerinin kaydını düzenleyebilir" },
  { key: "can_override_permissions", label: "İstisna tanımlar", hint: "Yalnız ofis sahibi / genel müdür rolünde" },
  { key: "can_see_earnings", label: "Kazanç görür", hint: "Başkasının kazancını görebilir" },
];

function defaultInput(m: ScopeMember): ScopeInput {
  const role = m.role as AppRole;
  const scope = getDefaultScopeForRole(role);
  return {
    scope_type: scope,
    team_id: scope === "team" ? m.teamId : null,
    branch_id: scope === "branch" ? m.branchId : null,
    can_view_all_data: ["owner", "gm", "accounting"].includes(m.role),
    can_edit_team_members: ["owner", "gm", "branch_manager", "team_lead"].includes(m.role),
    can_override_permissions: ["owner", "gm"].includes(m.role),
    can_see_earnings: ["owner", "gm", "accounting"].includes(m.role),
  };
}

function Row({
  m,
  teams,
  branches,
  self,
  canEdit,
  onMessage,
}: {
  m: ScopeMember;
  teams: NamedRef[];
  branches: NamedRef[];
  self: { userId: string; role: string };
  canEdit: boolean;
  onMessage: (msg: { tone: "success" | "danger"; text: string }) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const current = m.scope ?? defaultInput(m);
  const [draft, setDraft] = useState<ScopeInput>(current);
  const [reason, setReason] = useState("");
  const teamName = teams.find((t) => t.id === current.team_id)?.name ?? null;
  const branchName = branches.find((b) => b.id === current.branch_id)?.name ?? null;
  const custom = m.scope ? isCustomScope(m.role, m.scope) : false;
  const isSelf = m.id === self.userId;
  const floor = minimumScopeForRole(m.role);
  const selectable = ASSIGNABLE_SCOPES.filter((s) => (floor === "office" ? s === "office" : true));
  // Düzenlenebilir mi? Saf kural istemcide de koşar (sunucu yine doğrular).
  const editable = canEdit && !isSelf && canChangeScope(self, { userId: m.id, role: m.role }, current).ok;
  const lockedReason = isSelf ? "Kendi kapsamınızı başka bir yönetici değiştirir" : m.role === "owner" && self.role !== "owner" ? "Yalnız ofis sahibi değiştirir" : null;

  function save() {
    const rule = canChangeScope(self, { userId: m.id, role: m.role }, draft);
    if (!rule.ok) {
      onMessage({ tone: "danger", text: rule.reason });
      return;
    }
    startTransition(async () => {
      // canChangeScope "platform"ı zaten reddetti; action şeması yalnız atanabilir türleri alır.
      const res = await upsertUserScope({ userId: m.id, ...draft, scope_type: draft.scope_type as AssignableScope, reason: reason.trim() || undefined });
      if (res.error) onMessage({ tone: "danger", text: res.error });
      else {
        onMessage({ tone: "success", text: `${m.name}: kapsam güncellendi (${scopeLabel(draft.scope_type)}).` });
        setEditing(false);
        setReason("");
        router.refresh();
      }
    });
  }

  function reset() {
    startTransition(async () => {
      const res = await resetUserScope(m.id);
      if (res.error) onMessage({ tone: "danger", text: res.error });
      else {
        onMessage({ tone: "success", text: `${m.name}: rol varsayılanına dönüldü.` });
        setEditing(false);
        router.refresh();
      }
    });
  }

  const scopeCell = (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={current.scope_type === "office" ? "info" : current.scope_type === "user" ? "neutral" : "warning"} size="sm">
        {scopeLabel(current.scope_type, { teamName, branchName })}
      </Badge>
      {custom ? <Badge variant="warning" size="sm">özel</Badge> : <span className="text-xs text-text-faint">rol varsayılanı</span>}
    </span>
  );

  if (!editing) {
    return (
      <TR className={`border-b border-line/60 last:border-0 ${custom ? "bg-amber-400/[0.04]" : ""}`}>
        <TH scope="row" className="py-2.5 pr-3 text-left">
          <Link href={`/app/ekip/${m.id}`} className="text-sm font-semibold text-ink-950 hover:text-brand-600 hover:underline">{m.name}</Link>
          <p className="text-xs text-text-muted">{m.roleLabel}</p>
        </TH>
        <TD className="px-2 py-2.5">{scopeCell}</TD>
        <TD className="px-2 py-2.5 text-xs text-text-muted">
          {FLAGS.filter((f) => current[f.key]).map((f) => f.label).join(" · ") || "—"}
        </TD>
        <TD className="px-2 py-2.5 text-xs">
          <Link href={`/app/ayarlar/yetkilendirme?sekme=istisnalar&user=${m.id}`} className="font-semibold text-brand-600 hover:underline">
            {m.overrideCount > 0 ? `${m.overrideCount} istisna` : "İstisna ekle"}
          </Link>
        </TD>
        <TD className="px-2 py-2.5 text-right">
          {editable ? (
            <Button size="sm" variant="secondary" icon={Pencil} onClick={() => { setDraft(current); setEditing(true); }}>Düzenle</Button>
          ) : (
            <span className="text-xs text-text-faint">{lockedReason ?? (canEdit ? "Kilitli" : "")}</span>
          )}
        </TD>
      </TR>
    );
  }

  return (
    <TR className="border-b border-line/60 bg-canvas/60 last:border-0">
      <TH scope="row" className="py-3 pr-3 text-left align-top">
        <p className="text-sm font-semibold text-ink-950">{m.name}</p>
        <p className="text-xs text-text-muted">{m.roleLabel} · varsayılan: {SCOPE_LABELS[getDefaultScopeForRole(m.role as AppRole)]}</p>
      </TH>
      <TD className="px-2 py-3 align-top" colSpan={3}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-xs font-semibold text-text-muted">
            Kapsam
            <FormSelect
              value={draft.scope_type}
              onChange={(e) => {
                const scope_type = e.target.value as AccessScope;
                setDraft((d) => ({
                  ...d,
                  scope_type,
                  team_id: scope_type === "team" ? (d.team_id ?? m.teamId) : null,
                  branch_id: scope_type === "branch" ? (d.branch_id ?? m.branchId) : null,
                  can_view_all_data: scope_type === "office" ? d.can_view_all_data : false,
                }));
              }}
            >
              {selectable.map((s) => (
                <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
              ))}
            </FormSelect>
          </label>
          {draft.scope_type === "team" ? (
            <label className="grid gap-1 text-xs font-semibold text-text-muted">
              Takım
              <FormSelect value={draft.team_id ?? ""} onChange={(e) => setDraft((d) => ({ ...d, team_id: e.target.value || null }))}>
                <option value="">Seçin…</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </FormSelect>
            </label>
          ) : null}
          {draft.scope_type === "branch" ? (
            <label className="grid gap-1 text-xs font-semibold text-text-muted">
              Şube
              <FormSelect value={draft.branch_id ?? ""} onChange={(e) => setDraft((d) => ({ ...d, branch_id: e.target.value || null }))}>
                <option value="">Seçin…</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </FormSelect>
            </label>
          ) : null}
          <label className="grid gap-1 text-xs font-semibold text-text-muted sm:col-span-1">
            Gerekçe (isteğe bağlı)
            <FormInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Denetim günlüğünde görünür" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {FLAGS.map((f) => {
            const disabled = (f.key === "can_view_all_data" && draft.scope_type !== "office") || (f.key === "can_override_permissions" && !["owner", "gm"].includes(m.role));
            return (
              <label key={f.key} className={`inline-flex items-center gap-2 text-xs ${disabled ? "opacity-50" : ""}`} title={f.hint}>
                <Checkbox checked={draft[f.key]} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.checked }))} />
                {f.label}
              </label>
            );
          })}
        </div>
      </TD>
      <TD className="px-2 py-3 text-right align-top">
        <div className="flex flex-col items-end gap-1.5">
          <Button size="sm" icon={Check} onClick={save} loading={pending}>Kaydet</Button>
          {m.scope ? (
            <Button size="sm" variant="secondary" icon={RotateCcw} onClick={reset} disabled={pending}>Varsayılana dön</Button>
          ) : null}
          <Button size="sm" variant="ghost" icon={X} onClick={() => setEditing(false)} disabled={pending}>Vazgeç</Button>
        </div>
      </TD>
    </TR>
  );
}

/** Kullanıcı kapsamları tablosu: satır içi düzenleme; sunucu kuralları istemcide de koşar (çift kapı). */
export function ScopeTable({
  members,
  teams,
  branches,
  self,
  canEdit,
}: {
  members: ScopeMember[];
  teams: NamedRef[];
  branches: NamedRef[];
  self: { userId: string; role: string };
  canEdit: boolean;
}) {
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink-950">Kullanıcı kapsamları</h2>
          <p className="mt-1 text-xs text-text-muted">
            Her üyenin hangi kayıtları göreceği: kendi kayıtları, takımı, şubesi ya da ofis geneli. Rol varsayılanı önerilir; ofis sahibi ve genel müdür kapsamı düşürülemez.
            {!canEdit ? " Salt görüntüleme — düzenlemek için ofis sahibi veya genel müdür olmalısınız." : ""}
          </p>
        </div>
      </div>
      {message ? <Alert tone={message.tone} className="mt-3">{message.text}</Alert> : null}
      <div className="mt-4 overflow-x-auto">
        <Table className="w-full min-w-[720px] border-collapse text-sm">
          <THead>
            <TR className="border-b border-line text-left text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
              <TH scope="col" className="py-2 pr-3">Üye</TH>
              <TH scope="col" className="px-2 py-2">Kapsam</TH>
              <TH scope="col" className="px-2 py-2">Bayraklar</TH>
              <TH scope="col" className="px-2 py-2">İstisnalar</TH>
              <TH scope="col" className="px-2 py-2 text-right">İşlem</TH>
            </TR>
          </THead>
          <TBody>
            {members.map((m) => (
              <Row key={m.id} m={m} teams={teams} branches={branches} self={self} canEdit={canEdit} onMessage={setMessage} />
            ))}
          </TBody>
        </Table>
      </div>
    </section>
  );
}
