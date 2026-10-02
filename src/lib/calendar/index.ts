/**
 * Takvim entegrasyon kütüphanesi
 *
 * Üç yöntem desteklenir:
 * 1. ICS dosyası — evrensel, tüm takvim uygulamaları (Google, Outlook, Apple)
 * 2. Google Calendar API — OAuth2 ile doğrudan ekleme
 * 3. Outlook Calendar API (Microsoft Graph) — OAuth2 ile doğrudan ekleme
 *
 * OAuth tokenları platform_settings'te tenant bazlı saklanır.
 */

import {
  discardExternalResponse,
  fetchExternal,
  readExternalJson,
} from "@/lib/external-fetch";

const CALENDAR_TIMEOUT_MS = 15_000;
const CALENDAR_MAX_RESPONSE_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// ICS (iCalendar) format üreticisi
// ---------------------------------------------------------------------------

export type CalendarEvent = {
  uid:          string;
  title:        string;
  description?: string;
  location?:    string;
  startAt:      Date;
  endAt?:       Date;   // yoksa startAt + 1 saat
  organizer?:   { name: string; email: string };
  attendees?:   { name: string; email: string }[];
  url?:         string;
};

/**
 * CalendarEvent → ICS string (RFC 5545 uyumlu)
 * Tarayıcıda veya sunucuda çalışır.
 */
