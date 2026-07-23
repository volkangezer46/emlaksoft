import { createAdminClient } from "@/lib/supabase/admin";

export type PlatformNotifyInput = {
  title: string;
  body?: string;
  href?: string;
  kind?: "info" | "success" | "warning" | "danger" | "system";
  meta?: Record<string, unknown>;
  /** Belirli bir personele gönder; verilmezse tüm aktif personele fan-out edilir. */
  staffId?: string;
};

/** Platform personeline bildirim yazar (service role — RLS bypass). */
export async function notifyPlatformStaff(input: PlatformNotifyInput): Promise<void> {
  try {
    const admin = createAdminClient();
    let targets: string[];
    if (input.staffId) {
      targets = [input.staffId];
    } else {
      const { data } = await admin.from("platform_staff").select("id").eq("is_active", true);
      targets = (data ?? []).map((s) => s.id);
    }
    if (targets.length === 0) return;

    await admin.from("platform_notifications").insert(
      targets.map((id) => ({
        staff_id: id,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        kind: input.kind ?? "info",
        meta: input.meta ?? {},
      })),
    );
  } catch (e) {
    console.error("notifyPlatformStaff", e);
  }
}
