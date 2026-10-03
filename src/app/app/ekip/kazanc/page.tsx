import { redirect } from "next/navigation";

/**
 * Eski "Ekip Merkezi / Kazanç" yolu (yer imleri): Cüzdanım ve bu sayfa tek "Kazanç" sayfasında birleşti.
 * Ofis geneli tablo artık `/app/cuzdan?sekme=ofis` sekmesidir (earnings_all + Ofis paketi kapısı orada).
 * Paket kapısı bilerek YOK: Danışman paketindeki hesap kendi kazancına bu yoldan da ulaşır.
 */
export default function TeamEarningsRedirect() {
  redirect("/app/cuzdan?sekme=ofis");
}
