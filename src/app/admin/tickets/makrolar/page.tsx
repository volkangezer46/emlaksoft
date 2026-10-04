import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/page-header";
import { MacroList, type MacroRow } from "./macro-editor";

export const metadata = { title: "Hazır yanıtlar" };

export default async function MacrosPage() {
  const staff = await requirePlatformModule("tickets");
  const admin = createAdminClient();
  const { data } = await admin.from("ticket_macros").select("id, title, body").order("title");
  return (
    <div className="space-y-6">
      {/* Satır içi düzenleme paneli burada açılır; popup yok. */}
      <div id="inline-panel-host" className="min-w-0 empty:hidden" />
      <PageHeader
        eyebrow="Destek"
        title="Hazır yanıtlar"
        description="Destek yanıtlarında kullanılan makrolar. Ekleme, düzenleme ve silme yalnız süper admin içindir."
        breadcrumbs={[{ label: "Destek talepleri", href: "/admin/tickets" }, { label: "Hazır yanıtlar" }]}
      />
      <MacroList macros={(data ?? []) as MacroRow[]} canEdit={staff.role === "super_admin"} />
    </div>
  );
}
