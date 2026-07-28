import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Building2, CalendarClock, CalendarX2 } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPast } from "@/lib/clock";
import {
  PublicDetailList,
  PublicStateBox,
  PublicTokenPage,
} from "@/components/public/token-page";
import { ConfirmButtons } from "./confirm-buttons";

// Teyit linkleri kişiye özeldir → arama motorlarına kapalı (paylas/[token] deseni).
export const metadata: Metadata = {
  title: "Randevu teyidi",
  robots: { index: false, follow: false },
};

const typeLabel: Record<string, string> = {
  showing: "Yer gösterme",
  office: "Ofis görüşmesi",
  valuation: "Değerleme",
  contract: "Sözleşme",
};

function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * Randevu teyidinin PUBLIC sayfası — token'ı bilen müşteri randevu özetini
 * görür ve "Geliyorum / Katılamayacağım" ile yanıtlar.
 *
 * GÜVENLİK: adres/konum bilerek GÖSTERİLMEZ — link SMS'le iletildiği için
 * yanlış ele geçtiğinde buluşma noktası sızmasın. Tarih, saat, tür ve ofis
 * adı teyit için yeterli. RLS anon'a açılmadığından sorgular service role
 * ile yapılır (degerleme-raporu/[token] deseni).
 */
export default async function AppointmentConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // confirm_token uuid tipinde; uuid olmayan girdi sorguya gitmeden 404 olsun.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) notFound();

  const admin = createAdminClient();
  const { data: appt } = await admin
    .from("appointments")
    .select(
      "id, appointment_type, scheduled_at, duration_min, status, customer_response, customer:customers(full_name), tenant:tenants(name, logo_url, brand_color)",
    )
    .eq("confirm_token", token)
    .maybeSingle();

  if (!appt) notFound();

  type TenantShape = { name?: string; logo_url?: string | null; brand_color?: string | null };
  const tenant = rel(appt.tenant as TenantShape | TenantShape[] | null);
  const office = tenant?.name ?? "Emlak ofisi";
  const customerName = rel(appt.customer as { full_name?: string } | { full_name?: string }[] | null)?.full_name ?? null;
  const date = new Date(appt.scheduled_at);
  const tarih = new Intl.DateTimeFormat("tr-TR", { dateStyle: "full" }).format(date);
  const saat = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date);
  const expired = isPast(appt.scheduled_at);
  const alreadyCancelled = appt.status === "cancelled" && appt.customer_response !== "cancelled";

  return (
    <PublicTokenPage
      office={office}
      logoUrl={tenant?.logo_url ?? null}
      brandColor={tenant?.brand_color ?? null}
      icon={CalendarClock}
      title="Randevu teyidi"
      subtitle={
        customerName
          ? `Sayın ${customerName}, randevunuzu onaylar mısınız?`
          : "Randevunuzu onaylar mısınız?"
      }
      purpose="Bu sayfa yalnızca randevu teyidi içindir"
    >
      <PublicDetailList
        items={[
          { label: "Tarih", value: tarih, icon: CalendarClock },
          { label: "Saat", value: `${saat}${appt.duration_min ? ` · ${appt.duration_min} dk` : ""}` },
          {
            label: "Randevu türü",
            value: typeLabel[appt.appointment_type] ?? appt.appointment_type,
          },
          { label: "Ofis", value: office, icon: Building2 },
        ]}
      />

      {expired ? (
        <PublicStateBox
          className="mt-5"
          icon={CalendarX2}
          title="Bu randevunun tarihi geçmiş."
          description="Yeni bir randevu için ofisimizle iletişime geçebilirsiniz."
        />
      ) : alreadyCancelled ? (
        <PublicStateBox
          className="mt-5"
          tone="danger"
          icon={CalendarX2}
          title="Bu randevu iptal edilmiş."
          description="Sorularınız için ofisle iletişime geçin."
        />
      ) : (
        <ConfirmButtons
          token={token}
          initialResponse={appt.customer_response as "coming" | "cancelled" | null}
        />
      )}
    </PublicTokenPage>
  );
}
