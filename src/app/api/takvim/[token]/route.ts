import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/**
 * Kişisel takvim aboneliği (ICS feed) — GET /api/takvim/[token]
 *
 * Token'ı bilen takvim uygulaması (Google/Apple/Outlook) kullanıcının
 * randevularını `text/calendar` olarak çeker; uygulama düzenli aralıklarla
 * yeniden isteyip takvimi güncel tutar (abonelik). Auth YOK — profiles
 * tablosundaki `calendar_token` yeterli (randevu-teyit confirm_token deseni):
 * RLS anon'a açılmaz, sorgular service role ile yapılır.
 *
 * Kapsam: token sahibinin (assigned_to) iptal edilmemiş randevuları,
 * geçmiş 7 gün + gelecek 90 gün. İptal edilen randevu feed'den düşer —
 * takvim uygulaması bir sonraki senkronda etkinliği kendisi siler
 * (METHOD:CANCEL gerekmez).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const TYPE_LABEL: Record<string, string> = {
  showing: "Yer gösterme",
  office: "Ofis görüşmesi",
  valuation: "Değerleme",
  contract: "Sözleşme",
};

/** RFC 5545 TEXT kaçışı: ters bölü, noktalı virgül, virgül, satır sonu. */
function escapeICS(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Date → "YYYYMMDDTHHMMSSZ" (UTC). */
function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

type Rel = { full_name?: string; title?: string; property_code?: string; address_line?: string } | null;

function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // uuid olmayan girdi sorguya gitmeden 404 olsun (randevu-teyit deseni).
  if (!UUID_RE.test(token)) {
    return new Response("Not found", { status: 404 });
  }

  // Token tahmini / kaba kuvvet koruması — IP başına dakikada 30 istek
  // (takvim uygulamaları tipik olarak 15 dk - birkaç saatte bir çeker).
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`takvim-ics:${ip}`, { limit: 30, windowSec: 60 });
  if (!allowed) {
    return new Response("Too many requests", { status: 429 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, tenant_id, full_name")
    .eq("calendar_token", token)
    .maybeSingle();

  if (!profile) {
    return new Response("Not found", { status: 404 });
  }

  const nowMs = Date.now();
  const windowStart = new Date(nowMs - 7 * 86_400_000).toISOString();
  const windowEnd = new Date(nowMs + 90 * 86_400_000).toISOString();

  const { data: appts, error } = await admin
    .from("appointments")
    .select(
      "id, appointment_type, scheduled_at, duration_min, location, notes, status, updated_at, customer:customers(full_name), property:properties(title, property_code, address_line)",
    )
    .eq("tenant_id", profile.tenant_id)
    .eq("assigned_to", profile.id)
    .neq("status", "cancelled")
    .gte("scheduled_at", windowStart)
    .lte("scheduled_at", windowEnd)
    .order("scheduled_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("takvim ics feed", error);
    return new Response("Internal error", { status: 500 });
  }

  const dtstamp = icsDate(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EmlakSoft//Randevular//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeICS(`EmlakSoft Randevular — ${profile.full_name ?? ""}`.trim())}`,
    "X-WR-TIMEZONE:Europe/Istanbul",
    // Google Calendar yenileme aralığı ipucu
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const appt of appts ?? []) {
    const customer = rel(appt.customer as Rel | Rel[]);
    const property = rel(appt.property as Rel | Rel[]);
    const start = new Date(appt.scheduled_at);
    // Süre girilmemişse 60 dk varsay
    const end = new Date(start.getTime() + (appt.duration_min ?? 60) * 60_000);

    const typeLabel = TYPE_LABEL[appt.appointment_type] ?? appt.appointment_type;
    const summary = `${typeLabel} — ${customer?.full_name ?? "Müşteri belirtilmemiş"}`;
    // Konum: randevunun serbest metin konumu > portföy adresi > portföy başlığı
    const location = appt.location || property?.address_line || property?.title || property?.property_code || "";
    const descriptionParts = [
      property?.title || property?.property_code ? `Portföy: ${property?.title || property?.property_code}` : "",
      appt.notes ? `Not: ${appt.notes}` : "",
      `${APP_URL}/app/randevular`,
    ].filter(Boolean);

    lines.push(
      "BEGIN:VEVENT",
      `UID:${appt.id}@emlaksoft`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${escapeICS(summary)}`,
    );
    if (location) lines.push(`LOCATION:${escapeICS(location)}`);
    lines.push(`DESCRIPTION:${escapeICS(descriptionParts.join("\n"))}`);
    if (appt.updated_at) lines.push(`LAST-MODIFIED:${icsDate(new Date(appt.updated_at))}`);
    lines.push(`STATUS:${appt.status === "pending" ? "TENTATIVE" : "CONFIRMED"}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  // CRLF şart (RFC 5545) — 75 oktet katlama zorunlu değil, uygulanmıyor.
  const body = lines.join("\r\n") + "\r\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="emlaksoft-randevular.ics"',
      // Kişiye özel feed — paylaşımlı cache'lere girmesin
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
