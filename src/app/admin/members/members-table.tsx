"use client";

import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Building2, Crown, Eye, Layers3, Loader2, LogOut, Phone, ShieldCheck, User, UserCheck, UserMinus, UserX, Users, X } from "lucide-react";
import {
  bulkDeactivateMembers,
  bulkSignOutMembers,
  setMemberActiveAsStaff,
  setMemberRoleAsStaff,
  type BulkMemberResult,
} from "@/app/actions/platform-members";
import { useStepUpPrompt } from "@/components/admin/step-up";
import { Avatar } from "@/components/ui/avatar";
import { Button, ButtonLink } from "@/components/ui/button";
import { DraftTable } from "@/components/ui/draft-table";
import { InlineSelect, type InlineSelectOption } from "@/components/ui/inline-select";
import { RowSaveActions, rowDraftProps } from "@/components/ui/row-save-actions";
import { ROLE_LABELS } from "@/lib/role-labels";
import { ASSIGNABLE_ROLES } from "@/lib/team/assignable-roles";
import { useRowDraft } from "@/lib/ui/use-row-draft";

/**
 * Platform kullanıcıları tablosu — satır içi kaydetme standardı. Rol (yalnız süper admin; ofis sahibi bu ekrandan
 * değişmez) ve aktif/pasif (süper admin + operasyon) mevcut eylemlerle (`setMemberRoleAsStaff`,
 * `setMemberActiveAsStaff`) TEK Kaydet ile yazılır; pasifleştirme satır içi onay ister. Sunucu kuralları
 * (tek aktif sahip, koltuk sınırı, askıdaki ofis) yine sunucuda; hata satırda gösterilir.
 * Toplu işlem (süper admin + operasyon): satır seçimi → alttaki şeritte "Pasifleştir" / "Oturumları kapat",
 * satır içi onayla TEK istekte (en çok 100). Başarısız kalanlar adıyla listelenir ve seçimde kalır.
 */

export type MemberRowData = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  phoneDisplay: string | null;
  tenantId: string | null;
  tenantName: string;
  branchName: string | null;
  role: string;
  active: boolean;
  twoFactor: boolean;
  /** null = veri yok (arama RPC'si kurulmadı); "Hiç giriş yok" metni sunucudan gelir. */
  lastLoginLabel: string | null;
  createdLabel: string;
  avatarUrl?: string | null;
  avatarPreset?: string | null;
};

const ROLE_ICON: Record<string, InlineSelectOption["icon"]> = { gm: ShieldCheck, branch_manager: Building2, team_lead: Users };
const ROLE_OPTIONS: InlineSelectOption[] = ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r, icon: ROLE_ICON[r] ?? User, tone: "brand" }));
const ACTIVE_OPTIONS: InlineSelectOption[] = [
  { value: "1", label: "Aktif", icon: UserCheck, tone: "success" },
  { value: "0", label: "Pasif", icon: UserX, tone: "neutral", hint: "Oturumları kapanır, giriş yapamaz" },
];

type MemberDraft = { role: string; active: string };
type BulkKind = "deactivate" | "signout";

