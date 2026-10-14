import { FileText } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { toTrLocalInput } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { DEFAULT_PREVIEW_TTL_HOURS, PREVIEW_TTL_HOURS, isPreviewEnabled } from "@/lib/preview-token";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import { sameContent } from "@/lib/site-content/schema";
import { siteContentStore } from "@/lib/site-content/store";
import { listSiteMedia } from "@/lib/site-media/store";
import { toPickerMedia, type MediaLibraryState } from "./media-view";
import { SiteContentEditor, type HistoryView } from "./site-content-editor";

export const metadata = { title: "Site içeriği" };

/** Süper admin: ana sayfa ve genel pazarlama metinleri (taslak/yayın, sürüm geçmişi, varsayılana dön). Operasyon salt okur. */
export default async function AdminSiteContentPage() {
  const staff = await requirePlatformModule("sitecontent");
  // Şematik önizleme de gerçek deneme günü ve paket tanımıyla çizilir (sabit örnek değer yok).
  // Ana başlık görseli seçicisi medya kütüphanesinden okur (tablo yokken "kurulum bekliyor").
  const [state, pricing, mediaList] = await Promise.all([siteContentStore.readState(), getPublicPricing(), listSiteMedia().catch(() => ({ status: "error" as const, error: "" }))]);
  const media: MediaLibraryState = { status: mediaList.status, items: mediaList.status === "ok" ? mediaList.items.map(toPickerMedia) : [] };
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
      <SiteContentEditor
        initialDraft={draft}
        live={state.live}
        defaults={defaults}
        history={history}
        canWrite={staff.role === "super_admin"}
        media={media}
        preview={{ trialDays: pricing.trialDays, plans: pricing.plans, enabled: isPreviewEnabled(), ttlOptions: PREVIEW_TTL_HOURS, defaultTtl: DEFAULT_PREVIEW_TTL_HOURS }}
      />
    </div>
  );
}
