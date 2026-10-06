import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";

/**
 * Günlük Brifing ana ekranın "Dikkat gerektirenler" bloğuna taşındı (bkz. `_home/dikkat.tsx`).
 * Eski yer imleri/bağlantılar kırılmasın diye adres korunur ve ana ekrana yönlenir.
 * Günaydın e-postası/cron (gunluk-ozet) etkilenmez.
 */
export default async function BrifingPage() {
  await requireModulePage("dashboard");
  redirect("/app");
}
