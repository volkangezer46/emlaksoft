import { requireModulePage } from "@/lib/require-module-page";
import { OfficeCenterClient } from "./office-center-client";

export const metadata = { title: "Ofis Merkezi" };

/**
 * Ofis Merkezi sayfa kabugu (sunucu): metadata + yetki kapisi burada; etkilesimli sekmeler istemci dosyasinda.
 * ("use client" dosyasindan metadata export edilemez; build bunu reddediyordu.)
 */
export default async function OfficeCenterPage() {
  await requireModulePage("office_center", "/app/ofis-merkezi");
  return <OfficeCenterClient />;
}
