import { AlertTriangle, Radar } from "lucide-react";
import { PageTabs } from "@/components/app/page-tabs";
import { requirePlatformModule } from "@/lib/platform";
import { ErrorsView } from "../hatalar/errors-view";
import { SystemView } from "./system-view";

export const metadata = { title: "Sistem sağlığı" };

const TABS = [
  { id: "saglik", label: "Sistem sağlığı", icon: Radar },
  { id: "hatalar", label: "Üretim hataları", icon: AlertTriangle },
] as const;

/**
 * Sistem sağlığı + Üretim hataları (eski /admin/hatalar) tek sayfada.
 * İki sekme de aynı `sistem` platform modülündedir (tek kapı).
 * `?sekme=hatalar` hata listesini açar; durum/son/sayfa parametreleri ona aittir.
 */
export default async function AdminSystemPage({
  searchParams,
}: {
  searchParams?: Promise<{ sekme?: string; durum?: string; son?: string; sayfa?: string }>;
}) {
  await requirePlatformModule("sistem");
  const sp = (await searchParams) ?? {};
  const active = sp.sekme === "hatalar" ? "hatalar" : "saglik";

  return (
    <div className="space-y-6">
      <PageTabs base="/admin/sistem" label="Sistem sekmeleri" tabs={TABS} active={active} />
      {active === "hatalar" ? <ErrorsView searchParams={Promise.resolve(sp)} /> : <SystemView />}
    </div>
  );
}
