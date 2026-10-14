import { requirePlatformModule } from "@/lib/platform";
import { platformModuleMode } from "@/lib/platform-access";
import { readConnectionView } from "@/lib/google/read";
import { ConnectionsView } from "./connections-view";

export const metadata = { title: "Bağlantılar ve kurulum" };

type SP = { ileti?: string; hata?: string };

const clip = (v: string | undefined) => (typeof v === "string" && v.length > 0 ? v.slice(0, 200) : undefined);

/**
 * Google bağlantı merkezi: Search Console + Google Ads. Modül `reklam` (super_admin yazar, ops salt okur,
 * billing/support göremez). Yalnız platform_settings okunur; Google API çiziminde çağrılmaz.
 */
export default async function GoogleConnectionsPage({ searchParams }: { searchParams?: Promise<{ ileti?: string; hata?: string }> }) {
  const staff = await requirePlatformModule("reklam");
  const canWrite = platformModuleMode(staff, "reklam") === "write" && staff.role === "super_admin";
  const [view, sp] = await Promise.all([readConnectionView(), searchParams ?? Promise.resolve({} as SP)]);
  return <ConnectionsView view={view} canWrite={canWrite} flash={{ ok: clip(sp.ileti), error: clip(sp.hata) }} />;
}
