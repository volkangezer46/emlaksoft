/**
 * Kiracı "Ödedim" bildirimi -> banka ekstresi satırı eşleştirme (SAF; DB/saat yok).
 * Kural: giriş satırı + TUTAR aynı (kuruşa kadar) + satır tarihi bildirimden en fazla 3 gün önce / 14 gün sonra.
 * Birden çok aday varsa bildirim gününe en yakın olan; açıklamada kiracının yazdığı dekont/işlem no geçiyorsa güven yüksek.
 * Sonuç yalnız ÖNERİDİR: kayıt, danışman "Teyit et" deyince oluşur.
 */
import { dayNumber } from "@/lib/finance/statement/match";
import { foldHeader } from "@/lib/finance/statement/parse";

export type NoticeForMatch = { amount: number; createdDay: string; reference: string | null };
export type StatementLineForMatch = { id: string; date: string; amount: number; description: string };
export type NoticeMatch = { line: StatementLineForMatch; confidence: "high" | "medium" };

const BEFORE_DAYS = 3;
const AFTER_DAYS = 14;

export function findStatementMatch(notice: NoticeForMatch, lines: readonly StatementLineForMatch[]): NoticeMatch | null {
  const cents = Math.round(notice.amount * 100);
  const base = dayNumber(notice.createdDay);
  const ref = notice.reference ? foldHeader(notice.reference) : "";
  let best: { line: StatementLineForMatch; gap: number; refHit: boolean } | null = null;
  for (const line of lines) {
    if (Math.round(line.amount * 100) !== cents) continue;
    const delta = dayNumber(line.date) - base;
    if (delta < -BEFORE_DAYS || delta > AFTER_DAYS) continue;
    const refHit = ref.length >= 3 && foldHeader(line.description).includes(ref);
    const gap = Math.abs(delta);
    if (!best || (refHit && !best.refHit) || (refHit === best.refHit && gap < best.gap)) best = { line, gap, refHit };
  }
  if (!best) return null;
  return { line: best.line, confidence: best.refHit || best.gap <= 3 ? "high" : "medium" };
}
