import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CalendarClock, CalendarX2, DoorOpen, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPast } from "@/lib/clock";
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
      "id, scheduled_at, duration_min, status, property:properties(title, property_code), tenant:tenants(name)",
    )
    .eq("public_token", token)
    .maybeSingle();

  if (!event) notFound();

  const office = rel(event.tenant as { name?: string } | { name?: string }[] | null)?.name ?? "Emlak ofisi";
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
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        {/* Marka bandı — linki kimin astığı ilk bakışta belli olsun. */}
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
              <DoorOpen className="h-6 w-6 text-brand-600" />
            </span>
            <h1 className="mt-3 font-display text-xl font-extrabold text-ink-950">Açık ev kaydı</h1>
            <p className="mt-1 text-sm text-text-muted">
              Hoş geldiniz! Ziyaretinizi kaydedelim, danışmanımız sizinle ilgilensin.
            </p>
          </div>

          <div className="px-6 py-5">
            <dl className="space-y-2">
              {([
                ["Portföy", propLabel],
                ["Tarih", tarih],
                ["Saat", `${saat}${event.duration_min ? ` · ${event.duration_min} dk` : ""}`],
                ["Ofis", office],
              ] as const).map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-4 rounded-[12px] border border-line bg-canvas/60 px-4 py-2.5"
                >
                  <dt className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-text-muted">
                    {k === "Tarih" || k === "Saat" ? <CalendarClock className="h-3.5 w-3.5" /> : null}
                    {k}
                  </dt>
                  <dd className="truncate text-right text-sm font-semibold text-ink-950">{v}</dd>
                </div>
              ))}
            </dl>

            {ended ? (
              <div className="mt-5 flex items-center justify-center gap-2 rounded-[14px] border border-line bg-canvas px-4 py-6 text-sm font-semibold text-text-muted">
                <CalendarX2 className="h-4 w-4 shrink-0" /> Bu açık ev etkinliği sona erdi.
              </div>
            ) : (
              <CheckinForm token={token} kiosk={kiosk === "1"} />
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-text-faint">
          <Building2 className="mr-1 inline h-3 w-3 align-[-1px]" />
          Bu sayfa yalnızca açık ev ziyaretçi kaydı içindir ·{" "}
          <Link
            href="/"
            className="font-semibold underline-offset-2 transition hover:text-text-muted hover:underline"
          >
            Powered by EmlakSoft
          </Link>
        </p>
      </div>
    </div>
  );
}
