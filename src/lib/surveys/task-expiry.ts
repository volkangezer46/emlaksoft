/**
 * Anketor gorevi token'inin gecerlilik suresi. Gorev token'i herkese acik bir baglanti oldugu icin sonsuza dek
 * cevap almaz: `due_at` + SURVEY_TASK_LINK_VALID_DAYS gunden sonra baglanti kapanir (sayfa ve action ayni kurali kullanir).
 */
export const SURVEY_TASK_LINK_VALID_DAYS = 30;

/** SAF: gorev baglantisi suresi doldu mu? `due_at` yoksa/bozuksa sure SINIRI uygulanamaz (false). */
export function isSurveyTaskLinkExpired(
  dueAt: string | null | undefined,
  nowMs: number,
  validDays: number = SURVEY_TASK_LINK_VALID_DAYS,
): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(due)) return false;
  return nowMs > due + validDays * 86_400_000;
}
