import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CalendarClock, CalendarX2, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPast } from "@/lib/clock";
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
      "id, appointment_type, scheduled_at, duration_min, status, customer_response, customer:customers(full_name), tenant:tenants(name)",
    )
    .eq("confirm_token", token)
    .maybeSingle();

  if (!appt) notFound();

  const office = rel(appt.tenant as { name?: string } | { name?: string }[] | null)?.name ?? "Emlak ofisi";
  const customerName = rel(appt.customer as { full_name?: string } | { full_name?: string }[] | null)?.full_name ?? null;
  const date = new Date(appt.scheduled_at);
  const tarih = new Intl.DateTimeFormat("tr-TR", { dateStyle: "full" }).format(date);
  const saat = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date);
  const expired = isPast(appt.scheduled_at);
  const alreadyCancelled = appt.status === "cancelled" && appt.customer_response !== "cancelled";

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        {/* Marka bandı — linki kimin gönderdiği ilk bakışta belli olsun. */}
        <div className="mb-5 flex items-center justify-center gap-2 text-xs font-semibold text-text-muted">
          <span className="grid h-6 w-6 place-items-center rounded-[8px] bg-brand-600/10 text-[11px] font-bold text-brand-600">
            {office[0]}
          </span>
          {office}
          <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />
        </div>

        <div className="overflow-hidden rounded-[22px] border border-line bg-surface shadow-[var(--shadow-lg)]">
          <div className="border-b border-line bg-canvas/60 px-6 py-5 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-brand-600/10">
              <CalendarClock className="h-6 w-6 text-brand-600" />
            </span>
            <h1 className="mt-3 font-display text-xl font-extrabold text-ink-950">Randevu teyidi</h1>
            {customerName ? (
              <p className="mt-1 text-sm text-text-muted">Sayın {customerName}, randevunuzu onaylar mısınız?</p>
            ) : (
              <p className="mt-1 text-sm text-text-muted">Randevunuzu onaylar mısınız?</p>
            )}
          </div>

          <div className="px-6 py-5">
            <dl className="space-y-2">
              {([
                ["Tarih", tarih],
                ["Saat", `${saat}${appt.duration_min ? ` · ${appt.duration_min} dk` : ""}`],
                ["Randevu türü", typeLabel[appt.appointment_type] ?? appt.appointment_type],
                ["Ofis", office],
              ] as const).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-4 rounded-[12px] border border-line bg-canvas/60 px-4 py-2.5">
                  <dt className="text-xs font-semibold text-text-muted">{k}</dt>
                  <dd className="text-right text-sm font-semibold text-ink-950">{v}</dd>
                </div>
              ))}
            </dl>

            {expired ? (
              <div className="mt-5 flex items-center justify-center gap-2 rounded-[14px] border border-line bg-canvas px-4 py-6 text-sm font-semibold text-text-muted">
                <CalendarX2 className="h-4 w-4 shrink-0" /> Bu randevunun tarihi geçmiş.
              </div>
            ) : alreadyCancelled ? (
              <div className="mt-5 flex items-center justify-center gap-2 rounded-[14px] border border-danger-500/25 bg-danger-500/5 px-4 py-6 text-sm font-semibold text-danger-500">
                <CalendarX2 className="h-4 w-4 shrink-0" /> Bu randevu iptal edilmiş. Sorularınız için ofisle iletişime geçin.
              </div>
            ) : (
              <ConfirmButtons token={token} initialResponse={appt.customer_response as "coming" | "cancelled" | null} />
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-text-faint">
          <Building2 className="mr-1 inline h-3 w-3 align-[-1px]" />
          Bu sayfa yalnızca randevu teyidi içindir ·{" "}
          <Link href="/" className="font-semibold underline-offset-2 transition hover:text-text-muted hover:underline">
            Powered by EmlakSoft
          </Link>
        </p>
      </div>
    </div>
  );
}
