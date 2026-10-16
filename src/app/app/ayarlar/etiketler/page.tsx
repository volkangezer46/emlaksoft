import { Tags } from "lucide-react";
import { IconChip } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { requireModulePage } from "@/lib/require-module-page";
import { listTagCounts } from "@/app/actions/customer-tags";
import { TagManager } from "./tag-manager";

export const metadata = { title: "Etiketler" };

/** Müşteri etiketleri: ofis genelinde sayılar, yeniden adlandırma / birleştirme ve kaldırma. */
export default async function TagsPage() {
  const { perms } = await requireModulePage("customers");
  const canEdit = (perms.customers ?? []).includes("edit");
  const tags = await listTagCounts();
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "Etiketler" }]}
        icon={<IconChip icon={Tags} size="lg" />}
        title="Müşteri etiketleri"
        description="Etiketleri yeniden adlandırın, aynı anlama gelenleri birleştirin ya da tüm müşterilerden kaldırın. Sayıya tıklayınca müşteri listesi o etiketle süzülür."
      />
      <TagManager tags={tags} canEdit={canEdit} />
    </div>
  );
}
