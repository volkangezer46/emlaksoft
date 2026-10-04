import Link from "next/link";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { canViewTv } from "@/lib/tv/tv-logic";
import { TvBoard } from "./tv-board";
import "./tv.css";

export const metadata = { title: "Ofis Panosu · TV" };

/**
 * Ofis Panosu (TV): oturumlu, ofis geneli kapsam rolleri (owner / gm / branch_manager) içindir.
 * Sayfa yalnız kapıyı ve ofis adını çözer; veri istemciden `/api/app/tv-data` ile canlı akar
 * (realtime + yedek yoklama), kabuk tam ekran katmanla örtülür. Gelir/komisyon varsayılan KAPALI.
 */
export default async function PanoTvPage() {
  const { tenantId, role, userId } = await requireModulePage("reports", "/app/pano-tv");

  if (!tenantId || !canViewTv(role)) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="font-display text-xl font-extrabold text-ink-950">Bu panoyu görme yetkiniz yok</h1>
        <p className="mt-2 text-sm text-text-muted">
          Ofis Panosu (TV) yalnız ofis geneli kapsamı olan roller (ofis sahibi, genel müdür, şube müdürü) içindir. Kendi
          performansınız için Performansım sayfasını kullanın.
        </p>
        <Link href="/app/performansim" className="focus-ring press mt-5 inline-flex h-10 items-center rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-semibold text-white">
          Performansım
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("tenants(name)").eq("id", userId).maybeSingle();
  const tenant = profile?.tenants as { name?: string } | { name?: string }[] | null | undefined;
  const officeName = (Array.isArray(tenant) ? tenant[0]?.name : tenant?.name) || "Ofis";

  return <TvBoard tenantId={tenantId} officeName={officeName} />;
}
