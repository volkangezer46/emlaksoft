import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { getProvinceOptions } from "@/lib/geo/reader";
import { MANAGER_ROLES } from "@/lib/team/assignable-roles";
import { FsboForm } from "./fsbo-form";

export const metadata = { title: "Sahibinden ilan ekle" };

export default async function NewFsboPage() {
  const ctx = await requireModulePage("prospecting", "/app/portfoy-avi");
  if (!(ctx.perms.prospecting ?? []).includes("create")) redirect("/app/portfoy-avi");
  const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.role);
  const supabase = await createClient();
  const [provinces, members] = await Promise.all([
    getProvinceOptions(),
    isManager ? supabase.from("profiles").select("id, full_name, role").eq("tenant_id", ctx.tenantId).eq("is_active", true).order("full_name").limit(200) : Promise.resolve({ data: [] }),
  ]);
  const people = ((members.data ?? []) as { id: string; full_name: string | null; role: string | null }[]).map((m) => ({ id: m.id, name: m.full_name, hint: m.role }));
  return <FsboForm provinces={provinces} people={people} isManager={isManager} />;
}
