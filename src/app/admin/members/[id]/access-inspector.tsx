"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Eye, EyeOff, Loader2, Search, ShieldAlert, ShieldCheck, SlidersHorizontal, UserCog } from "lucide-react";
import { setMemberOverrideAsStaff, setMemberScopeAsStaff, setTenantRolePermissionAsStaff, type AccessActionResult } from "@/app/actions/platform-member-access";
import { MODULE_LABELS } from "@/app/app/ayarlar/roller/role-permissions-matrix";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { ACTION_LABELS, ACTION_ORDER, describeModuleAccess, type ModuleAccessRow, type ScopeRowInput } from "@/lib/admin/member-access-explain";
import { SCOPE_LABELS } from "@/lib/access-control/scope-rules";
import type { AppAction } from "@/lib/permissions";

/**
 * Etkin izin görüntüleyici (Admin > Üye > Yetki). Destek "neden göremiyor?" sorusunu tek ekranda yanıtlar:
 * her modülün sonucu ve KAYNAĞI (rol varsayılanı → ofis rol ayarı → kişi istisnası) ile kapsam. Satırlar sunucuda
 * `explainModuleAccess` ile hesaplanır (uygulama kapısıyla aynı birleşim); bu bileşen yalnız gösterir ve süper admin /
 * operasyon için düzenleme formunu açar. Her değişiklik gerekçe ister ve ofisin denetim kaydına düşer.
 */

type Notice = { tone: "ok" | "error"; text: string } | null;

const fmtDate = (iso: string) => new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const short: Record<AppAction, string> = { view: "Görüntüle", create: "Ekle", edit: "Düzenle", delete: "Sil" };

export type AccessInspectorProps = {
  memberId: string;
  tenantId: string;
  role: string;
  roleLabel: string;
  isActive: boolean;
  tenantStatus: string | null;
  rows: ModuleAccessRow[];
  scope: { text: string; custom: boolean; value: ScopeRowInput };
  branches: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  canEdit: boolean;
};

