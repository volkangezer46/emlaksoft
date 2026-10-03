import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";

/**
 * Günlük Brifing ana ekranın "Bugün" bloğuna taşındı (bkz. `_home/bugun-ozet.tsx`).
 * Eski yer imleri/bağlantılar kırılmasın diye adres korunur ve ana ekrana yönlenir.
 * Günaydın e-postası/cron (gunluk-ozet) etkilenmez.
 */
export default async function BrifingPage() {
  await requireModulePage("dashboard");
  redirect("/app");
}