export function generateICS(event: CalendarEvent): string {
  const end = event.endAt ?? new Date(event.startAt.getTime() + 3_600_000);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EmlakSoft//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}@emlaksoft`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(event.startAt)}`,
    `DTEND:${formatICSDate(end)}`,
    `SUMMARY:${escapeICS(event.title)}`,
  ];

  if (event.description) lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
  if (event.location)    lines.push(`LOCATION:${escapeICS(event.location)}`);
  if (event.url)         lines.push(`URL:${event.url}`);

  if (event.organizer) {
    lines.push(`ORGANIZER;CN=${event.organizer.name}:mailto:${event.organizer.email}`);
  }

  for (const att of event.attendees ?? []) {
    lines.push(`ATTENDEE;CN=${att.name}:mailto:${att.email}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

/** ICS için "YYYYMMDDTHHMMSSZ" formatı */
function formatICSDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeICS(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// ---------------------------------------------------------------------------
// Google Calendar API (OAuth2 — sunucu tarafı)
// ---------------------------------------------------------------------------

export type GoogleCalendarConfig = {
  accessToken: string;
  calendarId?: string; // varsayılan "primary"
  signal?: AbortSignal;
};

export type CalendarSyncResult = {
  ok:       boolean;
  eventId?: string;
  htmlLink?: string;
  error?:   string;
};

/**
 * Google Calendar'a etkinlik ekler.
 * accessToken: OAuth2 access token (kısa ömürlü)
 */
export async function addToGoogleCalendar(
  event: CalendarEvent,
  cfg: GoogleCalendarConfig,
): Promise<CalendarSyncResult> {
  const calId = encodeURIComponent(cfg.calendarId ?? "primary");
  const end   = event.endAt ?? new Date(event.startAt.getTime() + 3_600_000);

  const body = {
    summary:     event.title,
    description: event.description,
    location:    event.location,
    start: { dateTime: event.startAt.toISOString(), timeZone: "Europe/Istanbul" },
    end:   { dateTime: end.toISOString(),            timeZone: "Europe/Istanbul" },
    attendees: event.attendees?.map((a) => ({ email: a.email, displayName: a.name })),
    source:    event.url ? { url: event.url, title: "EmlakSoft" } : undefined,
  };

  try {
    const res = await fetchExternal(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          Authorization:   `Bearer ${cfg.accessToken}`,
        },
        body: JSON.stringify(body),
      },
      { timeoutMs: CALENDAR_TIMEOUT_MS, signal: cfg.signal },
    );

    if (!res.ok) {
      await discardExternalResponse(res);
      return { ok: false, error: `Takvim sağlayıcısı isteği başarısız oldu (HTTP ${res.status}).` };
    }

    const data = await readExternalJson<{ id?: string; htmlLink?: string }>(
      res,
      CALENDAR_MAX_RESPONSE_BYTES,
    );
    return { ok: true, eventId: data.id, htmlLink: data.htmlLink };
  } catch {
    return { ok: false, error: "Takvim sağlayıcısına bağlanılamadı." };
  }
}

export async function deleteFromGoogleCalendar(
  eventId: string,
  cfg: GoogleCalendarConfig,
): Promise<CalendarSyncResult> {
  const calId = encodeURIComponent(cfg.calendarId ?? "primary");
  const encodedEventId = encodeURIComponent(eventId);
  try {
    const res = await fetchExternal(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${encodedEventId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
      },
      { timeoutMs: CALENDAR_TIMEOUT_MS, signal: cfg.signal },
    );
    const ok = res.ok || res.status === 410; // 410 = already deleted
    await discardExternalResponse(res);
    return ok
      ? { ok: true }
      : { ok: false, error: `Takvim sağlayıcısı isteği başarısız oldu (HTTP ${res.status}).` };
  } catch {
    return { ok: false, error: "Takvim sağlayıcısına bağlanılamadı." };
  }
}

// ---------------------------------------------------------------------------
// Microsoft Outlook / Graph API (OAuth2 — sunucu tarafı)
// ---------------------------------------------------------------------------

export type OutlookCalendarConfig = {
  accessToken: string;
  signal?: AbortSignal;
};

export async function addToOutlookCalendar(
  event: CalendarEvent,
  cfg: OutlookCalendarConfig,
): Promise<CalendarSyncResult> {
  const end = event.endAt ?? new Date(event.startAt.getTime() + 3_600_000);

  const body = {
    subject:      event.title,
    body:         { contentType: "text", content: event.description ?? "" },
    start:        { dateTime: event.startAt.toISOString(), timeZone: "Europe/Istanbul" },
    end:          { dateTime: end.toISOString(),            timeZone: "Europe/Istanbul" },
    location:     event.location ? { displayName: event.location } : undefined,
    attendees:    event.attendees?.map((a) => ({
                    emailAddress: { address: a.email, name: a.name },
                    type: "required",
                  })),
  };

  try {
    const res = await fetchExternal("https://graph.microsoft.com/v1.0/me/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${cfg.accessToken}`,
      },
      body: JSON.stringify(body),
    }, { timeoutMs: CALENDAR_TIMEOUT_MS, signal: cfg.signal });

    if (!res.ok) {
      await discardExternalResponse(res);
      return { ok: false, error: `Takvim sağlayıcısı isteği başarısız oldu (HTTP ${res.status}).` };
    }

    const data = await readExternalJson<{ id?: string; webLink?: string }>(
      res,
      CALENDAR_MAX_RESPONSE_BYTES,
    );
    return { ok: true, eventId: data.id, htmlLink: data.webLink };
  } catch {
    return { ok: false, error: "Takvim sağlayıcısına bağlanılamadı." };
  }
}

// ---------------------------------------------------------------------------
// "Takvime Ekle" linkleri (OAuth gerektirmez)
// ---------------------------------------------------------------------------

/** Google Calendar "takvime ekle" URL'si (web arayüzü). */
export function googleCalendarAddUrl(event: CalendarEvent): string {
  const end = event.endAt ?? new Date(event.startAt.getTime() + 3_600_000);
  const params = new URLSearchParams({
    action:  "TEMPLATE",
    text:    event.title,
    dates:   `${formatICSDate(event.startAt)}/${formatICSDate(end)}`,
    details: event.description ?? "",
    location: event.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook Web "takvime ekle" URL'si. */
export function outlookCalendarAddUrl(event: CalendarEvent): string {
  const end = event.endAt ?? new Date(event.startAt.getTime() + 3_600_000);
  const params = new URLSearchParams({
    path:     "/calendar/action/compose",
    rru:      "addevent",
    subject:  event.title,
    startdt:  event.startAt.toISOString(),
    enddt:    end.toISOString(),
    body:     event.description ?? "",
    location: event.location ?? "",
  });
  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}
