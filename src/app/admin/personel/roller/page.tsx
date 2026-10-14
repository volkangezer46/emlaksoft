import { KeyRound } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePlatformModule } from "@/lib/platform";
import { PLATFORM_MODULES, PLATFORM_ROLE_LABELS, fixedRoleMatrix, type PlatformAction, type PlatformRole } from "@/lib/platform-access";
import { listCustomRoles } from "@/app/actions/platform-roles";
import { PLATFORM_MODULE_LABELS, PLATFORM_ROLES } from "../staff-model";
import { PersonelTabs } from "../personel-tabs";
import { RoleEditor } from "./role-editor";

export const metadata = { title: "Personel rolleri" };

const LEVEL: Record<PlatformAction | "none", string> = { none: "—", view: "Görür", write: "Yazar", approve: "Onaylar" };

function levelOf(actions: readonly PlatformAction[] | undefined): PlatformAction | "none" {
  if (!actions?.length) return "none";
  return actions.includes("approve") ? "approve" : actions.includes("write") ? "write" : "view";
}

/**
 * Personel > Roller (DG1). Özel rol: modül × eylem (Görüntüle / Yaz / Onayla) matrisi + taban rol. Atanan personel
 * YALNIZ izin verilen ekranları görür, eylemler sunucuda reddedilir. Sabit roller aynı modele haritalıdır (aşağıdaki
 * salt okunur tablo; tek kaynak src/lib/platform-access.ts). Oluşturma/düzenleme yalnız süper admin + doğrulayıcı kodu.
 */
export default async function RolesPage() {
  const staff = await requirePlatformModule("personel");
  const list = await listCustomRoles();
  const canEdit = staff.role === "super_admin";
  const fixed = Object.fromEntries(PLATFORM_ROLES.map((r) => [r, fixedRoleMatrix(r)])) as Record<PlatformRole, ReturnType<typeof fixedRoleMatrix>>;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Platform personeli"
        icon={KeyRound}
        title="Roller ve eylem izinleri"
        description="Özel rol: hangi ekranı görür, hangisinde işlem yapar, hangi kritik işlemi onaylar. Atama Personel listesindeki Rol sütunundan yapılır."
        art="shield"
      />
      <PersonelTabs active="roller" />

      {list.ok ? (
        <RoleEditor roles={list.roles} canEdit={canEdit} modules={PLATFORM_MODULES.map((m) => ({ id: m, label: PLATFORM_MODULE_LABELS[m] }))} />
      ) : (
        <p role="status" className="rounded-[var(--radius-card)] border border-line bg-surface p-5 text-sm text-text-muted">
          {list.error}
        </p>
      )}

      <section aria-labelledby="sabit-roller" className="space-y-3">
        <div>
          <h2 id="sabit-roller" className="font-display font-bold text-ink-950">Sabit roller</h2>
          <p className="text-xs text-text-muted">
            Değiştirilemez; mevcut personelin yetkisi bunlardan gelir. &quot;Onaylar&quot; düzeyi iade, kredi, ofis kapatma ve rol değişikliği gibi
            kritik işlemleri ve dört göz onayını kapsar.
          </p>
        </div>
        <TableFrame minWidth={720}>
          <Table>
            <THead>
              <TR>
                <TH>Ekran</TH>
                {PLATFORM_ROLES.map((r) => (
                  <TH key={r}>{PLATFORM_ROLE_LABELS[r]}</TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {PLATFORM_MODULES.map((m) => (
                <TR key={m}>
                  <TD className="text-xs font-semibold text-ink-950">{PLATFORM_MODULE_LABELS[m]}</TD>
                  {PLATFORM_ROLES.map((r) => {
                    const lvl = levelOf(fixed[r][m]);
                    return (
                      <TD key={r} className={`text-xs ${lvl === "none" ? "text-text-faint" : "text-ink-950"}`}>
                        {LEVEL[lvl]}
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableFrame>
      </section>
    </div>
  );
}
