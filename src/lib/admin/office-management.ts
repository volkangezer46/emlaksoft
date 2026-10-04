import type { SupabaseClient } from "@supabase/supabase-js";
import { OFFICE_ADMIN_ACTIONS, officeAdminCan, type OfficeAdminAction } from "@/lib/admin/office-admin-access";
import type { PlatformRole } from "@/lib/platform-access";

/**
 * Ofis 360 > Yönetim sekmesinin veri katmanı.
 * `createAdminClient` burada ÇAĞRILMAZ: yetkili istemci sayfadan parametre olarak gelir (office-360.ts deseni).
 * Gizlilik: yalnız ofis ve personel bilgisi (ad, rol, durum, sahibin giriş e-postası) ile platformun
 * kendi dahili notları okunur; ofisin müşteri verisine dokunulmaz.
 */

export type ManagementMember = { id: string; fullName: string | null; role: string; isActive: boolean };

export type ManagementNote = { id: string; note: string; createdAt: string; author: string | null };

export type OfficeManagementData = {
  owner: { id: string; fullName: string | null; email: string | null; isActive: boolean } | null;
  ownerCount: number;
  members: ManagementMember[];
  activeSeats: number;
  notes: ManagementNote[];
  provinces: { id: string; name: string }[];
};

export type OfficeAdminCanMap = Record<OfficeAdminAction, boolean>;

export function officeAdminCanMap(role: PlatformRole): OfficeAdminCanMap {
  const out = {} as OfficeAdminCanMap;
  for (const action of OFFICE_ADMIN_ACTIONS) out[action] = officeAdminCan(role, action);
  return out;
}

/** Rol sırası: sahip en üstte, sonra yönetim kademesi, sonra diğerleri; pasifler sonda. */
const ROLE_ORDER = ["owner", "gm", "branch_manager", "team_lead", "advisor", "call_center", "accounting", "readonly"];

export function sortManagementMembers(members: ManagementMember[]): ManagementMember[] {
  const rank = (m: ManagementMember) => {
    const i = ROLE_ORDER.indexOf(m.role);
    return (m.isActive ? 0 : 100) + (i < 0 ? ROLE_ORDER.length : i);
  };
  return [...members].sort((a, b) => rank(a) - rank(b) || (a.fullName ?? "").localeCompare(b.fullName ?? "", "tr"));
}

type NoteRow = { id: string; actor_id: string | null; meta: unknown; created_at: string };

/** platform_audit_logs satırından not metni (meta.note); bozuk/boş kayıt atlanır. */
export function noteTextOf(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const note = (meta as Record<string, unknown>).note;
  return typeof note === "string" && note.trim() ? note : null;
}

export async function loadOfficeManagement(
  admin: SupabaseClient,
  tenantId: string,
  opts: { withMembers: boolean; withNotes: boolean },
): Promise<OfficeManagementData> {
  const [profiles, notes, provinces, staff] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, role, is_active, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(300),
    opts.withNotes
      ? admin
          .from("platform_audit_logs")
          .select("id, actor_id, meta, created_at")
          .eq("entity_id", tenantId)
          .eq("action", "tenant.note")
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as NoteRow[] }),
    admin.from("geo_provinces").select("id, name").order("name", { ascending: true }),
    opts.withNotes ? admin.from("platform_staff").select("id, full_name").limit(300) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const rows = (profiles.data ?? []) as { id: string; full_name: string | null; role: string; is_active: boolean }[];
  const members = rows.map((r) => ({ id: r.id, fullName: r.full_name, role: r.role, isActive: r.is_active }));
  const owners = members.filter((m) => m.role === "owner");
  const ownerRow = owners.find((o) => o.isActive) ?? owners[0] ?? null;

  let ownerEmail: string | null = null;
  if (ownerRow) {
    const { data } = await admin.auth.admin.getUserById(ownerRow.id);
    ownerEmail = data.user?.email ?? null;
  }

  const staffNames = new Map(((staff.data ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
  const noteRows = ((notes.data ?? []) as NoteRow[]).flatMap((n) => {
    const text = noteTextOf(n.meta);
    return text ? [{ id: n.id, note: text, createdAt: n.created_at, author: n.actor_id ? (staffNames.get(n.actor_id) ?? null) : null }] : [];
  });

  return {
    owner: ownerRow ? { id: ownerRow.id, fullName: ownerRow.fullName, email: ownerEmail, isActive: ownerRow.isActive } : null,
    ownerCount: owners.length,
    members: opts.withMembers ? sortManagementMembers(members) : [],
    activeSeats: members.filter((m) => m.isActive).length,
    notes: noteRows,
    provinces: (provinces.data ?? []) as { id: string; name: string }[],
  };
}
