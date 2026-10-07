"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Crown, Eye, Phone, ShieldCheck, User, UserCheck, UserX, Users } from "lucide-react";
import { setMemberActiveAsStaff, setMemberRoleAsStaff } from "@/app/actions/platform-members";
import { ButtonLink } from "@/components/ui/button";
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
 */

export type MemberRowData = {
  id: string;
  name: string;
  phone: string | null;
  phoneDisplay: string | null;
  tenantId: string | null;
  tenantName: string;
  role: string;
  active: boolean;
  createdLabel: string;
};

const ROLE_ICON: Record<string, InlineSelectOption["icon"]> = { gm: ShieldCheck, branch_manager: Building2, team_lead: Users };
const ROLE_OPTIONS: InlineSelectOption[] = ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r, icon: ROLE_ICON[r] ?? User, tone: "brand" }));
const ACTIVE_OPTIONS: InlineSelectOption[] = [
  { value: "1", label: "Aktif", icon: UserCheck, tone: "success" },
  { value: "0", label: "Pasif", icon: UserX, tone: "neutral", hint: "Oturumları kapanır, giriş yapamaz" },
];

type MemberDraft = { role: string; active: string };

export function MembersTable({ rows, canRole, canActive }: { rows: MemberRowData[]; canRole: boolean; canActive: boolean }) {
  return (
    <DraftTable>
      <div className="adm-scroll">
        <table className="adm-tbl">
          <caption className="sr-only">Platform kullanıcıları; rol ve durum satır içinde düzenlenir, her satır kendi Kaydet düğmesiyle kaydedilir.</caption>
          <thead>
            <tr>
              <th scope="col">Kullanıcı</th>
              <th scope="col">Ofis</th>
              <th scope="col">Rol</th>
              <th scope="col">Durum</th>
              <th scope="col">Kayıt</th>
              <th scope="col" className="text-right">
                İşlemler
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <MemberRow key={r.id} row={r} canRole={canRole} canActive={canActive} />
            ))}
          </tbody>
        </table>
      </div>
    </DraftTable>
  );
}

function MemberRow({ row, canRole, canActive }: { row: MemberRowData; canRole: boolean; canActive: boolean }) {
  const router = useRouter();
  const isOwner = row.role === "owner";
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
    <tr {...rowDraftProps(draft)}>
      <td>
        <div className="adm-ent">
          <span className="adm-ent-ico" aria-hidden="true">
            {isOwner ? <Crown /> : <User />}
          </span>
          <div className="min-w-0">
            <Link href={`/admin/members/${row.id}`} className="adm-ent-name focus-ring rounded-sm hover:text-accent-text">
              {row.name}
            </Link>
            <div className="adm-ent-meta">{row.phoneDisplay ? <span>{row.phoneDisplay}</span> : <span>Telefon yok</span>}</div>
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
      <td data-label="Kayıt" className="whitespace-nowrap text-xs text-text-muted">
        {row.createdLabel}
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
