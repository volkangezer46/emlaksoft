import { requireActiveTenant } from "@/lib/tenant-guard";
import { awaitingOwnerConfirmation, getPortalAccountState, getPortalMemberships } from "@/lib/portals/membership";
import { PortalMembershipsCard, type PortalMembershipCardItem } from "./portal-memberships-card";

/**
 * Portal üyelikleri kartının sunucu tarafı: üyelik okuyucusundan (`portals/membership.ts`) beyan + öneriyi alır, formun
 * başlangıç seçimlerini hazırlar. /app/ayarlar/entegrasyonlar (`#portal-uyelikleri`) ve Kurulum > "Vitrin ve portallar" aynı
 * bileşeni kullanır. Düzenleme yetkisi owner/gm (eylem ve RLS ayrıca denetler).
 */
export async function PortalMembershipsSection({ question = false }: { question?: boolean }) {
  const gate = await requireActiveTenant();
  if (!gate.ok) return null;
  const [memberships, table] = await Promise.all([getPortalMemberships(gate.tenantId), getPortalAccountState(gate.tenantId)]);
  const items: PortalMembershipCardItem[] = memberships.map((m) => ({
    portal: m.portal,
    label: m.label,
    status: m.isDeclared ? m.declared : m.suggestion?.suggested === "active" ? "active" : "unknown",
    declared: m.isDeclared,
    suggested: !m.isDeclared && m.suggestion?.suggested === "active",
    evidence: m.suggestion?.evidence ?? null,
    checkEnabled: m.row?.check_enabled ?? true,
    accountLabel: m.row?.account_label ?? "",
    storeUrl: m.row?.store_url ?? "",
    planEndsAt: m.row?.plan_ends_at?.slice(0, 10) ?? "",
    lastLoginOkAt: m.row?.last_login_ok_at ?? null,
    lastLoginFailAt: m.row?.last_login_fail_at ?? null,
    loginFailStreak: m.row?.login_fail_streak ?? 0,
  }));
  return (
    <PortalMembershipsCard
      items={items}
      canEdit={gate.role === "owner" || gate.role === "gm"}
      available={table.available}
      awaitingConfirmation={awaitingOwnerConfirmation(memberships)}
      question={question}
    />
  );
}
