import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Star } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { PublicStateBox, PublicTokenPage } from "@/components/public/token-page";
import { isFeatureEnabledIn } from "@/lib/modules/logic";
import { loadTenantModuleState } from "@/lib/modules/state";
import { loadTemplateQuestions } from "@/lib/surveys/server";
import { isSurveyTaskLinkExpired } from "@/lib/surveys/task-expiry";
import { now } from "@/lib/clock";
import { SurveyForm } from "./survey-form";
import { TaskSurveyForm } from "./task-survey-form";

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
    .select("id, tenant_id, customer_id, status, tenant:tenants(name, status, phone, logo_url, brand_color)")
    .eq("public_token", token)
    .maybeSingle();

  if (!survey) return renderTaskSurvey(admin, token);

  type TenantShape = {
    name?: string;
    status?: string;
    phone?: string | null;
    logo_url?: string | null;
    brand_color?: string | null;
  };
  const tenant = rel(survey.tenant as TenantShape | TenantShape[] | null);
  if (!tenant || !isPublicTenantActive(tenant.status)) notFound();
  const { data: customer } = await admin
    .from("customers")
    .select("id")
    .eq("id", survey.customer_id)
    .eq("tenant_id", survey.tenant_id)
    .eq("is_sample", false)
    .is("deleted_at", null)
    .maybeSingle();
  if (!customer) notFound();
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

/**
 * Anketör görevi için bağlı link (anket modülü). Kapanış anketi bulunamayınca görev token'ı denenir; tablolar yoksa
 * ya da görev bulunamazsa 404. Müşteri/malik adı ve işlem ayrıntısı gösterilmez, yalnız şablon soruları.
 */
async function renderTaskSurvey(admin: ReturnType<typeof createAdminClient>, token: string) {
  const { data: task, error } = await admin
    .from("survey_tasks")
    .select("id, tenant_id, status, template_id, customer_id, property_id, due_at, tenant:tenants(name, status, phone, logo_url, brand_color)")
    .eq("public_token", token)
    .maybeSingle();
  if (error || !task || !task.template_id) notFound();

  type TenantShape = { name?: string; status?: string; logo_url?: string | null; brand_color?: string | null };
  const tenant = rel(task.tenant as TenantShape | TenantShape[] | null);
  if (!tenant || !isPublicTenantActive(tenant.status)) notFound();
  const tenantId = String(task.tenant_id);

  // Örnek (is_sample) kayıtlara bağlı görev herkese açık yüzde gösterilmez.
  if (task.customer_id) {
    const { data: c } = await admin.from("customers").select("id").eq("id", task.customer_id).eq("tenant_id", tenantId).eq("is_sample", false).is("deleted_at", null).maybeSingle();
    if (!c) notFound();
  }
  if (task.property_id) {
    const { data: p } = await admin.from("properties").select("id").eq("id", task.property_id).eq("tenant_id", tenantId).eq("is_sample", false).maybeSingle();
    if (!p) notFound();
  }

  const moduleState = await loadTenantModuleState(admin, tenantId);
  const office = tenant.name ?? "Emlak ofisi";
  const closed = !isFeatureEnabledIn(moduleState, "surveys");
  const answered = task.status === "completed";
  // Süresi dolan görev bağlantısı (due_at + SURVEY_TASK_LINK_VALID_DAYS) cevap almaz.
  if (!answered && isSurveyTaskLinkExpired(task.due_at as string | null, now())) notFound();
  const questions = closed || answered ? [] : await loadTemplateQuestions(admin, tenantId, String(task.template_id));

  return (
    <PublicTokenPage
      office={office}
      logoUrl={tenant.logo_url ?? null}
      brandColor={tenant.brand_color ?? null}
      icon={Star}
      title="Geri bildirim anketi"
      subtitle="Görüşünüz bizim için çok değerli — birkaç soruyu cevaplamanız yeterli."
      purpose="Bu sayfa yalnızca geri bildirim anketi içindir"
    >
      {closed ? (
        <PublicStateBox icon={CheckCircle2} tone="success" title="Anket şu an kapalı." description="Bu anket ofis tarafından geçici olarak kapatıldı." />
      ) : answered ? (
        <PublicStateBox icon={CheckCircle2} tone="success" title="Yanıtınız alınmış." description="Bu anket daha önce cevaplandı. Değerlendirmeniz için teşekkür ederiz." />
      ) : task.status === "refused" || task.status === "cancelled" ? (
        <PublicStateBox icon={CheckCircle2} tone="success" title="Bu anket kapatılmış." description="Anket artık yanıt almıyor. İlginiz için teşekkür ederiz." />
      ) : (
        <TaskSurveyForm
          token={token}
          questions={questions.map((q) => ({ id: q.id, kind: q.kind, label: q.label, options: q.options, required: q.required }))}
        />
      )}
    </PublicTokenPage>
  );
}
