import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PageHeader } from "@/components/ui/page-header";
import { ContractTemplatesManager, type ContractTemplateRow } from "./contract-templates-manager";

export const metadata = { title: "Sözleşme şablonları" };

export default async function ContractTemplatesSettingsPage() {
  const { tenantId, perms } = await requireModulePage("settings");
  const canEdit = (perms.settings ?? []).includes("edit");
  const supabase = await createClient();

  const { data } = await supabase
    .from("contract_templates")
    .select("id, tenant_id, type, title, content, is_active, created_at")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .order("created_at", { ascending: true })
    .limit(200);

  const templates: ContractTemplateRow[] = (data ?? []).map((t) => ({
    id: t.id as string,
    type: t.type as string,
    title: t.title as string,
    content: t.content as string,
    isActive: Boolean(t.is_active),
    isGlobal: t.tenant_id == null,
  }));

  return (
    <div className="space-y-6">
      <Link
        href="/app/ayarlar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>
      <PageHeader
        title="Sözleşme şablonları"
        eyebrow="Ofis şablon kütüphanesi"
        description="Yeni sözleşme formunda seçilen hazır metinler. Ofisinize özel şablon ekleyin, düzenleyin, pasife alın. Platformun hazır şablonları salt okunurdur."
      />
      <ContractTemplatesManager templates={templates} canEdit={canEdit} />
    </div>
  );
}
