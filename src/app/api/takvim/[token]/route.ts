import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/base-url";
import { log } from "@/lib/log";
import { errorFields } from "@/lib/log-error";
import { appointmentAlarmMinutes, escapeICS, foldICSLine, icsEventLines } from "@/lib/calendar/ics-feed";
import { directionsHref } from "@/lib/route-plan";

/**
 * Kişisel takvim aboneliği (ICS feed) — GET /api/takvim/[token]
 *
 * Token'ı bilen takvim uygulaması (Google/Apple/Outlook) kullanıcının
 * randevularını `text/calendar` olarak çeker; uygulama düzenli aralıklarla
 * yeniden isteyip takvimi güncel tutar (abonelik). Auth YOK — `user_calendar_tokens`
 * tablosundaki token yeterli (randevu-teyit confirm_token deseni):
 * RLS anon'a açılmaz, sorgular service role ile yapılır.
 *
 * Kapsam: token sahibinin (assigned_to) iptal edilmemiş randevuları,
 * geçmiş 7 gün + gelecek 90 gün. İptal edilen randevu feed'den düşer —
 * takvim uygulaması bir sonraki senkronda etkinliği kendisi siler
 * (METHOD:CANCEL gerekmez).
 *
 * GA-06: her randevuda VALARM (30 dk önce; konumluysa ayrıca 60 dk önce), GEO (portföy koordinatı), URL (randevunun
 * kendisi) ve açıklamada yol tarifi bağlantısı. Vadesi pencere içindeki AÇIK görevler 15 dk'lık "Görev: …" etkinliği
 * olarak eklenir (10 dk önce alarm); `?gorevler=0` ile abonelik yalnız randevu taşır (abonelik kartındaki seçim).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const APP_URL = getBaseUrl();

const TYPE_LABEL = APPOINTMENT_TYPE_LABELS;

type OwnerRel = { id?: string; full_name?: string | null; is_active?: boolean; tenant_id?: string | null };

type Rel = { full_name?: string; title?: string; property_code?: string; address_line?: string; lat?: number | null; lng?: number | null } | null;

/** Görev etkinliğinin süresi (dk). */
const TASK_EVENT_MIN = 15;

