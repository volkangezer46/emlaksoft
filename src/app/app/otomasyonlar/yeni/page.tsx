import { redirect } from "next/navigation";
import { deniedPageHref, requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { IconChip } from "@/components/ui/icons";
import { ICONS } from "@/lib/icons";
import { AutomationWizard } from "../automation-wizard";
import { getStageLabels } from "@/lib/definitions";
import { stageLabelMap } from "@/lib/deal-stage-labels";

export const metadata = { title: "Yeni otomasyon" };

export default async function YeniOtomasyonPage() {
  const { perms } = await requireModulePage("settings", "/app/otomasyonlar");
  // Oluşturma yetkisi (settings:edit) yoksa açıklamalı yetki kartı (sessizce listeye dönmek yerine); sunucu eylemi de ayrıca doğrular.
  if (!(perms.settings ?? []).includes("edit")) redirect(deniedPageHref("settings"));

  const supabase = await createClient();
  // Sihirbazdaki "Danışmana ata" aksiyonu için aktif ekip listesi
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .order("full_name");
  const staff = (data ?? []) as { id: string; full_name: string }[];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={<IconChip icon={ICONS.otomasyon} tone="brand" size="lg" />}
        title="Yeni otomasyon"
        eyebrow="Otomasyonlar"
        description="Tetikleyici → koşul → aksiyon: kuralınızı 3 adımda oluşturun."
        breadcrumbs={[
          { label: "Otomasyonlar", href: "/app/otomasyonlar" },
          { label: "Yeni otomasyon" },
        ]}
      />
      <AutomationWizard staff={staff} mode="page" stageNames={stageLabelMap(await getStageLabels())} />
    </div>
  );
}
