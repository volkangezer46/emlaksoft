/**
 * Yetki / EİDS durumu (SAF). "Yetki alındı" adımı yetkilendirme sözleşmesi tarihini ve süresini durum notuna yazar
 * (`Yetkilendirme sözleşmesi: GG.AA.YYYY, N ay.`); ayrı kolon yoktur. Bu yardımcı notu geri okur ve bitişi hesaplar.
 * Uyarı verir, ENGELLEMEZ (süre 3 ayı aşarsa, bitiş yakınsa).
 */
const NOTE_RE = /Yetkilendirme sözleşmesi:\s*(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{1,2})\s*ay/;
const DAY_MS = 86_400_000;

export type AuthorizationInfo = {
  /** Sözleşme tarihi (YYYY-MM-DD). */
  signedOn: string;
  months: number;
  /** Bitiş tarihi (YYYY-MM-DD). */
  endsOn: string;
  /** Bitişe kalan gün (negatif: süresi geçti). */
  daysLeft: number;
  overLegalMax: boolean;
  state: "active" | "expiring" | "expired";
};

export function parseAuthorizationNote(note: string | null | undefined): { signedOn: string; months: number } | null {
  const m = NOTE_RE.exec(note ?? "");
  if (!m) return null;
  const [, dd, mm, yyyy, months] = m;
  const day = Number(dd);
  const mon = Number(mm);
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
  return { signedOn: `${yyyy}-${mm}-${dd}`, months: Number(months) };
}

function addMonthsUtc(isoDate: string, months: number): number {
  const [y, mo, d] = isoDate.split("-").map(Number);
  const total = mo - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(d, last));
}

/** @param todayMs İstanbul gün başlangıcı (saat bileşeni kullanılmaz; `trDayStartMs`) — çağıran verir. */
export function evaluateAuthorization(note: string | null | undefined, todayDayKey: string): AuthorizationInfo | null {
  const parsed = parseAuthorizationNote(note);
  if (!parsed) return null;
  const endMs = addMonthsUtc(parsed.signedOn, parsed.months);
  const [ty, tm, td] = todayDayKey.split("-").map(Number);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  const daysLeft = Math.round((endMs - todayUtc) / DAY_MS);
  return {
    signedOn: parsed.signedOn,
    months: parsed.months,
    endsOn: new Date(endMs).toISOString().slice(0, 10),
    daysLeft,
    overLegalMax: parsed.months > 3,
    state: daysLeft < 0 ? "expired" : daysLeft <= 14 ? "expiring" : "active",
  };
}
