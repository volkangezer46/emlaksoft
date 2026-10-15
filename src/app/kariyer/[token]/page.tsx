import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefcaseBusiness, DoorClosed } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { PublicStateBox, PublicTokenPage } from "@/components/public/token-page";
import { resolvePublicContact } from "@/lib/public-contact";
import { PublicContactActions } from "@/components/public/public-contact-actions";
import { CareerApplyForm } from "./apply-form";

// Ofise özel başvuru bağlantısı → arama motorlarına kapalı (token yüzeyi; sitemap'e girmez).
export const metadata: Metadata = {
  title: "Danışman başvurusu",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FormRow = {
  office_name: string | null;
  logo_url: string | null;
  brand_color: string | null;
  phone: string | null;
  intro: string | null;
  accepting: boolean | null;
  retention_days: number | null;
  tenant_status: string | null;
};

/**
 * Herkese açık DANIŞMAN BAŞVURU formu (OA9) — ofisin sosyal medyada / iş ilanında paylaştığı bağlantı.
 * Oturum ve service role YOK: ofis markası `recruit_public_form` (DEFINER, kişisel veri döndürmez) ile okunur,
 * başvuru `submitCareerApplication` → `recruit_public_apply` ile yazılır. KVKK: veri sorumlusu ofis, amaç işe alım
 * değerlendirmesi, saklama süresi ofis ayarından; açık rıza olmadan gönderilemez.
 */
export default async function CareerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!UUID_RE.test(token)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recruit_public_form", { p_token: token }).maybeSingle();
  const form = data as FormRow | null;
  if (error || !form || !isPublicTenantActive(form.tenant_status)) notFound();

  const office = form.office_name ?? "Emlak ofisi";
  const retention = form.retention_days ?? 180;
  const contact = resolvePublicContact({
    advisorPhone: null,
    officePhone: form.phone ?? null,
    whatsappText: "Merhaba, ofisinizde danışman olarak çalışmak hakkında bilgi almak istiyorum.",
  });

  return (
    <PublicTokenPage
      office={office}
      logoUrl={form.logo_url}
      brandColor={form.brand_color}
      icon={BriefcaseBusiness}
      title="Ekibimize katılın"
      subtitle={form.intro ?? `${office} gayrimenkul danışmanı arıyor. Bilgilerinizi bırakın, sizi arayalım.`}
      purpose="Bu sayfa yalnızca danışman başvurusu içindir"
    >
      {form.accepting ? (
        <CareerApplyForm token={token} office={office} retentionDays={retention} />
      ) : (
        <>
          <PublicStateBox
            icon={DoorClosed}
            title="Şu an başvuru alınmıyor."
            description="Ofis yeni danışman başvurularını geçici olarak kapattı. Bilgi almak için ofisle iletişime geçebilirsiniz."
          />
          <PublicContactActions contact={contact} tone="light" className="mt-4" />
        </>
      )}
    </PublicTokenPage>
  );
}
