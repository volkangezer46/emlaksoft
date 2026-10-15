/**
 * GA-06 ICS yardımcıları — SAF (RFC 5545). Takvim aboneliği (`/api/takvim/[token]`) ve tek etkinlik (`generateICS`)
 * aynı kaçış, tarih, satır katlama ve alarm kurallarını kullanır.
 *  - TEXT kaçışı: \ ; , ve satır sonu.
 *  - Satır katlama: 75 OKTET (UTF-8; Türkçe karakter 2 oktet) — devam satırı tek boşlukla başlar, çok baytlı karakter bölünmez.
 *  - VALARM: ACTION:DISPLAY + TRIGGER:-PT<n>M (iOS ve Outlook uygular; Google web abonelik alarmlarını yok sayabilir).
 *  - GEO:lat;lng (konum koordinatı biliniyorsa).
 */

export function escapeICS(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Date → "YYYYMMDDTHHMMSSZ" (UTC). */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

const encoder = new TextEncoder();

/** 75 oktet satır katlama (RFC 5545 §3.1); karakter sınırında böler. */
export function foldICSLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74; // devam satırı başındaki boşluk 1 oktet
    }
    current += ch;
    bytes += size;
  }
  if (current) parts.push(current);
  return parts.join("\r\n ");
}

export type IcsEventInput = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  geo?: { lat: number; lng: number } | null;
  status?: "TENTATIVE" | "CONFIRMED" | null;
  lastModified?: Date | null;
  /** Alarm(lar): başlangıçtan kaç dakika önce (0 = başlangıçta). */
  alarmMinutes?: readonly number[];
  dtstamp: Date;
};

function alarmLines(minutes: number, summary: string): string[] {
  const m = Math.max(0, Math.round(minutes));
  return [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeICS(summary)}`,
    m === 0 ? "TRIGGER:PT0M" : `TRIGGER:-PT${m}M`,
    "END:VALARM",
  ];
}

/** Tek VEVENT bloğunun satırları (katlanmış). */
export function icsEventLines(e: IcsEventInput): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(e.dtstamp)}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(e.end)}`,
    `SUMMARY:${escapeICS(e.summary)}`,
  ];
  if (e.location) lines.push(`LOCATION:${escapeICS(e.location)}`);
  if (e.geo && Number.isFinite(e.geo.lat) && Number.isFinite(e.geo.lng)) lines.push(`GEO:${e.geo.lat};${e.geo.lng}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeICS(e.description)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.lastModified) lines.push(`LAST-MODIFIED:${icsDate(e.lastModified)}`);
  if (e.status) lines.push(`STATUS:${e.status}`);
  for (const m of [...new Set(e.alarmMinutes ?? [])].sort((a, b) => b - a)) lines.push(...alarmLines(m, e.summary));
  lines.push("END:VEVENT");
  return lines.map(foldICSLine);
}

/** Varsayılan alarm: 30 dk önce; konumlu randevuda ek olarak 60 dk önce (yola çıkma payı). */
export function appointmentAlarmMinutes(hasPlace: boolean): number[] {
  return hasPlace ? [60, 30] : [30];
}
