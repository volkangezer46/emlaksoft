/**
 * /sor tam sayfa sohbetinin İSTEMCİ yardımcısı (SAF, bağımlılıksız; zeka-panel ile iner).
 */

/**
 * Açılış sorusunu YALNIZ BİR KEZ gönderir: `once` bileşen ömrü boyunca yaşayan bir ref'tir (Strict Mode'un çift etki
 * çağrısı, yeniden çizim ve `ask` kimliğinin değişmesi soruyu tekrar göndermez). Gönderdiyse true döner.
 */
export function autoAskOnce(once: { current: boolean }, question: string | null | undefined, ask: (q: string) => void): boolean {
  if (once.current || !question) return false;
  once.current = true;
  ask(question);
  return true;
}
