import { redirect } from "next/navigation";

/**
 * Genel ayarlar sayfası Ayar merkezine taşındı. Konuya ait ayarlar kendi bölümündedir (kayıt/bakım: Sistem,
 * deneme/yenileme: Abonelik & fatura); merkez her ayarı tek yerde gösterir ve oraya bağlar.
 */
export default function AdminSettingsPage(): never {
  redirect("/admin/ayarlar/merkez");
}
