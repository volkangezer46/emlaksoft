/**
 * Cevapsız çağrı → "Geri ara" görev döngüsünün SAF kuralları (DB'siz, test edilebilir).
 *
 * - Cevapsız çağrı kaydedilince numaraya bağlı bir "Geri ara" görevi açılır. Görev, notunun başındaki
 *   `[geri-ara:<saklanan numara>]` işaretiyle numaraya bağlanır (tasks tablosunda kaynak sütunu yok;
 *   ayrı migration gerektirmemek için not işareti kullanılır).
 * - Aynı numara için aynı TR gününde ikinci görev açılmaz; açık görev varsa da yenisi açılmaz.
 * - Aynı (normalize) numaraya giden arama kaydedilince açık geri arama görevi kendiliğinden tamamlanır.
 */

export const CALLBACK_MARK_PREFIX = "[geri-ara:";

/** Numaraya bağlı görev işareti — numara `parsePhoneStrict(...).stored` biçiminde olmalıdır. */
export function callbackMarker(storedPhone: string): string {
  return `${CALLBACK_MARK_PREFIX}${storedPhone}]`;
}

/** PostgREST `like` deseni: notu işaretle BAŞLAYAN görevler. */
export function callbackMarkerPattern(storedPhone: string): string {
  return `${callbackMarker(storedPhone)}%`;
}

export function callbackTaskTitle(customerName: string | null | undefined, phoneDisplay: string): string {
  const name = (customerName ?? "").trim();
  return name ? `Geri ara: ${name} (${phoneDisplay})` : `Geri ara: ${phoneDisplay}`;
}

export function callbackTaskNotes(storedPhone: string): string {
  return `${callbackMarker(storedPhone)} Cevapsız çağrı — numarayı geri arayın. Bu numaraya giden arama kaydedildiğinde görev kendiliğinden tamamlanır.`;
}

/**
 * Görev kime atanır: müşterinin danışmanı → yoksa kaydı giren kullanıcı → yoksa ofis varsayılanı (verilirse).
 * Ofiste ayrı bir "varsayılan danışman" ayarı bugün yok; parametre ileride bağlanabilsin diye açık.
 */
export function pickCallbackAssignee(input: {
  customerAdvisorId?: string | null;
  actorId?: string | null;
  officeDefaultId?: string | null;
}): string | null {
  return input.customerAdvisorId || input.actorId || input.officeDefaultId || null;
}

export type CallLite = { id: string; direction: string; phone: string; started_at: string };

/**
 * "Geri aranmayan" cevapsız çağrılar: kendisinden SONRA aynı numaraya giden (outbound) arama
 * kaydı olmayan cevapsız çağrılar. Aynı numaranın birden çok cevapsız çağrısı varsa tek bir giden
 * arama, kendisinden önceki tümünü kapatır. Sıra korunur.
 */
export function unreturnedMissedCalls<T extends CallLite>(calls: readonly T[]): T[] {
  const lastOutbound = new Map<string, number>();
  for (const c of calls) {
    if (c.direction !== "outbound") continue;
    const t = Date.parse(c.started_at);
    if (!Number.isFinite(t)) continue;
    const prev = lastOutbound.get(c.phone);
    if (prev === undefined || t > prev) lastOutbound.set(c.phone, t);
  }
  return calls.filter((c) => {
    if (c.direction !== "missed") return false;
    const out = lastOutbound.get(c.phone);
    if (out === undefined) return true;
    const t = Date.parse(c.started_at);
    return !(Number.isFinite(t) && out >= t);
  });
}
