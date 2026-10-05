import { PanelTop } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { toTrLocalInput } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { defaultSiteMenu } from "@/lib/site-menu/defaults";
import { sameConfig } from "@/lib/site-menu/editor-model";
import { readAdminState } from "@/lib/site-menu/store";
import { SiteMenuEditor, type HistoryView } from "./site-menu-editor";

export const metadata = { title: "Site menüsü" };

/** Süper admin: herkese açık sitenin üst menüsü, alt bilgisi ve duyuru şeridi (taslak/yayın, sürüm geçmişi). Operasyon salt okur. */
export default async function AdminSiteMenuPage() {
  const staff = await requirePlatformModule("sitemenu");
  const state = await readAdminState();
  const defaults = defaultSiteMenu();
  const draft = state.draft ?? state.live ?? defaults;

  const history: HistoryView[] = state.history.map((h, i) => ({
    id: h.id,
    atLabel: toTrLocalInput(h.at).replace("T", " "),
    by: h.by,
    label: h.label,
    groups: h.cfg.groups.length,
    items: h.cfg.groups.reduce((n, g) => n + g.items.length, 0),
    isLive: i === 0 && state.live !== null && sameConfig(h.cfg, state.live),
  }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Herkese açık site"
        icon={PanelTop}
        title="Site menüsü"
        description="Üst mega menü (ikon, logo, öne çıkan kart ve animasyonlu medya), alt bilgi bağlantıları ve duyuru şeridi buradan yönetilir. Değişiklikler önce taslaktır; Yayınla ile canlıya alınır, her yayın geri dönülebilir."
        glow="brand"
      />
      <SiteMenuEditor
        initialDraft={draft}
        live={state.live}
        defaults={defaults}
        history={history}
        media={state.media}
        canWrite={staff.role === "super_admin"}
      />
    </div>
  );
}
