import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CheckCircle2, ShieldCheck, Star } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { SurveyForm } from "./survey-form";

// Anket linkleri kişiye özeldir → arama motorlarına kapalı (randevu-teyit deseni).
export const metadata: Metadata = {
  title: "Memnuniyet anketi",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * Memnuniyet anketi PUBLIC sayfası — danışmanın müşteriye ilettiği link.
 *
 * GÜVENLİK: müşteri adı ve anlaşma detayı bilerek GÖSTERİLMEZ — link yanlış
 * ele geçerse kişisel veri sızmasın. Ofis adı + puan sorusu yeterli.
 * RLS anon'a açık olmadığından sorgu service role ile yapılır
 * (acik-ev-kayit deseni).
 */
export default async function SurveyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // public_token uuid tipinde; uuid olmayan girdi sorguya gitmeden 404 olsun.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) notFound();

  const admin = createAdminClient();
  const { data: survey } = await admin
    .from("surveys")
    .select("id, status, tenant:tenants(name, phone)")
    .eq("public_token", token)
    .maybeSingle();

  if (!survey) notFound();

  const tenant = rel(survey.tenant as { name?: string; phone?: string | null } | { name?: string; phone?: string | null }[] | null);
  const office = tenant?.name ?? "Emlak ofisi";
  const officePhone = tenant?.phone ?? null;
  const answered = survey.status === "answered";

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        {/* Marka bandı — "EmlakSoft — {ofis adı}": linki kimin gönderdiği ilk bakışta belli olsun. */}
        <div className="mb-5 flex items-center justify-center gap-2 text-xs font-semibold text-text-muted">
          <span className="grid h-6 w-6 place-items-center rounded-[8px] bg-brand-600/10 text-[11px] font-bold text-brand-600">
            {office[0]}
          </span>
          EmlakSoft — {office}
          <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />
        </div>

        <div className="overflow-hidden rounded-[22px] border border-line bg-surface shadow-[var(--shadow-lg)]">
          <div className="border-b border-line bg-canvas/60 px-6 py-5 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-brand-600/10">
              <Star className="h-6 w-6 text-brand-600" />
            </span>
            <h1 className="mt-3 font-display text-xl font-extrabold text-ink-950">
              Memnuniyet anketi
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              Görüşünüz bizim için çok değerli — yalnızca birkaç saniyenizi alır.
            </p>
          </div>

          <div className="px-6 py-5">
            {answered ? (
              <div className="rounded-[14px] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-500/15 text-mint-600">
                  <CheckCircle2 className="h-6 w-6" />
                </span>
                <p className="mt-3 text-sm font-bold text-ink-950">Yanıtınız alınmış.</p>
                <p className="mt-1 text-xs text-text-muted">
                  Bu anket daha önce cevaplandı — değerlendirmeniz için teşekkür ederiz.
                </p>
              </div>
            ) : (
              <SurveyForm token={token} office={office} officePhone={officePhone} />
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-text-faint">
          <Building2 className="mr-1 inline h-3 w-3 align-[-1px]" />
          Bu sayfa yalnızca memnuniyet anketi içindir ·{" "}
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
