import type { SupabaseClient } from "@supabase/supabase-js";
import type { EffectivePermissions } from "@/lib/permissions-effective";

/** Sekme bileşenlerine geçen istek bağlamı (sunucu). */
export type TabContext = {
  tenantId: string;
  userId: string;
  role: string;
  perms: EffectivePermissions;
  /** office_center edit: atama/iptal, rol/şube/takım, pasife alma. */
  canEdit: boolean;
  /** office_center create: danışman daveti. */
  canCreate: boolean;
  /** settings edit: ayar/tanım yazımı (ayar modülü tek kapı). */
  canEditSettings: boolean;
  sp: Record<string, string | string[] | undefined>;
  nowMs: number;
  supabase: SupabaseClient;
};

export const dtf = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });
export const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
