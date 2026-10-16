import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { now, trDayKey, trDayStartMs } from "@/lib/clock";
import { greetingNameOf } from "@/lib/greeting-name";
import { HosgeldinAkisi } from "./hosgeldin-akisi";
import { SahipKarsilama } from "./sahip-karsilama";

export const metadata = { title: "Hoş geldiniz" };

/**
 * İlk karşılama (tek sayfa, iki rol):
 *  - Ofis sahibi (plan C27): kısa karşılama + 4 adımlı kurulumun tanıtımı, tek "Kuruluma başla" düğmesi. Yeni ofiste ana
 *    ekran ilk girişte bir kez buraya getirir; tamamlanma profilde tutulur.
 *  - Yeni danışman: profil, hedef, ilk müşteri, bugünkü görevler (4 kısa adım, sayfa içi). Tamamlanınca ya da kapatılınca
 *    ana ekran bir daha buraya yönlendirmez.
 * Diğer roller için karşılama yoktur: ana ekrana döner.
 */
export default async function HosGeldinPage() {
  const { tenantId, userId, role, perms } = await requireModulePage("dashboard");
  if (!tenantId || (role !== "advisor" && role !== "owner")) redirect("/app");

  const supabase = await createClient();
  if (role === "owner") {
    const [profileRes, tenantRes] = await Promise.all([
      supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    ]);
    return (
      <div className="mx-auto w-full max-w-2xl">
        <SahipKarsilama
          firstName={greetingNameOf((profileRes.data as { full_name: string | null } | null)?.full_name) ?? ""}
          officeName={(tenantRes.data as { name: string | null } | null)?.name ?? null}
        />
      </div>
    );
  }

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
        firstName={greetingNameOf(profile?.full_name) ?? ""}
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
