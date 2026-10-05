import { FileText } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { toTrLocalInput } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import { sameContent } from "@/lib/site-content/schema";
import { siteContentStore } from "@/lib/site-content/store";
import { SiteContentEditor, type HistoryView } from "./site-content-editor";

export const metadata = { title: "Site içeriği" };

/** Süper admin: ana sayfa ve genel pazarlama metinleri (taslak/yayın, sürüm geçmişi, varsayılana dön). Operasyon salt okur. */
export default async function AdminSiteContentPage() {
  const staff = await requirePlatformModule("sitecontent");
  const state = await siteContentStore.readState();
  const defaults = defaultSiteContent();
  const draft = state.draft ?? state.live ?? defaults;

  const history: HistoryView[] = state.history.map((h, i) => ({
    id: h.id,
    atLabel: toTrLocalInput(h.at).replace("T", " "),
    by: h.by,
    label: h.label,
    faq: h.cfg.faq.length,
    isLive: i === 0 && state.live !== null && sameContent(h.cfg, state.live),
  }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Herkese açık site"
        icon={FileText}
        title="Site içeriği"
        description="Ana sayfanın ve genel pazarlama sayfalarının metinleri buradan yönetilir. Değişiklikler önce taslaktır; Yayınla ile canlıya alınır, her yayın geri dönülebilir. Hiç yayın yokken site bugünkü metinle çalışır."
        glow="brand"
      />
      <SiteContentEditor initialDraft={draft} live={state.live} defaults={defaults} history={history} canWrite={staff.role === "super_admin"} />
    </div>
  );
}
