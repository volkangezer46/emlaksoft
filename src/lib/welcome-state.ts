import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { welcomeDoneCookieName } from "@/lib/setup-skip";
import { shouldShowWelcome } from "@/lib/welcome-flow";

/**
 * Ana ekran kapısı: yeni danışman ilk girişinde "Hoş geldin" akışına yönlenir. Tercih kullanıcı
 * çerezidir (yeni şema yok); yalnız danışman rolü ve son 30 günde açılmış hesap için true döner.
 * Sorgu hatasında false (akış gösterilmez, ana ekran bozulmaz).
 */
export async function loadShouldShowWelcome(userId: string, role: string): Promise<boolean> {
  if (role !== "advisor") return false;
  const jar = await cookies();
  if (jar.get(welcomeDoneCookieName(userId))?.value === "1") return false;
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("created_at").eq("id", userId).maybeSingle();
  if (error) return false;
  return shouldShowWelcome({
    role,
    dismissed: false,
    profileCreatedAt: (data as { created_at: string | null } | null)?.created_at,
    nowMs: now(),
  });
}
