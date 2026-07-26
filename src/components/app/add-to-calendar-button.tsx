"use client";

import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown, Download } from "lucide-react";
import { googleCalendarAddUrl, outlookCalendarAddUrl, generateICS, type CalendarEvent } from "@/lib/calendar";

/**
 * Randevu için "Takvime Ekle" dropdown butonu.
 * Google Calendar, Outlook Web ve ICS (evrensel) seçenekleri sunar.
 * OAuth gerektirmez — hepsi public URL veya client-side dosya indirmesi.
 */
export function AddToCalendarButton({ event }: { event: CalendarEvent }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Dışarı tıklanınca kapat
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function downloadICS() {
    const ics  = generateICS(event);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `randevu-${event.uid.slice(0, 8)}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Calendar className="h-3.5 w-3.5" />
        Takvime ekle
        <ChevronDown className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-[12px] border border-line bg-surface shadow-[var(--shadow-lg)]">
          {/* Google Calendar */}
          <a
            href={googleCalendarAddUrl(event)}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink-950 transition hover:bg-canvas"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google Calendar
          </a>

          {/* Outlook */}
          <a
            href={outlookCalendarAddUrl(event)}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink-950 transition hover:bg-canvas"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
              <path fill="#0078D4" d="M7 6C4.79 6 3 7.79 3 10v8c0 2.21 1.79 4 4 4h10c2.21 0 4-1.79 4-4v-8c0-2.21-1.79-4-4-4H7zm0 2h10c.53 0 1.04.21 1.41.59L12 12.5 5.59 8.59C5.96 8.21 6.47 8 7 8zm-2 2.87 6.44 4.09c.34.21.78.21 1.12 0L19 10.87V18c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2v-7.13z"/>
            </svg>
            Outlook Takvimi
          </a>

          <div className="my-1 border-t border-line" />

          {/* ICS İndir */}
          <button
            type="button"
            onClick={downloadICS}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-ink-950 transition hover:bg-canvas"
          >
            <Download className="h-4 w-4 shrink-0 text-text-muted" />
            ICS dosyası indir
            <span className="ml-auto text-[11px] text-text-faint">Apple, diğer</span>
          </button>
        </div>
      )}
    </div>
  );
}
