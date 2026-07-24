import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { platformCanAccess, type PlatformModule, type PlatformRole } from "@/lib/platform-access";

export type { PlatformRole };

export type PlatformStaff = {
  id: string;
  email: string;
  full_name: string;
  role: PlatformRole;
  is_active: boolean;
};

function allowlist(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Ensure allowlisted emails are inserted into platform_staff on first access. */
async function bootstrapIfAllowed(userId: string, email: string, fullName: string) {
  const list = allowlist();
  if (!list.includes(email.toLowerCase())) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_staff")
    .upsert(
      {
        id: userId,
        email: email.toLowerCase(),
        full_name: fullName || email,
        role: "super_admin",
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("id, email, full_name, role, is_active")
    .single();

  if (error) {
    console.error("platform bootstrap", error);
    return null;
  }
  return data as PlatformStaff;
}

export const getPlatformStaff = cache(async (): Promise<PlatformStaff | null> => {
  const user = await getRequestUser();
  if (!user?.email) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_staff")
    .select("id, email, full_name, role, is_active")
    .eq("id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (data) return data as PlatformStaff;

  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email.split("@")[0] ??
    "Staff";
  return bootstrapIfAllowed(user.id, user.email, name);
});

export async function requirePlatformStaff(): Promise<PlatformStaff> {
  const staff = await getPlatformStaff();
  if (!staff) {
    const user = await getRequestUser();
    if (!user) redirect("/giris?next=/admin");
    redirect("/app");
  }
  return staff;
}

/**
 * Sayfa/aksiyon seviyesi departman yetkisi. Personel değilse `requirePlatformStaff`
 * gibi yönlendirir; modüle erişimi yoksa kendi dashboard'una (/admin) döner.
 */
export async function requirePlatformModule(module: PlatformModule): Promise<PlatformStaff> {
  const staff = await requirePlatformStaff();
  if (!platformCanAccess(staff.role, module)) {
    redirect("/admin");
  }
  return staff;
}
