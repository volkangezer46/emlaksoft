import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui/page-header";
import { PLATFORM_ROLE_LABELS, type PlatformRole } from "@/lib/platform-access";
import { loadMacros, SUPPORT_STAFF_ROLES } from "@/lib/support/desk-data";
import { canEditMacros, describeMacroActions, parseMacroActions } from "@/lib/support/macro-template";
import { MacroList, type MacroRow } from "./macro-editor";

export const metadata = { title: "Hazır yanıtlar" };

export default async function MacrosPage() {
  const staff = await requirePlatformModule("tickets");
  const [{ macros, extended }, staffResult] = await Promise.all([
    loadMacros(),
    createAdminClient().from("platform_staff").select("id, full_name, role").eq("is_active", true).in("role", [...SUPPORT_STAFF_ROLES]).order("full_name"),
  ]);
  const staffRows = (staffResult.data ?? []) as { id: string; full_name: string; role: string }[];
  const staffName = (id: string) => staffRows.find((s) => s.id === id)?.full_name;
  const rows: MacroRow[] = macros.map((m) => {
    const actions = parseMacroActions(m.actions_json);
    return { id: m.id, title: m.title, body: m.body, actions, actionSummary: describeMacroActions(actions, staffName), useCount: m.use_count ?? 0 };
  });
  // En çok kullanılan üstte (aynı sayıda alfabetik).
  rows.sort((a, b) => b.useCount - a.useCount || a.title.localeCompare(b.title, "tr-TR"));

  return (
    <div className="space-y-6">
      {/* Satır içi düzenleme paneli burada açılır; popup yok. */}
      <div id="inline-panel-host" className="min-w-0 empty:hidden" />
      <PageHeader
        eyebrow="Destek"
        title="Hazır yanıtlar"
        description="Destek yanıtlarında kullanılan makrolar: değişkenli metin ({{ofis.ad}}, {{kullanici.ad}} …) ve gönderimde uygulanan eylemler (durum, öncelik, atama, etiket). Destek ekibi (süper admin, operasyon, müşteri temsilcisi) düzenleyebilir."
        breadcrumbs={[{ label: "Destek talepleri", href: "/admin/tickets" }, { label: "Hazır yanıtlar" }]}
      />
      <MacroList
        macros={rows}
        canEdit={canEditMacros(staff.role)}
        extended={extended}
        staff={staffRows.map((s) => ({ value: s.id, label: `${s.full_name} · ${PLATFORM_ROLE_LABELS[s.role as PlatformRole] ?? s.role}` }))}
      />
    </div>
  );
}
