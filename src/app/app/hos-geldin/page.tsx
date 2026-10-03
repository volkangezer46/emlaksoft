import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { now, trDayKey, trDayStartMs } from "@/lib/clock";
import { HosgeldinAkisi } from "./hosgeldin-akisi";

export const metadata = { title: "Hoş geldiniz" };

/**
 * Yeni danışman başlangıç akışı: profil, hedef, ilk müşteri, bugünkü görevler (4 kısa adım).
 * Sayfa içi adımlar (popup değil). Tercih kullanıcı çerezidir; tamamlanınca ya da kapatılınca
 * ana ekran bir daha buraya yönlendirmez. Ofis sahibi/yönetici için akış yoktur: Ana ekrana döner.
 */
export default async function HosGeldinPage() {
  const { tenantId, userId, role, perms } = await requireModulePage("dashboard");
  if (!tenantId || role !== "advisor") redirect("/app");

  const supabase = await createClient();
  const monthStart = `${trDayKey(now()).slice(0, 7)}-01`;
  const dayEndIso = new Date(trDayStartMs(now()) + 86_400_000).toISOString();
  const [profileRes, targetRes, tasksRes, customersRes] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, photo_url").eq("id", userId).maybeSingle(),
    supabase
      .from("targets")
      .select("target_deals, target_revenue")
      .eq("profile_id", userId)
      .eq("period", "monthly")
      .eq("period_start", monthStart)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id, title, due_at", { count: "exact" })
      .eq("assigned_to", userId)
      .eq("status", "open")
      .lt("due_at", dayEndIso)
      .order("due_at", { ascending: true })
      .limit(5),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("assigned_to", userId).eq("is_sample", false).is("deleted_at", null),
  ]);

  const profile = profileRes.data as { full_name: string | null; phone: string | null; photo_url: string | null } | null;
  const target = targetRes.data as { target_deals: number | null; target_revenue: number | string | null } | null;
  const tasks = (tasksRes.data ?? []) as { id: string; title: string; due_at: string | null }[];

  return (
    <div className="mx-auto w-full max-w-2xl">
      <HosgeldinAkisi
        firstName={(profile?.full_name ?? "").split(" ")[0] || ""}
        phone={profile?.phone ?? ""}
        photoUrl={profile?.photo_url ?? null}
        canUploadPhoto={effectiveHasPermission(perms, "team", "view")}
        target={target ? { deals: Number(target.target_deals ?? 0), revenue: Number(target.target_revenue ?? 0) } : null}
        canSeeTargets={effectiveHasPermission(perms, "targets", "view")}
        customers={customersRes.count ?? 0}
        tasks={tasks}
        taskCount={tasksRes.count ?? tasks.length}
      />
    </div>
  );
}
