import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { AutomationWizard } from "../automation-wizard";

export default async function YeniOtomasyonPage() {
  const { perms } = await requireModulePage("settings", "/app/otomasyonlar");
  // Oluşturma yetkisi (settings:edit) yoksa listeye dön; sunucu eylemi de ayrıca doğrular.
  if (!(perms.settings ?? []).includes("edit")) redirect("/app/otomasyonlar");

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
        title="Yeni otomasyon"
        eyebrow="Otomasyonlar"
        description="Tetikleyici → koşul → aksiyon: kuralınızı 3 adımda oluşturun."
        breadcrumbs={[
          { label: "Otomasyonlar", href: "/app/otomasyonlar" },
          { label: "Yeni otomasyon" },
        ]}
      />
      <AutomationWizard staff={staff} mode="page" />
    </div>
  );
}
