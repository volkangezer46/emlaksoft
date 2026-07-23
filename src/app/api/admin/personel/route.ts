import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";

export async function GET() {
  const staff = await getPlatformStaff();
  if (!staff || !platformCanAccess(staff.role, "personel")) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_staff")
    .select("id, email, full_name, role, is_active, created_at")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
