import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_BUSINESS_DAYS, type BusinessDay } from "@/lib/support/business-hours";
import type { SlaPolicyRow } from "@/lib/support/sla-policy";

/**
 * Destek masası 2.0 veri okuyucuları (sunucu). Tablolar migration 20261013004800 ile gelir; tablo/kolon yokken
 * `installed: false` döner ve ekranlar "kurulum bekliyor" der, eski davranış sürer (asla hata fırlatmaz).
 * Çağıran, platform yetki kapısını (requirePlatformModule("tickets")) önceden uygulamış olmalıdır.
 */

export const SUPPORT_STAFF_ROLES = ["super_admin", "ops", "support", "billing"] as const;

export type DeskStaff = { id: string; full_name: string; role: string; is_active: boolean };
export type AssignmentRule = {
  id: string;
  category: string;
  target_role: string | null;
  target_staff_ids: string[];
  is_active: boolean;
  sort_order: number;
  last_assigned_staff_id: string | null;
  last_assigned_at: string | null;
  assigned_count: number;
};
export type StaffAvailability = { staff_id: string; is_away: boolean; away_until: string | null; note: string | null };
export type Holiday = { day: string; label: string };

export type DeskConfig = {
  installed: boolean;
  policies: SlaPolicyRow[];
  days: BusinessDay[];
  holidays: Holiday[];
  rules: AssignmentRule[];
  availability: StaffAvailability[];
  staff: DeskStaff[];
};

function missing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || /does not exist|schema cache/i.test(error.message ?? "");
}

export async function loadDeskConfig(): Promise<DeskConfig> {
  const admin = createAdminClient();
  const [policies, hours, holidays, rules, availability, staff] = await Promise.all([
    admin.from("support_sla_policies").select("plan, priority, first_response_minutes, resolution_minutes"),
    admin.from("support_business_hours").select("weekday, is_open, open_minute, close_minute").order("weekday"),
    admin.from("support_holidays").select("day, label").order("day"),
    admin
      .from("support_assignment_rules")
      .select("id, category, target_role, target_staff_ids, is_active, sort_order, last_assigned_staff_id, last_assigned_at, assigned_count")
      .order("sort_order")
      .order("created_at"),
    admin.from("support_staff_availability").select("staff_id, is_away, away_until, note"),
    admin.from("platform_staff").select("id, full_name, role, is_active").in("role", [...SUPPORT_STAFF_ROLES]).order("full_name"),
  ]);

  const installed = ![policies.error, hours.error, holidays.error, rules.error, availability.error].some(missing);
  for (const r of [policies, hours, holidays, rules, availability, staff]) {
    if (r.error && !missing(r.error)) console.error("support desk config", { code: r.error.code, message: r.error.message });
  }

  const dayRows = (hours.data ?? []) as { weekday: number; is_open: boolean; open_minute: number; close_minute: number }[];
  const days: BusinessDay[] = DEFAULT_BUSINESS_DAYS.map((d) => {
    const row = dayRows.find((r) => r.weekday === d.weekday);
    return row ? { weekday: d.weekday, isOpen: row.is_open, openMinute: row.open_minute, closeMinute: row.close_minute } : d;
  });

  return {
    installed,
    policies: (policies.data ?? []) as SlaPolicyRow[],
    days,
    holidays: (holidays.data ?? []) as Holiday[],
    rules: ((rules.data ?? []) as AssignmentRule[]).map((r) => ({ ...r, target_staff_ids: r.target_staff_ids ?? [] })),
    availability: (availability.data ?? []) as StaffAvailability[],
    staff: (staff.data ?? []) as DeskStaff[],
  };
}

export type MacroRecord = {
  id: string;
  title: string;
  body: string;
  actions_json: unknown;
  use_count: number;
  last_used_at: string | null;
};

/** Makrolar; actions_json/use_count kolonları yoksa (migration öncesi) yalnız başlık+metin döner. */
export async function loadMacros(): Promise<{ macros: MacroRecord[]; extended: boolean }> {
  const admin = createAdminClient();
  const full = await admin.from("ticket_macros").select("id, title, body, actions_json, use_count, last_used_at").order("title");
  if (!full.error) return { macros: (full.data ?? []) as MacroRecord[], extended: true };
  if (!missing(full.error)) throw new Error(`Hazır yanıtlar yüklenemedi: ${full.error.message}`);
  const basic = await admin.from("ticket_macros").select("id, title, body").order("title");
  if (basic.error) throw new Error(`Hazır yanıtlar yüklenemedi: ${basic.error.message}`);
  return {
    macros: (basic.data ?? []).map((m) => ({ ...m, actions_json: {}, use_count: 0, last_used_at: null })),
    extended: false,
  };
}

/** Biletin etiketleri; kolon yoksa null (etiket arayüzü gizlenir). */
export async function loadTicketTags(ticketId: string): Promise<string[] | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("support_tickets").select("tags").eq("id", ticketId).maybeSingle();
  if (error) {
    if (!missing(error)) console.error("ticket tags", { code: error.code });
    return null;
  }
  return ((data as { tags?: string[] | null } | null)?.tags ?? []) as string[];
}

export { missing as isMissingRelationError };
