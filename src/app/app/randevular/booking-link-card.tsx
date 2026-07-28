import { createClient } from "@/lib/supabase/server";
import { normalizeWeekdayHours } from "@/lib/booking-slots";
import { BookingLinkForm, type BookingSettingsView } from "./booking-link-form";

/**
 * "Online randevu linkin" kartı — danışmanın kendi rezervasyon sayfası
 * (/randevu-al/[token]) ayarları. Sunucu tarafı yalnız veriyi çeker; etkileşim
 * (kopyala / önizle / linki yenile / form) client bileşende.
 *
 * Ayar satırı kullanıcı ilk kez kaydedene kadar YOKTUR — o durumda kart makul
 * varsayılanlarla (hafta içi 09:00-18:00, 60 dk, 14 gün, 4 saat) kapalı açılır.
 */
export async function BookingLinkCard({ userId }: { userId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("booking_settings")
    .select(
      "public_token, is_active, weekday_hours, slot_minutes, buffer_minutes, max_days_ahead, min_hours_notice, note",
    )
    .eq("staff_id", userId)
    .maybeSingle();

  const settings: BookingSettingsView = data
    ? {
        token: String(data.public_token),
        isActive: Boolean(data.is_active),
        weekdayHours: normalizeWeekdayHours(data.weekday_hours),
        slotMinutes: Number(data.slot_minutes ?? 60),
        bufferMinutes: Number(data.buffer_minutes ?? 0),
        maxDaysAhead: Number(data.max_days_ahead ?? 14),
        minHoursNotice: Number(data.min_hours_notice ?? 4),
        note: (data.note as string | null) ?? "",
      }
    : {
        token: null,
        isActive: false,
        weekdayHours: {
          "1": ["09:00", "18:00"],
          "2": ["09:00", "18:00"],
          "3": ["09:00", "18:00"],
          "4": ["09:00", "18:00"],
          "5": ["09:00", "18:00"],
        },
        slotMinutes: 60,
        bufferMinutes: 0,
        maxDaysAhead: 14,
        minHoursNotice: 4,
        note: "",
      };

  return <BookingLinkForm settings={settings} />;
}
