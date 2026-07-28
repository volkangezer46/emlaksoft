import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, CalendarX2, UserRound } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PublicBrandButton,
  PublicStateBox,
  PublicTokenPage,
} from "@/components/public/token-page";
import { formatTurkishPhone } from "@/lib/phone";
import { now } from "@/lib/clock";
import {
  buildBookingSlots,
  normalizeWeekdayHours,
  TR_OFFSET_MIN,
  type BusyInterval,
} from "@/lib/booking-slots";
import { leaveRangesToBusy, type LeaveLike } from "@/lib/leave-utils";
import { BookingForm } from "./booking-form";

// Rezervasyon linki danışmana özeldir → arama motorlarına kapalı (anket deseni).
export const metadata: Metadata = {
  title: "Randevu al",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

/**
 * Online randevu PUBLIC sayfası — danışmanın WhatsApp'tan gönderdiği link.
 *
 * GÜVENLİK: danışmanın mevcut randevuları (kim, nerede) bilerek GÖSTERİLMEZ —
 * yalnız "dolu" bilgisi slot elemesinde kullanılır. Ofis markası + danışman adı
 * + not, müşterinin "doğru kişiyle randevu alıyorum" demesi için yeterli.
 * RLS anon'a açık olmadığından sorgular service role ile yapılır (anket deseni).
 */
export default async function BookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // public_token uuid tipinde; uuid olmayan girdi sorguya gitmeden 404 olsun.
  if (!UUID_RE.test(token)) notFound();

  const admin = createAdminClient();
  const { data: setting } = await admin
    .from("booking_settings")
    .select(
      "tenant_id, staff_id, is_active, weekday_hours, slot_minutes, buffer_minutes, max_days_ahead, min_hours_notice, note",
    )
    .eq("public_token", token)
    .maybeSingle();

  if (!setting) notFound();

  const [{ data: tenant }, { data: staff }] = await Promise.all([
    admin.from("tenants").select("name, logo_url, brand_color, phone").eq("id", setting.tenant_id).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", setting.staff_id).maybeSingle(),
  ]);

  const office = tenant?.name ?? "Emlak ofisi";
  const officePhone = (tenant?.phone as string | null) ?? null;
  const logoUrl = (tenant?.logo_url as string | null) ?? null;
  const brandColor = (tenant?.brand_color as string | null) ?? null;
  const advisorName = (staff?.full_name as string | null) ?? "Danışmanınız";
  const slotMinutes = Number(setting.slot_minutes ?? 60);

  // ---- Müsait slotlar ----
  // Danışmanın iptal edilmemiş randevuları "dolu" aralık olarak okunur;
  // süresi girilmemiş randevu 60 dk sayılır (findConflictWarning kuralı).
  const nowMs = now();
  const maxDaysAhead = Number(setting.max_days_ahead ?? 14);
  let days: ReturnType<typeof buildBookingSlots> = [];
  if (setting.is_active) {
    const windowStartIso = new Date(nowMs - DAY_MS).toISOString();
    const windowEndIso = new Date(nowMs + (maxDaysAhead + 1) * DAY_MS).toISOString();
    const [{ data: busyRows }, { data: leaveRows }] = await Promise.all([
      admin
        .from("appointments")
        .select("scheduled_at, duration_min")
        .eq("tenant_id", setting.tenant_id)
        .eq("assigned_to", setting.staff_id)
        .neq("status", "cancelled")
        .gte("scheduled_at", windowStartIso)
        .lt("scheduled_at", windowEndIso),
      // İZİN BLOKLAMASI: danışman izne çıktığında o günlerde HİÇ slot çıkmamalı.
      // Yalnız 'onayli' izinler bloklar (talep/reddedildi engel değil, bkz.
      // leave-utils). Aralık penceresi slot penceresiyle kesişenleri alır.
      admin
        .from("staff_leaves")
        .select("staff_id, starts_on, ends_on, status")
        .eq("tenant_id", setting.tenant_id)
        .eq("staff_id", setting.staff_id)
        .eq("status", "onayli")
        .lte("starts_on", windowEndIso.slice(0, 10))
        .gte("ends_on", windowStartIso.slice(0, 10)),
    ]);

    const busy: BusyInterval[] = (busyRows ?? []).map((r) => {
      const s = new Date(r.scheduled_at as string).getTime();
      return { start: s, end: s + ((r.duration_min as number | null) ?? 60) * 60_000 };
    });
    // İzin günleri tüm gün bloğu olarak aynı "busy" sözleşmesine katılır —
    // slot üreticisinin imzası değişmez, geriye dönük uyum korunur.
    busy.push(...leaveRangesToBusy((leaveRows ?? []) as LeaveLike[], TR_OFFSET_MIN, setting.staff_id));

    days = buildBookingSlots({
      nowMs,
      weekdayHours: normalizeWeekdayHours(setting.weekday_hours),
      slotMinutes,
      bufferMinutes: Number(setting.buffer_minutes ?? 0),
      maxDaysAhead,
      minHoursNotice: Number(setting.min_hours_notice ?? 4),
      busy,
    });
  }

  const openDays = days.filter((d) => d.slots.length > 0);

  return (
    <PublicTokenPage
      office={office}
      logoUrl={logoUrl}
      brandColor={brandColor}
      icon={CalendarClock}
      title="Randevu al"
      subtitle={
        <span className="inline-flex items-center justify-center gap-1.5">
          <UserRound className="h-3.5 w-3.5" aria-hidden="true" /> {advisorName}
        </span>
      }
      purpose="Bu sayfa yalnızca randevu talebi içindir"
      width="lg"
    >
      {setting.note ? (
        <p className="mb-4 rounded-[12px] border border-line bg-canvas/60 px-4 py-3 text-xs leading-relaxed text-text-muted">
          {setting.note}
        </p>
      ) : null}

      {!setting.is_active ? (
        <PublicStateBox
          icon={CalendarX2}
          title="Şu anda online randevu alınamıyor."
          description="Danışmanımız takvimini kapatmış. Ofisimizi arayarak randevu oluşturabilirsiniz."
          action={
            officePhone ? (
              <PublicBrandButton href={`tel:${officePhone.replace(/\s/g, "")}`}>
                {formatTurkishPhone(officePhone)}
              </PublicBrandButton>
            ) : null
          }
        />
      ) : openDays.length === 0 ? (
        <PublicStateBox
          icon={CalendarX2}
          title="Uygun saat kalmadı"
          description={`Önümüzdeki ${maxDaysAhead} gün için boş randevu saati görünmüyor.${
            officePhone ? " Bizi arayarak randevu oluşturabilirsiniz." : ""
          }`}
          action={
            officePhone ? (
              <PublicBrandButton href={`tel:${officePhone.replace(/\s/g, "")}`}>
                {formatTurkishPhone(officePhone)}
              </PublicBrandButton>
            ) : null
          }
        />
      ) : (
        <BookingForm
          token={token}
          days={openDays}
          slotMinutes={slotMinutes}
          office={office}
          officePhone={officePhone}
          advisorName={advisorName}
        />
      )}
    </PublicTokenPage>
  );
}
