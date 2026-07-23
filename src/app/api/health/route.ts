import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const started = Date.now();
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("tenants").select("id").limit(1);
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      db: "up",
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: "down", error: e instanceof Error ? e.message : "unknown", ms: Date.now() - started },
      { status: 503 },
    );
  }
}
