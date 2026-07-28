import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Star } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicStateBox, PublicTokenPage } from "@/components/public/token-page";
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
    .select("id, status, tenant:tenants(name, phone, logo_url, brand_color)")
    .eq("public_token", token)
    .maybeSingle();

  if (!survey) notFound();

  type TenantShape = {
    name?: string;
    phone?: string | null;
    logo_url?: string | null;
    brand_color?: string | null;
  };
  const tenant = rel(survey.tenant as TenantShape | TenantShape[] | null);
  const office = tenant?.name ?? "Emlak ofisi";
  const officePhone = tenant?.phone ?? null;
  const answered = survey.status === "answered";

  return (
    <PublicTokenPage
      office={office}
      logoUrl={tenant?.logo_url ?? null}
      brandColor={tenant?.brand_color ?? null}
      icon={Star}
      title="Memnuniyet anketi"
      subtitle="Görüşünüz bizim için çok değerli — yalnızca birkaç saniyenizi alır."
      purpose="Bu sayfa yalnızca memnuniyet anketi içindir"
    >
      {answered ? (
        <PublicStateBox
          icon={CheckCircle2}
          tone="success"
          title="Yanıtınız alınmış."
          description="Bu anket daha önce cevaplandı — değerlendirmeniz için teşekkür ederiz."
        />
      ) : (
        <SurveyForm token={token} office={office} officePhone={officePhone} />
      )}
    </PublicTokenPage>
  );
}
