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

/** Personelin özel rolü (ad + temel rol); atanmamışsa ya da şema yoksa null. */
async function readCustomRole(admin: ReturnType<typeof createAdminClient>, id: string): Promise<{ id: string; label: string; base_role: string } | null> {
  const { data: row } = await admin.from("platform_staff").select("custom_role_id").eq("id", id).maybeSingle();
  const roleId = (row?.custom_role_id as string | null | undefined) ?? null;
  if (!roleId) return null;
  const { data: role } = await admin.from("platform_custom_roles").select("id, label, base_role").eq("id", roleId).maybeSingle();
  return role ? { id: role.id as string, label: role.label as string, base_role: role.base_role as string } : null;
}

export async function GET(req: Request) {
  const staff = await getPlatformStaff();
  if (!staff || !platformCanAccess(staff, "personel")) {
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

    // Zorunlu parola değişimi bekliyor mu (auth user_metadata). Okunamazsa false: yalnız bilgi amaçlı.
    const authUser = await admin.auth.admin.getUserById(id).then((r) => r.data?.user ?? null).catch(() => null);
    const mustChangePassword = authUser?.user_metadata?.must_change_password === true;
    // DG1 özel rol: atanmışsa adı gösterilir (sütun/tablo yoksa hata yutulur, sabit rol görünür).
    const customRole = await readCustomRole(admin, id);

    return NextResponse.json({
      member: { ...member, last_sign_in_at: logins.get(id) ?? null, must_change_password: mustChangePassword, custom_role: customRole },
      activity,
    });
  }

  const [{ data, error }, logins] = await Promise.all([
    admin.from("platform_staff").select(STAFF_COLS).order("created_at", { ascending: true }),
    lastSignIns(admin),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Avatar alanları ayrı ve hata-toleranslı okunur (sütun yoksa liste yine çalışır).
  const avatars = new Map<string, { avatar_url: string | null; avatar_preset: string | null }>();
  try {
    const { data: av } = await admin.from("platform_staff").select("id, avatar_url, avatar_preset");
    for (const r of av ?? []) avatars.set(r.id as string, { avatar_url: r.avatar_url ?? null, avatar_preset: r.avatar_preset ?? null });
  } catch {
    /* avatar süs */
  }
  // DG1 özel rol ataması: sütun yokken (migration öncesi) hata yutulur, herkes sabit rolüyle listelenir.
  const customRoles = new Map<string, string | null>();
  const { data: cr } = await admin.from("platform_staff").select("id, custom_role_id");
  for (const r of cr ?? []) customRoles.set(r.id as string, (r.custom_role_id as string | null) ?? null);
  return NextResponse.json(
    (data ?? []).map((m) => ({
      ...m,
      last_sign_in_at: logins.get(m.id) ?? null,
      avatar_url: avatars.get(m.id)?.avatar_url ?? null,
      avatar_preset: avatars.get(m.id)?.avatar_preset ?? null,
      custom_role_id: customRoles.get(m.id) ?? null,
    })),
  );
}
