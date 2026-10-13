import { loadOfficeBroadcastState } from "@/lib/platform-announcements/office";
import { PlatformBanner } from "./platform-banner";
import { WhatsNew } from "./whats-new";

/**
 * Ofis kabuğu yuvaları (AD8): kendi Suspense sınırlarında AKAR, kabuğu bekletmez. İkisi aynı istek-içi önbellekli
 * tek RPC'yi paylaşır (loadOfficeBroadcastState). Banner yoksa hiçbir şey çizilmez (yer kaplamaz, CLS yok).
 */
export async function PlatformBannerSlot() {
  const { banners } = await loadOfficeBroadcastState();
  if (banners.length === 0) return null;
  return <PlatformBanner items={banners} />;
}

export async function WhatsNewSlot() {
  const { changelogUnread } = await loadOfficeBroadcastState();
  return <WhatsNew unread={changelogUnread} />;
}
