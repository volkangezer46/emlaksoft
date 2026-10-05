import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { PageHeader } from "@/components/ui/page-header";
import { loadOversightSettings } from "@/lib/oversight/store";
import { OversightNav } from "../_components/oversight-nav";
import { PrivacyNote } from "../_components/privacy-note";
import { OversightSettingsForm } from "./settings-form";

export default async function KurallarPage() {
  const { tenantId, role } = await requireModulePage("dashboard", "/app/ofis-kontrol/kurallar");
  if (!tenantId || !hasOfficeWideDataScope(role)) redirect("/app/ofis-kontrol/benim");

  const supabase = await createClient();
  const settings = await loadOversightSettings(supabase, tenantId);
  const canEdit = role === "owner" || role === "gm";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ofis Kontrol Merkezi"
        title="Kurallar ve eşikler"
        description="Hangi işlemlerin uyarı üreteceğini ve hangilerinin yönetici onayı gerektireceğini siz belirlersiniz. Varsayılanlar danışmanı yavaşlatmayacak şekilde seçilmiştir."
      />
      <OversightNav active="kurallar" office />

      {!settings.available ? (
        <p className="rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800">
          Ayar depolaması henüz etkin değil (veritabanı güncellemesi bekleniyor). Varsayılan eşikler kullanılıyor; değişiklik kaydedilemez.
        </p>
      ) : null}

      <OversightSettingsForm
        thresholds={settings.thresholds}
        approvalRules={settings.approvalRules}
        canEdit={canEdit}
        storeAvailable={settings.available}
      />
      <PrivacyNote audience="office" />
    </div>
  );
}
