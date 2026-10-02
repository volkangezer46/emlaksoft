import { createAdminClient } from "@/lib/supabase/admin";
import type { PlatformRole } from "@/lib/platform-access";

export type PlatformNotifyInput = {
  title: string;
  body?: string;
  href?: string;
  kind?: "info" | "success" | "warning" | "danger" | "system";
  meta?: Record<string, unknown>;
  /** Belirli bir personele gönder; verilmezse tüm aktif personele fan-out edilir. */
  staffId?: string;
  /** Fan-out yapılırken yalnız bu platform rollerini hedefle. */
  roles?: PlatformRole[];
};

/** Platform personeline bildirim yazar (service role — RLS bypass). */
export async function notifyPlatformStaff(input: PlatformNotifyInput): Promise<void> {
  try {
    const admin = createAdminClient();
    let targets: string[];
    if (input.staffId) {
      let direct = admin
        .from("platform_staff")
        .select("id")
        .eq("id", input.staffId)
        .eq("is_active", true);
      if (input.roles?.length) direct = direct.in("role", input.roles);
      const { data, error } = await direct.maybeSingle();
      if (error) {
        console.error("notifyPlatformStaff: direct target lookup failed", { code: error.code });
        return;
      }

      if (data) {
        targets = [data.id];
      } else if (input.roles?.length) {
        const { data: fallback, error: fallbackError } = await admin
          .from("platform_staff")
          .select("id")
          .eq("is_active", true)
          .in("role", input.roles);
        if (fallbackError) {
          console.error("notifyPlatformStaff: fallback target lookup failed", { code: fallbackError.code });
          return;
        }
        targets = (fallback ?? []).map((staff) => staff.id);
      } else {
        targets = [];
      }
    } else {
      let query = admin.from("platform_staff").select("id").eq("is_active", true);
      if (input.roles?.length) query = query.in("role", input.roles);
      const { data, error } = await query;
      if (error) {
        console.error("notifyPlatformStaff: target lookup failed", { code: error.code });
        return;
      }
      targets = (data ?? []).map((s) => s.id);
    }
    targets = [...new Set(targets)];
    if (targets.length === 0) return;

    const { error: insertError } = await admin.from("platform_notifications").insert(
      targets.map((id) => ({
        staff_id: id,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        kind: input.kind ?? "info",
        meta: input.meta ?? {},
      })),
    );
    if (insertError) {
      console.error("notifyPlatformStaff: notification insert failed", { code: insertError.code });
    }
  } catch (e) {
    console.error("notifyPlatformStaff", e);
  }
}