function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // uuid olmayan girdi sorguya gitmeden 404 olsun (randevu-teyit deseni).
  if (!UUID_RE.test(token)) {
    return new Response("Not found", { status: 404 });
  }

  // Token tahmini / kaba kuvvet koruması — IP başına dakikada 30 istek
  // (takvim uygulamaları tipik olarak 15 dk - birkaç saatte bir çeker).
  const ip = await clientIp();
  const { allowed } = await checkRateLimit(`takvim-ics:${ip}`, { limit: 30, windowSec: 60, failurePolicy: "deny" });
  if (!allowed) {
    return new Response("Too many requests", { status: 429 });
  }

  const admin = createAdminClient();
  // Token ayrı tabloda (user_calendar_tokens); sahibi aktif kullanıcı ve ofis askıda/iptal değilse akış açılır.
  const { data: row } = await admin
    .from("user_calendar_tokens")
    .select(
      "user_id, tenant_id, profile:profiles!user_calendar_tokens_user_id_fkey(id, full_name, is_active, tenant_id), tenant:tenants!user_calendar_tokens_tenant_id_fkey(status)",
    )
    .eq("token", token)
    .maybeSingle();

  const owner = rel(row?.profile as OwnerRel | OwnerRel[] | null | undefined);
  const tenant = rel(row?.tenant as { status?: string } | { status?: string }[] | null | undefined);
  if (
    !row ||
    !owner ||
    owner.is_active !== true ||
    owner.tenant_id !== row.tenant_id ||
    !tenant ||
    tenant.status === "suspended" ||
    tenant.status === "cancelled"
  ) {
    return new Response("Not found", { status: 404 });
  }
  const profile = { id: row.user_id as string, tenant_id: row.tenant_id as string, full_name: owner.full_name ?? null };

  const nowMs = Date.now();
  const windowStart = new Date(nowMs - 7 * 86_400_000).toISOString();
  const windowEnd = new Date(nowMs + 90 * 86_400_000).toISOString();

  const includeTasks = new URL(req.url).searchParams.get("gorevler") !== "0";
  const [{ data: appts, error }, taskRes] = await Promise.all([
    admin
      .from("appointments")
      .select(
        "id, appointment_type, scheduled_at, duration_min, location, notes, status, updated_at, customer:customers!appointments_customer_id_fkey(full_name), property:properties!appointments_property_id_fkey(title, property_code, address_line, lat, lng)",
      )
      .eq("tenant_id", profile.tenant_id)
      .eq("assigned_to", profile.id)
      .neq("status", "cancelled")
      .gte("scheduled_at", windowStart)
      .lte("scheduled_at", windowEnd)
      .order("scheduled_at", { ascending: true })
      .limit(500),
    includeTasks
      ? admin
          .from("tasks")
          .select("id, title, notes, due_at, created_at, customer:customers!tasks_customer_id_fkey(full_name)")
          .eq("tenant_id", profile.tenant_id)
          .eq("assigned_to", profile.id)
          .eq("status", "open")
          .gte("due_at", windowStart)
          .lte("due_at", windowEnd)
          .order("due_at", { ascending: true })
          .limit(500)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  if (error) {
    log.error("takvim_ics_feed_failed", { route: "/api/takvim/[token]", ...errorFields(error) });
    return new Response("Internal error", { status: 500 });
  }

  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EmlakSoft//Randevular//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldICSLine(`X-WR-CALNAME:${escapeICS(`EmlakSoft Randevular — ${profile.full_name ?? ""}`.trim())}`),
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
    const geo = property?.lat != null && property?.lng != null ? { lat: property.lat, lng: property.lng } : null;
    const route = directionsHref({ lat: geo?.lat ?? null, lng: geo?.lng ?? null, location });
    const descriptionParts = [
      property?.title || property?.property_code ? `Portföy: ${property?.title || property?.property_code}` : "",
      appt.notes ? `Not: ${appt.notes}` : "",
      route ? `Yol tarifi: ${route}` : "",
      `${APP_URL}/app/randevular?randevu=${appt.id}`,
    ].filter(Boolean);

    lines.push(
      ...icsEventLines({
        uid: `${appt.id}@emlaksoft`,
        dtstamp: now,
        start,
        end,
        summary,
        location: location || null,
        geo,
        description: descriptionParts.join("\n"),
        url: `${APP_URL}/app/randevular?randevu=${appt.id}`,
        lastModified: appt.updated_at ? new Date(appt.updated_at) : null,
        status: appt.status === "pending" ? "TENTATIVE" : "CONFIRMED",
        alarmMinutes: appointmentAlarmMinutes(Boolean(location || geo)),
      }),
    );
  }

  // Saatli açık görevler (GA-06): 15 dk'lık etkinlik, 10 dk önce alarm. Görev hatası randevu akışını bozmaz.
  if (taskRes.error) log.error("takvim_ics_tasks_failed", { route: "/api/takvim/[token]", ...errorFields(taskRes.error) });
  type TaskRow = { id: string; title: string; notes: string | null; due_at: string; created_at: string | null; customer: Rel | Rel[] };
  for (const task of (taskRes.data ?? []) as TaskRow[]) {
    const start = new Date(task.due_at);
    if (Number.isNaN(start.getTime())) continue;
    const customer = rel(task.customer);
    lines.push(
      ...icsEventLines({
        uid: `task-${task.id}@emlaksoft`,
        dtstamp: now,
        start,
        end: new Date(start.getTime() + TASK_EVENT_MIN * 60_000),
        summary: `Görev: ${task.title}${customer?.full_name ? ` — ${customer.full_name}` : ""}`,
        description: [task.notes ?? "", `${APP_URL}/app/gorevler?gorev=${task.id}`].filter(Boolean).join("\n"),
        url: `${APP_URL}/app/gorevler?gorev=${task.id}`,
        status: "CONFIRMED",
        alarmMinutes: [10],
      }),
    );
  }

  lines.push("END:VCALENDAR");

  // CRLF şart (RFC 5545); uzun satırlar 75 oktette katlanır (icsEventLines).
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
