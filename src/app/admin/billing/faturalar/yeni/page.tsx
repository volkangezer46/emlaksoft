import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { PageHeader } from "@/components/ui/page-header";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { getVatSchedule } from "@/lib/billing/vat-rate";
import { vatRateAt } from "@/lib/billing/plans";
import { now as clockNow, trDayKey } from "@/lib/clock";
import { BillingNav } from "../../billing-nav";
import { ManualInvoiceForm } from "./manual-invoice-form";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_LIMIT = 1000;

/** Elle fatura / tek seferlik ücret (kurulum, eğitim, elle yıllık ödeme): taslak oluşturma + KDV ayarları. */
export default async function NewInvoicePage({ searchParams }: { searchParams?: Promise<{ ofis?: string }> }) {
  const staff = await requirePlatformModule("billing");
  const sp = (await searchParams) ?? {};
  const admin = createAdminClient();
  const [{ data: tenants }, schedule] = await Promise.all([
    admin.from("tenants").select("id, name, status").order("name", { ascending: true }).limit(TENANT_LIMIT),
    getVatSchedule(),
  ]);
  const list = (tenants ?? []).map((t) => ({ id: String(t.id), name: String(t.name ?? "Ofis"), status: (t.status as string | null) ?? null }));
  const defaultTenantId = sp.ofis && UUID.test(sp.ofis) && list.some((t) => t.id === sp.ofis) ? sp.ofis : null;
  const vatRate = vatRateAt(schedule, trDayKey(clockNow()));
  const upcoming = schedule.filter((e) => e.from > trDayKey(clockNow()));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Faturalama"
        title="Elle fatura / tek seferlik ücret"
        description="Kurulum, eğitim ya da elle alınan yıllık ödeme için kalemli fatura. Önce taslak kaydedilir, detayda kontrol edilip kesilir."
        breadcrumbs={[{ label: "Faturalama", href: "/admin/billing" }, { label: "Yeni fatura" }]}
      />
      <BillingNav active="fatura" />

      {list.length >= TENANT_LIMIT ? (
        <p role="status" className="text-xs text-warn-600">
          İlk {TENANT_LIMIT} ofis listelendi; aradığınız ofis yoksa ofis kaydından bu sayfayı ?ofis=&lt;kimlik&gt; ile açın.
        </p>
      ) : null}

      <ManualInvoiceForm tenants={list} defaultTenantId={defaultTenantId} vatRate={vatRate} />

      {upcoming.length > 0 ? (
        <p className="text-xs text-text-muted">
          Planlı oran değişikliği:{" "}
          {upcoming.map((e) => `${e.from} itibarıyla %${Math.round(e.rate * 10000) / 100}`).join(", ")}. O günden sonra kesilen faturalar yeni oranla hesaplanır.
        </p>
      ) : null}

      <RegistrySettings
        title="Ayarlar"
        description="KDV oranı (geçerlilik tarihli; eski faturalar değişmez) ve elle faturanın vade süresi."
        keys={["billing.vat_rate", "billing.manual_invoice_due_days"]}
        canEdit={staff.role === "super_admin"}
      />
    </div>
  );
}
