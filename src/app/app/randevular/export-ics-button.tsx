"use client";

import { CalendarPlus } from "lucide-react";

/**
 * Toplu takvim aktarımı — mevcut filtre kapsamındaki randevuları tek
 * VCALENDAR (.ics) dosyası olarak indirir. `lib/calendar.generateICS`'in
 * (tekil, AddToCalendarButton) çoğul uyarlaması: aynı RFC 5545 kaçış ve
 * tarih biçimi, tek VCALENDAR içinde N adet VEVENT. En fazla 200 kayıt.
 */

export type IcsEvent = {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startAt: string;          // ISO — server→client sınırından string geçer
  durationMin?: number | null;
};

const MAX_EVENTS = 200;

function formatICSDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeICS(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function generateMultiICS(events: IcsEvent[]): string {
  const stamp = formatICSDate(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EmlakSoft//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const ev of events.slice(0, MAX_EVENTS)) {
    const start = new Date(ev.startAt);
    const end = new Date(start.getTime() + (ev.durationMin ? ev.durationMin * 60_000 : 3_600_000));
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}@emlaksoft`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatICSDate(start)}`,
      `DTEND:${formatICSDate(end)}`,
      `SUMMARY:${escapeICS(ev.title)}`,
    );
    if (ev.description) lines.push(`DESCRIPTION:${escapeICS(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escapeICS(ev.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function ExportIcsButton({ events }: { events: IcsEvent[] }) {
  if (events.length === 0) return null;

  function download() {
    const ics = generateMultiICS(events);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "randevular.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
      title={`Filtredeki ${Math.min(events.length, MAX_EVENTS)} randevuyu tek .ics dosyası olarak indirir`}
    >
      <CalendarPlus className="h-4 w-4" /> Takvime aktar (.ics)
    </button>
  );
}
