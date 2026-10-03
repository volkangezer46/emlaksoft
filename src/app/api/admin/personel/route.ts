import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformStaff } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";

const STAFF_COLS = "id, email, full_name, role, is_active, created_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** auth.users son giriş zamanları (id -> ISO). Hata olursa boş harita: liste yine çalışır. */
async function lastSignIns(admin: ReturnType<typeof createAdminClient>): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of data?.users ?? []) map.set(u.id, u.last_sign_in_at ?? null);
  } catch {
    /* son giriş bilgisi opsiyonel */
  }
  return map;
}

export async function GET(req: Request) {
  const staff = await getPlatformStaff();
  if (!staff || !platformCanAccess(staff.role, "personel")) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 403 });
  }

  const admin = createAdminClient();
  const id = new URL(req.url).searchParams.get("id");

  // Detay: tek personel + aktivite (platform_audit_logs: hakkında yapılanlar + kendi yaptıkları)
  if (id) {
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Geçersiz kimlik" }, { status: 400 });
    const [{ data: member, error }, logins, about, by] = await Promise.all([
      admin.from("platform_staff").select(STAFF_COLS).eq("id", id).maybeSingle(),
      lastSignIns(admin),
      admin
        .from("platform_audit_logs")
        .select("id, action, entity_type, entity_id, actor_id, meta, created_at")
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("platform_audit_logs")
        .select("id, action, entity_type, entity_id, actor_id, meta, created_at")
        .eq("actor_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!member) return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 });

    const seen = new Set<string>();
    const activity = [...(about.data ?? []), ...(by.data ?? [])]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 40)
      .map((r) => ({ ...r, direction: r.actor_id === id ? "by" : "about" }));

    return NextResponse.json({ member: { ...member, last_sign_in_at: logins.get(id) ?? null }, activity });
  }

  const [{ data, error }, logins] = await Promise.all([
    admin.from("platform_staff").select(STAFF_COLS).order("created_at", { ascending: true }),
    lastSignIns(admin),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map((m) => ({ ...m, last_sign_in_at: logins.get(m.id) ?? null })));
}
