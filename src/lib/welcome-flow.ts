/** Yeni danışman "Hoş geldin" akışı — saf karar mantığı (IO yok). */

/** Hesap bu süreden eskiyse akış gösterilmez (var olan danışmanlar rahatsız edilmez). */
export const WELCOME_WINDOW_DAYS = 30;

/**
 * Akış bitti/kapatıldı işareti — SUNUCUDA, kullanıcı başına (`profiles.ui_state`, yazma `profile_ui_state_mark` RPC'si;
 * cihazlar arası geçerli). Danışman masaüstünde bitirip telefondan girince akış yeniden çıkmaz (PUB-11).
 */
export const WELCOME_DONE_UI_KEY = "nudge:hosgeldin";

/** Profildeki arayüz durumunda "hoş geldin tamamlandı" işareti var mı. */
export function isWelcomeDone(state: Readonly<Record<string, string>> | null | undefined): boolean {
  return Boolean(state && typeof state[WELCOME_DONE_UI_KEY] === "string");
}

export const WELCOME_STEP_IDS = ["profil", "hedef", "musteri", "gorev"] as const;
export type WelcomeStepId = (typeof WELCOME_STEP_IDS)[number];

export type WelcomeDecisionInput = {
  role: string | null | undefined;
  /** Profil (`ui_state`) "tamamlandı/kapatıldı" diyor mu. */
  dismissed: boolean;
  /** profiles.created_at (ISO) — yoksa gösterilmez. */
  profileCreatedAt: string | null | undefined;
  nowMs: number;
};

export function shouldShowWelcome(i: WelcomeDecisionInput): boolean {
  if (i.role !== "advisor" || i.dismissed || !i.profileCreatedAt) return false;
  const created = Date.parse(i.profileCreatedAt);
  if (!Number.isFinite(created)) return false;
  const ageMs = i.nowMs - created;
  return ageMs >= 0 && ageMs <= WELCOME_WINDOW_DAYS * 86_400_000;
}
