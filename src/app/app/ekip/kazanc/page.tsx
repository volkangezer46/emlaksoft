import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";

/**
 * Eski "Ekip Merkezi / Kazanç" yolu (yer imleri): Cüzdanım ve bu sayfa tek "Kazanç" sayfasında birleşti.
 * Ofis geneli tablo artık `/app/cuzdan?sekme=ofis` sekmesidir (earnings_all + Ofis paketi kapısı orada).
 * Paket kapısı bilerek YOK (href verilmez): Danışman paketindeki hesap kendi kazancına bu yoldan da ulaşır.
 */
export default async function TeamEarningsRedirect() {
  await requireModulePage("commissions");
  redirect("/app/cuzdan?sekme=ofis");
}
