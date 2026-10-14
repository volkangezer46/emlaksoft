import { Palette } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { requirePlatformModule } from "@/lib/platform";
import { readBrandMetaFresh } from "@/lib/brand/store";
import { BrandManager } from "./brand-manager-lazy";

export const metadata = { title: "Marka" };

/** Süper admin: platform logosu, sembol ve favicon yönetimi (tenant bağımsız). */
export default async function AdminBrandPage() {
  await requirePlatformModule("marka");
  const meta = await readBrandMetaFresh();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Platform kimliği"
        icon={Palette}
        title="Marka"
        description="Logo (açık/koyu zemin), sembol ve favicon buradan değişir; landing, giriş, yasal sayfalar, /app ve /admin kabuğunda anında yansır. Ofis bazlı özel logo (beyaz etiket) bu ekranın kapsamı dışındadır."
        glow="amber"
      />
      <BrandManager meta={meta} />
    </div>
  );
}
