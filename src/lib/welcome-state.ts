import "server-only";
import { cookies } from "next/headers";
import { getRequestIdentity } from "@/lib/cache/request";
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
  // Profil satırı istek-içi tek kimlik okumasından (ek sorgu yok).
  const { data, error } = await getRequestIdentity(userId);
  if (error) return false;
  return shouldShowWelcome({
    role,
    dismissed: false,
    profileCreatedAt: data?.created_at,
    nowMs: now(),
  });
}