export function AccessInspector(props: AccessInspectorProps) {
  const [query, setQuery] = useState("");
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = query.trim().toLocaleLowerCase("tr-TR");
  const label = (m: string) => MODULE_LABELS[m as keyof typeof MODULE_LABELS] ?? m;
  const list = props.rows.filter((r) => (!onlyBlocked || !r.final.includes("view")) && (!q || label(r.module).toLocaleLowerCase("tr-TR").includes(q)));
  const blocked = props.rows.filter((r) => !r.final.includes("view")).length;
  const customized = props.rows.filter((r) => r.decidedBy === "user" || r.decidedBy === "tenant_role").length;

  const blockers = [
    !props.isActive ? "Hesap pasif: giriş yapamaz, aşağıdaki izinlerin hiçbiri kullanılamaz." : null,
    props.tenantStatus === "suspended" ? "Ofis askıda: ofis kullanıcıları uygulamaya giremez." : null,
    props.tenantStatus === "cancelled" ? "Ofis iptal edilmiş: ofis kullanıcıları uygulamaya giremez." : null,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className="space-y-5">
      {blockers.length ? (
        <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/8 px-4 py-3 text-sm font-semibold text-danger-600">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{blockers.join(" ")}</span>
        </div>
      ) : null}

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <ShieldCheck className="h-4 w-4 text-brand-600" aria-hidden /> Etkin izinler
            </h2>
            <p className="text-xs text-text-muted">
              Rol: <strong className="text-ink-950">{props.roleLabel}</strong> · {blocked} modül kapalı · {customized} modülde ofis ayarı ya da kişi istisnası var.
              Sonuç uygulamanın gerçek kapısıyla aynı kuraldan hesaplanır.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Modül ara</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Modül ara (ör. müşteri)"
                className="focus-ring h-9 w-52 rounded-[var(--radius-control)] border border-line bg-canvas pl-8 pr-3 text-sm"
              />
            </label>
            <Button type="button" size="sm" variant={onlyBlocked ? "navy" : "outline"} onClick={() => setOnlyBlocked((v) => !v)} aria-pressed={onlyBlocked}>
              <EyeOff className="h-3.5 w-3.5" aria-hidden /> Yalnız kapalılar ({blocked})
            </Button>
          </div>
        </div>

        <ul className="mt-4 divide-y divide-line/70">
          {list.length === 0 ? <li className="py-6 text-center text-sm text-text-muted">Aramayla eşleşen modül yok.</li> : null}
          {list.map((r) => {
            const text = describeModuleAccess(r, { moduleLabel: label(r.module), roleLabel: props.roleLabel, fmtDate });
            const canSee = r.final.includes("view");
            const isOpen = open === r.module;
            return (
              <li key={r.module} className="py-2.5">
                <div className="flex flex-wrap items-start gap-3">
                  <span className={`mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full ${canSee ? "bg-mint-500/15 text-mint-700" : "bg-danger-500/10 text-danger-600"}`} aria-hidden>
                    {canSee ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-950">{text.summary}</p>
                    <p className="text-xs text-text-muted">{text.source}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1" aria-label="Etkin işlemler">
                    {ACTION_ORDER.map((a) => (
                      <span
                        key={a}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.final.includes(a) ? "bg-brand-600/10 text-brand-700" : "bg-ink-950/5 text-text-faint line-through"}`}
                      >
                        {short[a]}
                      </span>
                    ))}
                  </div>
                  {props.canEdit && r.decidedBy !== "readonly_ceiling" && r.decidedBy !== "unknown_role" ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(isOpen ? null : r.module)} aria-expanded={isOpen}>
                      <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Düzenle
                      <ChevronDown className={`h-3.5 w-3.5 transition ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                    </Button>
                  ) : null}
                </div>
                {isOpen ? <ModuleEditor row={r} {...props} moduleLabel={label(r.module)} /> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <ScopePanel {...props} />
    </div>
  );
}

function useRun() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  function run(action: (fd: FormData) => Promise<AccessActionResult>, fd: FormData, okText: string, after?: () => void) {
    setNotice(null);
    start(async () => {
      const res = await action(fd);
      if (res.error) setNotice({ tone: "error", text: res.error });
      else {
        setNotice({ tone: "ok", text: okText });
        after?.();
        router.refresh();
      }
    });
  }
  return { busy, notice, run };
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold ${notice.tone === "error" ? "bg-danger-500/8 text-danger-600" : "bg-mint-500/10 text-mint-700"}`}>
      {notice.text}
    </p>
  );
}

function ModuleEditor({ row, memberId, tenantId, role, roleLabel, moduleLabel }: AccessInspectorProps & { row: ModuleAccessRow; moduleLabel: string }) {
  const { busy, notice, run } = useRun();
  const isOwner = role === "owner";
  const [actions, setActions] = useState<AppAction[]>(row.userOverride?.actions ?? row.final);
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState("");

  function overrideFd(mode: "set" | "remove") {
    const fd = new FormData();
    fd.set("id", memberId);
    fd.set("module", row.module);
    fd.set("mode", mode);
    fd.set("reason", reason);
    if (expires) fd.set("expires_at", `${expires}T23:59:59+03:00`);
    for (const a of actions) fd.append("actions", a);
    return fd;
  }
  function roleFd(action: AppAction, mode: "allow" | "deny" | "default") {
    const fd = new FormData();
    fd.set("tenant_id", tenantId);
    fd.set("member_id", memberId);
    fd.set("role", role);
    fd.set("module", row.module);
    fd.set("action", action);
    fd.set("mode", mode);
    fd.set("reason", reason);
    return fd;
  }

  return (
    <div className="mt-3 space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
      <FormField label="Gerekçe (zorunlu, ofis denetim kaydına yazılır)" htmlFor={`reason-${row.module}`}>
        <FormInput id={`reason-${row.module}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Ör. destek talebi #1234: danışman müşteri listesini göremiyor" />
      </FormField>

      {!isOwner ? (
        <fieldset className="space-y-2">
          <legend className="flex items-center gap-1.5 text-xs font-bold text-ink-950">
            <UserCog className="h-3.5 w-3.5" aria-hidden /> Kişi istisnası — yalnız bu üye ({moduleLabel})
          </legend>
          <div className="flex flex-wrap gap-3">
            {ACTION_ORDER.map((a) => (
              <label key={a} className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={actions.includes(a)}
                  onChange={(e) => setActions((prev) => (e.target.checked ? ACTION_ORDER.filter((x) => x === a || prev.includes(x)) : prev.filter((x) => x !== a)))}
                />
                {short[a]}
              </label>
            ))}
            <label className="inline-flex items-center gap-1.5 text-xs text-text-muted">
              Bitiş (isteğe bağlı)
              <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="focus-ring h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-xs" />
            </label>
          </div>
          <p className="text-xs text-text-faint">Hiçbiri seçilmezse modül bu üyeye kapanır. Ekle/Düzenle/Sil seçilirse Görüntüle de verilir.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="navy" disabled={busy} onClick={() => run(setMemberOverrideAsStaff, overrideFd("set"), "Kişi istisnası kaydedildi.")}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} İstisnayı kaydet
            </Button>
            {row.userOverride ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(setMemberOverrideAsStaff, overrideFd("remove"), "İstisna kaldırıldı; modül rol iznine döndü.")}>
                İstisnayı kaldır
              </Button>
            ) : null}
          </div>
        </fieldset>
      ) : (
        <p className="text-xs text-text-muted">Ofis sahibi kişi istisnasından muaftır; rolü daima tam yetkilidir.</p>
      )}

      {!isOwner ? (
        <fieldset className="space-y-2 border-t border-line pt-3">
          <legend className="text-xs font-bold text-ink-950">Ofis rol ayarı — bu ofisteki TÜM {roleLabel} kullanıcılarını etkiler</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ACTION_ORDER.map((a) => {
              const state = row.roleAdded.includes(a) ? "allow" : row.roleRemoved.includes(a) ? "deny" : "default";
              return (
                <label key={a} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm">
                  <span>
                    {short[a]} <span className="text-xs text-text-faint">(varsayılan: {row.defaults.includes(a) ? "açık" : "kapalı"})</span>
                  </span>
                  <select
                    value={state}
                    disabled={busy}
                    aria-label={`${moduleLabel} ${ACTION_LABELS[a]} rol ayarı`}
                    onChange={(e) => run(setTenantRolePermissionAsStaff, roleFd(a, e.target.value as "allow" | "deny" | "default"), "Ofis rol ayarı güncellendi.")}
                    className="focus-ring h-8 rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-xs"
                  >
                    <option value="default">Varsayılan</option>
                    <option value="allow">İzin ver</option>
                    <option value="deny">Kapat</option>
                  </select>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-text-faint">Değişiklik seçimle hemen yazılır; önce gerekçeyi doldurun.</p>
        </fieldset>
      ) : null}
      <NoticeLine notice={notice} />
    </div>
  );
}

function ScopePanel({ memberId, role, scope, branches, teams, canEdit }: AccessInspectorProps) {
  const { busy, notice, run } = useRun();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<ScopeRowInput>(scope.value);
  const [reason, setReason] = useState("");

  function fd(mode: "set" | "reset") {
    const f = new FormData();
    f.set("id", memberId);
    f.set("mode", mode);
    f.set("reason", reason);
    f.set("scope_type", v.scope_type);
    if (v.team_id) f.set("team_id", v.team_id);
    if (v.branch_id) f.set("branch_id", v.branch_id);
    for (const k of ["can_view_all_data", "can_edit_team_members", "can_override_permissions", "can_see_earnings"] as const) f.set(k, v[k] ? "1" : "0");
    return f;
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink-950">Veri kapsamı</h2>
          <p className="text-sm text-ink-950">{scope.text}</p>
          <p className="text-xs text-text-muted">İzin modülü açsa bile kapsam hangi kayıtların görüneceğini belirler (ör. danışman yalnız kendi müşterilerini görür).</p>
        </div>
        {canEdit && role !== "readonly" ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing((x) => !x)} aria-expanded={editing}>
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Kapsamı düzenle
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-4 space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Kapsam" htmlFor="scope_type">
              <FormSelect id="scope_type" value={v.scope_type} onChange={(e) => setV({ ...v, scope_type: e.target.value as ScopeRowInput["scope_type"] })}>
                {(["user", "team", "branch", "office"] as const).map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABELS[s]}
                  </option>
                ))}
              </FormSelect>
            </FormField>
            {v.scope_type === "team" ? (
              <FormField label="Takım" htmlFor="scope_team">
                <FormSelect id="scope_team" value={v.team_id ?? ""} onChange={(e) => setV({ ...v, team_id: e.target.value || null })}>
                  <option value="">Seçin</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
            ) : null}
            {v.scope_type === "branch" ? (
              <FormField label="Şube" htmlFor="scope_branch">
                <FormSelect id="scope_branch" value={v.branch_id ?? ""} onChange={(e) => setV({ ...v, branch_id: e.target.value || null })}>
                  <option value="">Seçin</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {(
              [
                ["can_view_all_data", "Tüm ofis verisini görür"],
                ["can_edit_team_members", "Ekip üyelerini düzenler"],
                ["can_override_permissions", "İzin istisnası tanımlar"],
                ["can_see_earnings", "Kazançları görür"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="inline-flex items-center gap-1.5">
                <input type="checkbox" className="h-4 w-4" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /> {l}
              </label>
            ))}
          </div>
          <FormField label="Gerekçe (zorunlu)" htmlFor="scope_reason">
            <FormInput id="scope_reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="navy" disabled={busy} onClick={() => run(setMemberScopeAsStaff, fd("set"), "Kapsam kaydedildi.", () => setEditing(false))}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Kaydet
            </Button>
            {scope.custom ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(setMemberScopeAsStaff, fd("reset"), "Kapsam rol varsayılanına döndü.", () => setEditing(false))}>
                Rol varsayılanına dön
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="mt-3">
        <NoticeLine notice={notice} />
      </div>
    </section>
  );
}
