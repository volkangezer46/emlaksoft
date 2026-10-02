import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeOfficeScore, loadOfficeScoreInputs } from "@/lib/office-score";
import { requireActiveTenant } from "@/lib/tenant-guard";

export async function GET() {
  const gate = await requireActiveTenant();
  if (!gate.ok) {
    return NextResponse.json({ error: "forbidden", detail: gate.error }, { status: 403 });
  }
  const supabase = await createClient();

  const [{ count: customers }, { count: properties }, { count: demands }, scoreInputs, { count: unread }] =
    await Promise.all([
      supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
      supabase.from("properties").select("id", { count: "exact", head: true }).is("deleted_at", null),
      supabase
        .from("customer_demands")
        .select("id", { count: "exact", head: true })
        .in("status", ["new", "active", "matched"]),
      loadOfficeScoreInputs(supabase),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
        .or(`user_id.eq.${gate.userId},user_id.is.null`),
    ]);

  const officeScore = computeOfficeScore(scoreInputs);
  return NextResponse.json({
    tenantId: gate.tenantId,
    counts: {
      customers: customers ?? 0,
      properties: properties ?? 0,
      demands: demands ?? 0,
      unreadNotifications: unread ?? 0,
    },
    officeScore,
    at: new Date().toISOString(),
  });
}
