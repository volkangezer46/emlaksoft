import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireModulePage } from "@/lib/require-module-page";
import { sequenceTemplate } from "@/lib/automation/sequence-templates";
import { SequenceEditor } from "../sequence-editor";

export const metadata = { title: "Yeni otomatik takip" };

export default async function YeniDiziPage({ searchParams }: { searchParams?: Promise<{ sablon?: string }> }) {
  const { perms } = await requireModulePage("settings", "/app/otomasyonlar");
  // Dizi tanımı settings:edit ister; sunucu eylemi ve RLS ayrıca doğrular.
  if (!(perms.settings ?? []).includes("edit")) notFound();
  const tpl = sequenceTemplate(((await searchParams) ?? {}).sablon);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Yeni otomatik takip"
        eyebrow="Otomatik takip mesajları"
        description="Adımları sırayla ve gün aralığıyla tanımlayın; kaydettikten sonra müşterileri diziye ekleyin."
        breadcrumbs={[
          { label: "Otomatik takip mesajları", href: "/app/otomasyonlar/diziler" },
          { label: "Yeni dizi" },
        ]}
      />
      <SequenceEditor
        initial={{
          name: tpl?.name ?? "",
          description: tpl?.description ?? null,
          is_active: true,
          stop_on_reply: true,
          daily_cap: 200,
          steps: tpl?.steps ?? [],
        }}
      />
    </div>
  );
}
