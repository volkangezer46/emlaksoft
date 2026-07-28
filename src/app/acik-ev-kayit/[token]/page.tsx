import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Building2, CalendarClock, CalendarX2, DoorOpen } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPast } from "@/lib/clock";
import {
  PublicDetailList,
  PublicStateBox,
  PublicTokenPage,
} from "@/components/public/token-page";
import { CheckinForm } from "./checkin-form";

// Kayıt linkleri etkinliğe özeldir → arama motorlarına kapalı (randevu-teyit deseni).
export const metadata: Metadata = {
  title: "Açık ev kaydı",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * Açık ev self check-in PUBLIC sayfası — kapıya asılan QR bunu açar.
 *
 * GÜVENLİK: açık adres bilerek GÖSTERİLMEZ (randevu-teyit deseni) — link
 * yanlış ele geçerse buluşma noktası sızmasın. Portföy başlığı, tarih/saat ve
 * ofis adı ziyaretçinin "doğru yerdeyim" demesi için yeterli; zaten fiziken
 * kapıdadır. RLS anon'a açık olmadığından sorgu service role ile yapılır.
 *
 * ?kiosk=1: tablet kiosk modu — teşekkür ekranından 4 sn sonra form sıfırlanır
 * ki sıradaki ziyaretçi kaydolabilsin (davranış CheckinForm'da).
 */
export default async function OpenHouseCheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ kiosk?: string }>;
}) {
  const [{ token }, { kiosk }] = await Promise.all([params, searchParams]);
  // public_token uuid tipinde; uuid olmayan girdi sorguya gitmeden 404 olsun.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) notFound();

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("open_houses")
    .select(
      "id, scheduled_at, duration_min, status, property:properties(title, property_code), tenant:tenants(name, logo_url, brand_color)",
    )
    .eq("public_token", token)
    .maybeSingle();

  if (!event) notFound();

  type TenantShape = { name?: string; logo_url?: string | null; brand_color?: string | null };
  const tenant = rel(event.tenant as TenantShape | TenantShape[] | null);
  const office = tenant?.name ?? "Emlak ofisi";
  const property = rel(
    event.property as
      | { title?: string | null; property_code?: string | null }
      | { title?: string | null; property_code?: string | null }[]
      | null,
  );
  const propLabel = property?.title ?? property?.property_code ?? "Açık ev";
  const date = new Date(event.scheduled_at);
  const tarih = new Intl.DateTimeFormat("tr-TR", { dateStyle: "full" }).format(date);
  const saat = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date);
  const endMs = date.getTime() + (event.duration_min ?? 120) * 60_000;
  const ended =
    event.status === "cancelled" ||
    event.status === "completed" ||
    isPast(new Date(endMs).toISOString());

  return (
    <PublicTokenPage
      office={office}
      logoUrl={tenant?.logo_url ?? null}
      brandColor={tenant?.brand_color ?? null}
      icon={DoorOpen}
      title="Açık ev kaydı"
      subtitle="Hoş geldiniz! Ziyaretinizi kaydedelim, danışmanımız sizinle ilgilensin."
      purpose="Bu sayfa yalnızca açık ev ziyaretçi kaydı içindir"
    >
      <PublicDetailList
        items={[
          { label: "Portföy", value: propLabel, icon: Building2 },
          { label: "Tarih", value: tarih, icon: CalendarClock },
          {
            label: "Saat",
            value: `${saat}${event.duration_min ? ` · ${event.duration_min} dk` : ""}`,
            icon: CalendarClock,
          },
          { label: "Ofis", value: office },
        ]}
      />

      {ended ? (
        <PublicStateBox
          className="mt-5"
          icon={CalendarX2}
          title="Bu açık ev etkinliği sona erdi."
          description="İlgilendiğiniz portföy için ofisimizle iletişime geçebilirsiniz."
        />
      ) : (
        <CheckinForm token={token} kiosk={kiosk === "1"} />
      )}
    </PublicTokenPage>
  );
}
