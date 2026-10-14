"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InlineSelect, type InlineSelectOption } from "@/components/ui/inline-select";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useStepUpPrompt } from "@/components/admin/step-up";
import { deleteCustomRole, saveCustomRole, type CustomRoleRow } from "@/app/actions/platform-roles";
import {
  PLATFORM_ACTIONS,
  PLATFORM_ACTION_LABELS,
  PLATFORM_BASE_ROLES,
  PLATFORM_ROLE_LABELS,
  normalizeActions,
  type PlatformAction,
  type PlatformModule,
} from "@/lib/platform-access";

type ModuleOption = { id: PlatformModule; label: string };
type Draft = { id: string | null; label: string; description: string; baseRole: string; perms: Record<string, PlatformAction[]> };

const BASE_OPTIONS: InlineSelectOption[] = PLATFORM_BASE_ROLES.map((r) => ({
  value: r,
  label: PLATFORM_ROLE_LABELS[r],
  hint: "Ekran yetkisi matristen gelir; rol adına bakan ince kurallar (ör. panel düzeni) bu rolden.",
}));

const emptyDraft = (): Draft => ({ id: null, label: "", description: "", baseRole: "support", perms: { dashboard: ["view"] } });

function summary(perms: Partial<Record<string, readonly PlatformAction[]>>, modules: readonly ModuleOption[]): string {
  const parts = modules
    .filter((m) => m.id !== "dashboard" && (perms[m.id]?.length ?? 0) > 0)
    .map((m) => {
      const a = perms[m.id]!;
      return `${m.label} (${a.includes("approve") ? "onaylar" : a.includes("write") ? "yazar" : "görür"})`;
    });
  return parts.length ? parts.join(" · ") : "Yalnız Genel bakış";
}

/**
 * Özel rol listesi + düzenleyici. Kutucuklar iç içedir: Onayla seçilince Yaz ve Görüntüle de seçilir, Görüntüle
 * kaldırılınca modül tümden kapanır (sunucu `normalizeMatrix` ile aynı kuralı yeniden uygular).
 */
export function RoleEditor({ roles, canEdit, modules }: { roles: CustomRoleRow[]; canEdit: boolean; modules: ModuleOption[] }) {
  const router = useRouter();
  const stepUp = useStepUpPrompt();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (mod: PlatformModule, action: PlatformAction, on: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      const cur = d.perms[mod] ?? [];
      let next: PlatformAction[];
      if (on) next = normalizeActions([...cur, action]);
      else if (action === "view") next = [];
      else if (action === "write") next = cur.filter((a) => a === "view");
      else next = cur.filter((a) => a !== "approve");
      return { ...d, perms: { ...d.perms, [mod]: next } };
    });
  };

  const save = () => {
    if (!draft || pending) return;
    startTransition(async () => {
      const code = await stepUp.ask(draft.id ? "Rolü güncelle" : "Rol oluştur");
      if (!code) return;
      const res = await saveCustomRole({
        id: draft.id,
        label: draft.label,
        description: draft.description,
        baseRole: draft.baseRole,
        permissions: draft.perms,
        stepUpCode: code,
      });
      if (res.error) {
        setMsg({ ok: false, text: res.error });
        return;
      }
      setMsg({ ok: true, text: "Rol kaydedildi. Rolü taşıyan personel bir sonraki sayfa açılışında yeni yetkiyle çalışır." });
      setDraft(null);
      router.refresh();
    });
  };

  const remove = (role: CustomRoleRow) => {
    if (pending) return;
    startTransition(async () => {
      const code = await stepUp.ask(`"${role.label}" rolünü sil`);
      if (!code) return;
      const res = await deleteCustomRole({ id: role.id, stepUpCode: code });
      setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: "Rol silindi." });
      if (!res.error) router.refresh();
    });
  };

  return (
    <section aria-labelledby="ozel-roller" className="space-y-3">
      {stepUp.dialog}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="ozel-roller" className="font-display font-bold text-ink-950">Özel roller</h2>
          <p className="text-xs text-text-muted">
            {canEdit ? "Yeni rol tanımlayın; personel listesinde Rol sütunundan atayın." : "Rolleri yalnız süper admin düzenler."}
          </p>
        </div>
        {canEdit && !draft ? (
          <Button size="sm" icon={Plus} onClick={() => { setMsg(null); setDraft(emptyDraft()); }}>
            Yeni rol
          </Button>
        ) : null}
      </div>

      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}

      {draft ? (
        <div className="space-y-4 rounded-[var(--radius-card)] border border-brand-300 bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-text-muted">
              Rol adı
              <Input value={draft.label} maxLength={60} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="mt-1" placeholder="ör. Finans onaylayıcı" />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Açıklama (isteğe bağlı)
              <Input value={draft.description} maxLength={300} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="mt-1" />
            </label>
            <div className="text-xs font-semibold text-text-muted">
              Taban rol
              <div className="mt-1">
                <InlineSelect value={draft.baseRole} onValueChange={(v) => setDraft({ ...draft, baseRole: v })} options={BASE_OPTIONS} label="Taban rol" plain />
              </div>
            </div>
          </div>
          <TableFrame minWidth={560}>
            <Table>
              <THead>
                <TR>
                  <TH>Ekran</TH>
                  {PLATFORM_ACTIONS.map((a) => (
                    <TH key={a} align="center">{PLATFORM_ACTION_LABELS[a]}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {modules.map((m) => (
                  <TR key={m.id}>
                    <TD className="text-xs font-semibold text-ink-950">{m.label}</TD>
                    {PLATFORM_ACTIONS.map((a) => {
                      const locked = m.id === "dashboard" && a === "view";
                      return (
                        <TD key={a} align="center">
                          <Checkbox
                            checked={locked || (draft.perms[m.id] ?? []).includes(a)}
                            disabled={locked || pending}
                            onChange={(e) => toggle(m.id, a, e.target.checked)}
                            aria-label={`${m.label}: ${PLATFORM_ACTION_LABELS[a]}`}
                          />
                        </TD>
                      );
                    })}
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableFrame>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} loading={pending} disabled={draft.label.trim().length < 2}>
              Kaydet
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}

      {roles.length === 0 && !draft ? (
        <p role="status" className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-sm text-text-muted">
          Henüz özel rol yok. Personel sabit rollerle (Süper admin, Operasyon, Müşteri temsilcisi, Muhasebe) çalışıyor.
        </p>
      ) : (
        <ul className="space-y-2">
          {roles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <div className="min-w-0 space-y-1">
                <p className="font-semibold text-ink-950">
                  {r.label} <span className="text-xs font-normal text-text-faint">· taban: {PLATFORM_ROLE_LABELS[r.base_role]} · {r.holders} personel</span>
                </p>
                {r.description ? <p className="text-xs text-text-muted">{r.description}</p> : null}
                <p className="text-xs text-text-muted">{summary(r.permissions, modules)}</p>
              </div>
              {canEdit ? (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Pencil}
                    disabled={pending}
                    onClick={() => {
                      setMsg(null);
                      setDraft({
                        id: r.id,
                        label: r.label,
                        description: r.description ?? "",
                        baseRole: r.base_role,
                        perms: Object.fromEntries(Object.entries(r.permissions).map(([k, v]) => [k, [...(v ?? [])]])),
                      });
                    }}
                  >
                    Düzenle
                  </Button>
                  <Button size="sm" variant="outline" icon={Trash2} disabled={pending || r.holders > 0} title={r.holders > 0 ? "Personelde kullanılan rol silinemez" : undefined} onClick={() => remove(r)}>
                    Sil
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
