import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { TaskForm } from "./task-form";

export const metadata = { title: "Yeni görev" };

export default async function NewTaskPage() {
  const ctx = await requireModulePage("tasks");
  if (!(ctx.perms.tasks ?? []).includes("create")) redirect("/app/gorevler");

  const supabase = await createClient();
  const [{ data: members }, { data: customers }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("customers")
      .select("id, full_name")
      .eq("tenant_id", ctx.tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return <TaskForm members={members ?? []} customers={customers ?? []} userId={ctx.userId} />;
}
