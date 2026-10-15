import "server-only";
import { getRequestIdentity } from "@/lib/cache/request";
import { now } from "@/lib/clock";
import { readOwnUiState } from "@/lib/ui-state-server";
import { isWelcomeDone, shouldShowWelcome } from "@/lib/welcome-flow";

/**
 * Ana ekran kapısı: yeni danışman ilk girişinde "Hoş geldin" akışına yönlenir. Tamamlanma SUNUCUDA, kullanıcı başına
 * tutulur (`profiles.ui_state` → `WELCOME_DONE_UI_KEY`; cihazlar arası). Yalnız danışman rolü ve son 30 günde açılmış
 * hesap için profil durumu okunur (eski hesaplarda ek sorgu yok). Sorgu hatasında false (akış gösterilmez, ana ekran bozulmaz).
 */
export async function loadShouldShowWelcome(userId: string, role: string): Promise<boolean> {
  if (role !== "advisor") return false;
  // Profil satırı istek-içi tek kimlik okumasından (ek sorgu yok).
  const { data, error } = await getRequestIdentity(userId);
  if (error) return false;
  const eligible = shouldShowWelcome({ role, dismissed: false, profileCreatedAt: data?.created_at, nowMs: now() });
  if (!eligible) return false;
  const state = await readOwnUiState(userId);
  // Okunamayan durum = gösterme (sahte "yeni" uydurulmaz, kullanıcı tekrar tekrar akışa düşmez).
  if (!state) return false;
  return !isWelcomeDone(state);
}
