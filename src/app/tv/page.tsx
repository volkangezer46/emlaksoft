import { cookies } from "next/headers";
import { now } from "@/lib/clock";
import { TV_COOKIE, resolveTvDevice } from "@/lib/tv/device";
import { TvBoard } from "@/app/app/pano-tv/tv-board";
import { TvPairScreen } from "./pair-screen";
import "@/app/app/pano-tv/tv.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ofis Panosu · TV",
  description: "Ofis TV'si için oturumsuz pano yayını.",
  robots: { index: false, follow: false },
};

/**
 * Ofis TV'si (OA6, herkese açık yol, noindex, sitemap dışı). Bu tarayıcının cihaz çerezi etkin bir ofis ekranına
 * çözülürse pano oturumsuz yayınlanır (veri `/api/tv/data`); yoksa 6 haneli eşleştirme kodu gösterilir. Kod yalnız
 * ofis yöneticisi Pano TV > TV ekranları'ndan girince işe yarar.
 */
export default async function TvPage() {
  const secret = (await cookies()).get(TV_COOKIE)?.value;
  const device = await resolveTvDevice(secret, { nowMs: now() });
  if (device) {
    return (
      <>
        <h1 className="sr-only">Ofis Panosu · {device.officeName}</h1>
        <TvBoard tenantId={device.tenantId} officeName={device.officeName} mode="device" />
      </>
    );
  }
  return <TvPairScreen />;
}