export function MembersTable({ rows, canRole, canActive, showLogin }: { rows: MemberRowData[]; canRole: boolean; canActive: boolean; showLogin: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Sayfa değişince görünmeyen seçimler düşer: render sırasında süzülür (efekt yok).
  const visible = new Set(rows.map((r) => r.id));
  const picked = Array.from(selected).filter((id) => visible.has(id));
  const allOn = rows.length > 0 && picked.length === rows.length;
  const names = new Map(rows.map((r) => [r.id, r.name]));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <DraftTable>
      <div className="adm-scroll">
        <table className="adm-tbl">
          <caption className="sr-only">Platform kullanıcıları; rol ve durum satır içinde düzenlenir, her satır kendi Kaydet düğmesiyle kaydedilir.</caption>
          <thead>
            <tr>
              {canActive ? (
                <th scope="col" className="w-10">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={allOn}
                    aria-label={allOn ? "Seçimi temizle" : "Bu sayfadaki tüm kullanıcıları seç"}
                    onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              ) : null}
              <th scope="col">Kullanıcı</th>
              <th scope="col">Ofis</th>
              <th scope="col">Rol</th>
              <th scope="col">Durum</th>
              <th scope="col">{showLogin ? "Son giriş" : "Kayıt"}</th>
              <th scope="col" className="text-right">
                İşlemler
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <MemberRow
                key={r.id}
                row={r}
                canRole={canRole}
                canActive={canActive}
                showLogin={showLogin}
                selected={selected.has(r.id)}
                onToggle={() => toggle(r.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {canActive && picked.length > 0 ? (
        <BulkBar ids={picked} names={names} onClear={() => setSelected(new Set())} onKeep={(ids) => setSelected(new Set(ids))} />
      ) : null}
    </DraftTable>
  );
}

function BulkBar({ ids, names, onClear, onKeep }: { ids: string[]; names: Map<string, string>; onClear: () => void; onKeep: (ids: string[]) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<BulkKind | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function run(kind: BulkKind) {
    const fd = new FormData();
    for (const id of ids) fd.append("ids", id);
    setConfirm(null);
    setNotice(null);
    start(async () => {
      const res: BulkMemberResult = kind === "deactivate" ? await bulkDeactivateMembers(fd) : await bulkSignOutMembers(fd);
      const done = res.done ?? 0;
      const okText = kind === "deactivate" ? `${done} üye pasifleştirildi` : `${done} üyenin oturumları kapatıldı`;
      if (res.failed?.length) {
        const list = res.failed
          .slice(0, 5)
          .map((f) => `${f.name}: ${f.error}`)
          .join(" · ");
        setNotice({ tone: "error", text: `${okText}; ${res.failed.length} başarısız — ${list}` });
        onKeep(res.failed.map((f) => f.id));
      } else if (res.error) {
        setNotice({ tone: "error", text: res.error });
      } else {
        setNotice({ tone: "ok", text: `${okText}.` });
        onClear();
      }
      router.refresh();
    });
  }

  const first = names.get(ids[0]) ?? "";
  return (
    <aside aria-label="Seçili kullanıcılar için toplu işlem" className="fixed bottom-20 left-3 right-3 z-40 md:bottom-4 md:left-[280px] md:right-4">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 rounded-[var(--radius-card)] border border-white/12 bg-ink-950/95 p-3 text-white shadow-[var(--elev-4)] backdrop-blur-xl lg:flex-row lg:items-center">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-amber-400 text-ink-950">
            <Layers3 className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="numeric text-sm font-extrabold">{ids.length} kullanıcı seçildi</p>
            <p className="truncate text-xs text-white/60">{ids.length === 1 ? first : `${first} ve ${ids.length - 1} kişi daha`}</p>
          </div>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {notice ? (
            <p role={notice.tone === "error" ? "alert" : "status"} className={`mr-auto text-xs font-semibold ${notice.tone === "error" ? "text-danger-300" : "text-mint-300"}`}>
              {notice.text}
            </p>
          ) : null}
          {confirm ? (
            <span className="inline-flex flex-wrap items-center gap-2 text-xs font-semibold">
              {confirm === "deactivate"
                ? `${ids.length} kullanıcı pasifleşsin ve oturumları kapansın mı? (Ofisin tek aktif sahibi atlanır.)`
                : `${ids.length} kullanıcının tüm açık oturumları kapansın mı?`}
              <Button type="button" size="sm" variant="navy" onClick={() => run(confirm)}>
                Evet, uygula
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirm(null)}>
                Vazgeç
              </Button>
            </span>
          ) : (
            <>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirm("signout")}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <LogOut className="h-3.5 w-3.5" aria-hidden />} Oturumları kapat
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirm("deactivate")} className="border-danger-500/50 text-danger-300">
                <UserMinus className="h-3.5 w-3.5" aria-hidden /> Pasifleştir
              </Button>
              <Button type="button" size="icon" variant="ghost" disabled={pending} onClick={onClear} aria-label="Seçimi temizle">
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function MemberRow({
  row,
  canRole,
  canActive,
  showLogin,
  selected,
  onToggle,
}: {
  row: MemberRowData;
  canRole: boolean;
  canActive: boolean;
  showLogin: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const isOwner = row.role === "owner";
  const stepUp = useStepUpPrompt();
  const draft = useRowDraft<MemberDraft>({
    id: row.id,
    label: row.name,
    saved: { role: row.role, active: row.active ? "1" : "0" },
    risk: (d, s) => (d.active === "0" && s.active === "1" ? "Kullanıcının açık oturumları kapanacak ve giriş yapamayacak." : null),
    save: async (d, { saved }) => {
      const fd = new FormData();
      fd.set("id", row.id);
      // Aktifleştirme önce (koltuk/ofis kuralı), rol sonra, pasifleştirme en son.
      if (d.active === "1" && saved.active === "0") {
        fd.set("is_active", "true");
        const r = await setMemberActiveAsStaff(fd);
        if (r.error) return { error: r.error };
      }
      if (d.role !== saved.role) {
        fd.set("role", d.role);
        const code = await stepUp.ask("Rol değişikliği");
        if (!code) return { error: "Rol değişikliği için doğrulayıcı kodu gerekli." };
        fd.set("step_up_code", code);
        const r = await setMemberRoleAsStaff(fd);
        if (r.error) {
          router.refresh();
          return { error: r.error };
        }
      }
      if (d.active === "0" && saved.active === "1") {
        fd.set("is_active", "false");
        const r = await setMemberActiveAsStaff(fd);
        if (r.error) {
          router.refresh();
          return { error: r.error };
        }
      }
      router.refresh();
      return { ok: true };
    },
  });

  return (
    <tr {...rowDraftProps(draft)} aria-selected={canActive ? selected : undefined}>
      {canActive ? (
        <td>
          <input type="checkbox" className="h-4 w-4" checked={selected} onChange={onToggle} aria-label={`${row.name} seç`} />
        </td>
      ) : null}
      <td>
        {stepUp.dialog}
        <div className="adm-ent">
          {row.avatarUrl || row.avatarPreset ? (
            <Avatar name={row.name} src={row.avatarUrl} preset={row.avatarPreset} size="md" />
          ) : (
            <span className="adm-ent-ico" aria-hidden="true">
              {isOwner ? <Crown /> : <User />}
            </span>
          )}
          <div className="min-w-0">
            <Link href={`/admin/members/${row.id}`} className="adm-ent-name focus-ring rounded-sm hover:text-accent-text">
              {row.name}
            </Link>
            <div className="adm-ent-meta">
              {row.email ? <span className="truncate">{row.email}</span> : null}
              {row.phoneDisplay ? <span>{row.phoneDisplay}</span> : row.email ? null : <span>Telefon yok</span>}
              {row.twoFactor ? (
                <span className="inline-flex items-center gap-0.5 text-mint-700" title="SMS iki adımlı doğrulama açık">
                  <ShieldCheck className="h-3 w-3" aria-hidden /> 2FA
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </td>
      <td data-label="Ofis">
        {row.tenantId ? (
          <Link href={`/admin/tenants/${row.tenantId}`} className="font-semibold text-accent-text hover:underline">
            {row.tenantName}
          </Link>
        ) : (
          <span className="text-text-faint">—</span>
        )}
        {row.branchName ? <div className="text-xs text-text-muted">{row.branchName}</div> : null}
      </td>
      <td data-label="Rol">
        {isOwner ? (
          <span className="adm-pill pm-t-gold" title="Ofis sahibi yalnız sahiplik devriyle değişir (Ofis 360 > Yönetim)">
            <Crown aria-hidden="true" />
            {ROLE_LABELS.owner}
          </span>
        ) : (
          <InlineSelect
            value={draft.draft.role}
            onValueChange={(v) => draft.set("role", v)}
            options={ROLE_OPTIONS.some((o) => o.value === row.role) ? ROLE_OPTIONS : [...ROLE_OPTIONS, { value: row.role, label: ROLE_LABELS[row.role] ?? row.role, icon: User, tone: "neutral" }]}
            label={`${row.name} rolü`}
            changed={draft.changed.has("role")}
            disabled={!canRole || draft.locked}
            className="w-[10.5rem]"
          />
        )}
      </td>
      <td data-label="Durum">
        <InlineSelect
          value={draft.draft.active}
          onValueChange={(v) => draft.set("active", v)}
          options={ACTIVE_OPTIONS}
          label={`${row.name} durumu`}
          changed={draft.changed.has("active")}
          disabled={!canActive || draft.locked}
          className="w-[7.5rem]"
        />
      </td>
      <td data-label={showLogin ? "Son giriş" : "Kayıt"} className="whitespace-nowrap text-xs text-text-muted" title={`Kayıt: ${row.createdLabel}`}>
        {showLogin ? row.lastLoginLabel : row.createdLabel}
      </td>
      <td>
        <div className="adm-acts">
          <RowSaveActions draft={draft}>
            {row.phone ? (
              <ButtonLink href={`tel:${row.phone}`} size="icon" variant="ghost" aria-label={`Ara: ${row.name}`} title="Ara">
                <Phone className="h-4 w-4" aria-hidden="true" />
              </ButtonLink>
            ) : null}
            <ButtonLink href={`/admin/members/${row.id}`} size="sm" variant="outline" icon={Eye} aria-label={`Ayrıntı: ${row.name}`}>
              <span className="btn-text">Ayrıntı</span>
            </ButtonLink>
          </RowSaveActions>
        </div>
      </td>
    </tr>
  );
}
