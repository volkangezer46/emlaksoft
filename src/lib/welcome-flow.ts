/** Yeni danışman "Hoş geldin" akışı — saf karar mantığı (IO yok). */

/** Hesap bu süreden eskiyse akış gösterilmez (var olan danışmanlar rahatsız edilmez). */
export const WELCOME_WINDOW_DAYS = 30;

export const WELCOME_STEP_IDS = ["profil", "hedef", "musteri", "gorev"] as const;
export type WelcomeStepId = (typeof WELCOME_STEP_IDS)[number];

export type WelcomeDecisionInput = {
  role: string | null | undefined;
  /** Kullanıcı çerezi "tamamlandı/kapatıldı" diyor mu. */
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
